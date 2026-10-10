import { FileModule } from '@revenge-mod/discord/native'
import { getModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { getModules } from '@revenge-mod/modules/finders'
import { createFilterGenerator } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import {
	cloneElement,
	createElement,
	Fragment,
	isValidElement,
	useEffect,
	useState,
} from 'react'
import {
	AppState,
	Image,
	StyleSheet,
	useWindowDimensions,
	View,
} from 'react-native'
import {
	base64SizeBytes,
	cacheRelativePath,
	DefaultSettings,
	isOverCacheLimit,
	isSupportedMediaUri,
	isVideoUri,
	normalizeSettings,
	shouldCacheRemoteAsset,
} from './logic'
import SettingsComponent, { FileVideo, VideoErrorBoundary } from './settings'
import type { ReactElement, ReactNode } from 'react'
import type { CacheEntry, Settings } from './logic'

type RootThemeProviderModule = {
	RootThemeContextProvider?: (...args: unknown[]) => unknown
}
const withRootThemeProvider = createFilterGenerator(
	(_args, _scope, exports) =>
		typeof (exports as RootThemeProviderModule | undefined)
			?.RootThemeContextProvider === 'function',
	() => 'RootThemeContextProvider',
) as any


let settings = DefaultSettings
let saveSettings: ((value: Partial<Settings>) => Promise<unknown>) | undefined
let requestGeneration = 0

function notifySettingsListeners() {
	for (const listener of settingsListeners) listener()
}

const settingsListeners = new Set<() => void>()

function useCurrentSettings() {
	const [, refresh] = useState(0)
	useEffect(() => {
		const listener = () => refresh(value => value + 1)
		settingsListeners.add(listener)
		return () => {
			settingsListeners.delete(listener)
		}
	}, [])
	return settings
}

function toFileUri(path: string) {
	return path.startsWith('file://') ? path : `file://${path}`
}

function removeCachedFile(entry: CacheEntry | null) {
	if (entry)
		void FileModule.removeFile('cache', entry.relativePath).catch(
			() => undefined,
		)
}

async function contentLength(uri: string) {
	if (!/^https?:\/\//i.test(uri)) return undefined
	try {
		const response = await fetch(uri, { method: 'HEAD' })
		if (!response.ok) return undefined
		const value = Number(response.headers.get('content-length'))
		return Number.isFinite(value) && value > 0 ? value : undefined
	} catch {
		return undefined
	}
}

async function resolveMediaSource(
	value: Settings,
): Promise<{ uri: string | null; cache: CacheEntry | null }> {
	const sourceUri = value.sourceUri.trim()
	if (!sourceUri || !isSupportedMediaUri(sourceUri))
		return { uri: null, cache: null }
	const existing = value.cache?.sourceUri === sourceUri ? value.cache : null
	const maxBytes = value.maxCacheMB * 1024 * 1024

	if (existing && existing.sizeBytes <= maxBytes) {
		try {
			if (await FileModule.fileExists(existing.fullPath))
				return { uri: toFileUri(existing.fullPath), cache: existing }
		} catch {}
	}

	const expectedSize = await contentLength(sourceUri)
	if (!shouldCacheRemoteAsset(sourceUri, expectedSize, value.maxCacheMB)) {
		if (value.cache?.sourceUri !== sourceUri) removeCachedFile(value.cache)
		return { uri: sourceUri, cache: null }
	}

	try {
		// shortcut: base64 caching holds one bounded media file in memory; replace with a streaming native download when available.
		const data = await FileModule.readAsset(sourceUri, 'base64')
		const sizeBytes = base64SizeBytes(data)
		if (isOverCacheLimit(sizeBytes, value.maxCacheMB)) {
			if (value.cache) removeCachedFile(value.cache)
			return { uri: sourceUri, cache: null }
		}

		const relativePath = cacheRelativePath(sourceUri, value.mediaType)
		const fullPath = await FileModule.writeFile(
			'cache',
			relativePath,
			data,
			'base64',
		)
		const cache = { sourceUri, relativePath, fullPath, sizeBytes }
		if (value.cache && value.cache.relativePath !== relativePath)
			removeCachedFile(value.cache)
		return { uri: toFileUri(fullPath), cache }
	} catch {
		if (value.cache?.sourceUri !== sourceUri) removeCachedFile(value.cache)
		return { uri: sourceUri, cache: null }
	}
}

function mediaStyle(settings: Settings, width: number, height: number) {
	return [
		StyleSheet.absoluteFillObject,
		{
			transform: [
				{ scale: settings.zoom },
				{ translateX: ((settings.positionX - 50) / 50) * width * 0.18 },
				{ translateY: ((settings.positionY - 50) / 50) * height * 0.18 },
			],
		},
	]
}

const transparentChatStyle = { backgroundColor: 'transparent' }

// shortcut: re-check this ChatView surface marker after Discord changes the chat tree.

function patchChatSurfaceTree(node: ReactNode): ReactNode {
	if (Array.isArray(node)) {
		let changed = false
		const children = node.map(child => {
			const patched = patchChatSurfaceTree(child)
			if (patched !== child) changed = true
			return patched
		})
		return changed ? children : node
	}
	if (!isValidElement(node)) return node

	const element = node as ReactElement<Record<string, unknown>>
	const props = element.props
	if (
		'visibleMessagesWindowHandler' in props &&
		props.style != null
	)
		return cloneElement(element, {
			style: [props.style, transparentChatStyle],
		})

	const children = patchChatSurfaceTree(props.children as ReactNode)
	return children === props.children
		? element
		: cloneElement(element, { children })
}

function patchChatViewSurface(exports: unknown, cleanup: (callback: () => void) => void) {
	const component = (exports as { default?: { type?: unknown } } | undefined)
		?.default
	if (!component || typeof component.type !== 'function') return
	const original = component.type

	const patched = function (this: unknown, ...args: unknown[]) {
		const rendered = Reflect.apply(original, this, args) as ReactNode
		return settings.enabled && settings.transparentPanels
			? patchChatSurfaceTree(rendered)
			: rendered
	}
	component.type = patched
	cleanup(() => {
		if (component.type === patched) component.type = original
	})
}

function BackgroundLayer() {
	const currentSettings = useCurrentSettings()
	const { width, height } = useWindowDimensions()
	const [uri, setUri] = useState<string | null>(null)
	const [foreground, setForeground] = useState(
		AppState.currentState === 'active',
	)
	const sourceUri = currentSettings.sourceUri.trim()

	useEffect(() => {
		const subscription = AppState.addEventListener('change', state =>
			setForeground(state === 'active'),
		)
		return () => subscription.remove()
	}, [])

	useEffect(() => {
		let active = true
		if (
			!currentSettings.enabled ||
			!sourceUri ||
			!isSupportedMediaUri(sourceUri)
		) {
			setUri(null)
			return () => {
				active = false
			}
		}

		const generation = ++requestGeneration
		void resolveMediaSource({ ...currentSettings, sourceUri }).then(result => {
			if (!active || generation !== requestGeneration) return
			setUri(result.uri)
			const currentCache = currentSettings.cache
			if (
				result.cache?.fullPath !== currentCache?.fullPath ||
				result.cache?.sourceUri !== currentCache?.sourceUri
			) {
				settings = { ...settings, cache: result.cache }
				void saveSettings?.({ cache: result.cache })
				notifySettingsListeners()
			}
		})
		return () => {
			active = false
		}
	}, [
		currentSettings.enabled,
		currentSettings.sourceUri,
		currentSettings.maxCacheMB,
		currentSettings.mediaType,
		currentSettings.cache?.sourceUri,
		currentSettings.cache?.fullPath,
	])

	if (!currentSettings.enabled || !uri) return null
	const style = mediaStyle(currentSettings, width, height)
	const video = isVideoUri(uri, currentSettings.mediaType)
	return (
		<View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
			{video ? (
				<VideoErrorBoundary key={uri} fallback={null}>
					<FileVideo
						uri={uri}
						settings={currentSettings}
						visible={!currentSettings.pauseInBackground || foreground}
						style={style}
					/>
				</VideoErrorBoundary>
			) : (
				<Image
					source={{ uri }}
					resizeMode={currentSettings.crop ? 'cover' : 'contain'}
					style={style}
				/>
			)}
		</View>
	)
}

function injectBackground(tree: unknown) {
	if (!isValidElement(tree)) return tree
	return createElement(
		Fragment,
		null,
		createElement(BackgroundLayer, { key: 'revenge-bgvideo-mobile' }),
		tree,
	)
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	async start({ cleanup, jsonStorage }) {
		requestGeneration++
		settings = normalizeSettings(await jsonStorage.get())
		saveSettings = value => jsonStorage.set(value)
		cleanup(
			jsonStorage.subscribe(value => {
				settings = normalizeSettings(value)
				notifySettingsListeners()
			}),
		)
		cleanup(
			getModules(withRootThemeProvider(), module => {
				cleanup(
					after(module, 'RootThemeContextProvider', tree =>
						injectBackground(tree),
					),
				)
			}),
		)
		cleanup(
			getModuleWithImportedPath<{ default?: { type?: unknown } }>(
				'modules/chat/native/ChatView.tsx',
				exports => patchChatViewSurface(exports, cleanup),
			),
		)
		cleanup(() => {
			requestGeneration++
			saveSettings = undefined
			settings = DefaultSettings
			notifySettingsListeners()
		})
	},
	SettingsComponent,
})
