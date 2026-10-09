import { FileModule } from '@revenge-mod/discord/native'
import { getModules } from '@revenge-mod/modules/finders'
import { createFilterGenerator } from '@revenge-mod/modules/finders/filters'
import { after } from '@revenge-mod/patcher'
import {
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
} from './logic'
import SettingsComponent, { setPreviewVideoComponent } from './settings'
import type { ComponentType } from 'react'
import type { CacheEntry, Settings } from './logic'

type RootThemeProviderModule = {
	RootThemeContextProvider?: (...args: unknown[]) => unknown
}
type VideoComponentProps = Record<string, unknown>
type VideoComponentType = ComponentType<VideoComponentProps>
type SharedBackgroundBridge = { active: boolean; transparentPanels: boolean }

const withRootThemeProvider = createFilterGenerator(
	(_args, _scope, exports) =>
		typeof (exports as RootThemeProviderModule | undefined)
			?.RootThemeContextProvider === 'function',
	() => 'RootThemeContextProvider',
) as any

const withVideoComponent = createFilterGenerator(
	(_args, _scope, exports) =>
		typeof (exports as { VideoComponent?: unknown } | undefined)
			?.VideoComponent === 'function',
	() => 'VideoComponent',
) as any

let settings = DefaultSettings
let saveSettings: ((value: Partial<Settings>) => Promise<unknown>) | undefined
let videoComponent: VideoComponentType | undefined
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

function updateBackgroundBridge() {
	const root = globalThis as typeof globalThis & {
		__revengeNextBgVideoMobile?: SharedBackgroundBridge
	}
	root.__revengeNextBgVideoMobile = {
		active: settings.enabled && isSupportedMediaUri(settings.sourceUri),
		transparentPanels: settings.transparentPanels,
	}
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
	if (
		expectedSize !== undefined &&
		isOverCacheLimit(expectedSize, value.maxCacheMB)
	) {
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

function BackgroundLayer() {
	const currentSettings = useCurrentSettings()
	const { width, height } = useWindowDimensions()
	const [uri, setUri] = useState<string | null>(null)
	const [foreground, setForeground] = useState(
		AppState.currentState === 'active',
	)

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
			!currentSettings.sourceUri ||
			!isSupportedMediaUri(currentSettings.sourceUri)
		) {
			setUri(null)
			return () => {
				active = false
			}
		}

		const generation = ++requestGeneration
		void resolveMediaSource(currentSettings).then(result => {
			if (!active || generation !== requestGeneration) return
			setUri(result.uri)
			const currentCache = currentSettings.cache
			if (
				result.cache?.fullPath !== currentCache?.fullPath ||
				result.cache?.sourceUri !== currentCache?.sourceUri
			) {
				settings = { ...settings, cache: result.cache }
				updateBackgroundBridge()
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

	if (!uri) return null
	const style = mediaStyle(currentSettings, width, height)
	const video = isVideoUri(uri, currentSettings.mediaType)
	return (
		<View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
			{video ? (
				videoComponent ? (
					createElement(videoComponent, {
						source: { uri },
						resizeMode: currentSettings.crop ? 'cover' : 'contain',
						repeat: currentSettings.loop,
						paused: currentSettings.pauseInBackground && !foreground,
						style,
					})
				) : null
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
		updateBackgroundBridge()
		cleanup(
			jsonStorage.subscribe(value => {
				settings = normalizeSettings(value)
				updateBackgroundBridge()
				notifySettingsListeners()
			}),
		)
		cleanup(
			getModules(withVideoComponent(), exports => {
				videoComponent = (exports as { VideoComponent?: VideoComponentType })
					.VideoComponent
				setPreviewVideoComponent(videoComponent)
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
		cleanup(() => {
			requestGeneration++
			videoComponent = undefined
			setPreviewVideoComponent(undefined)
			saveSettings = undefined
			settings = DefaultSettings
			updateBackgroundBridge()
			notifySettingsListeners()
		})
	},
	SettingsComponent,
})
