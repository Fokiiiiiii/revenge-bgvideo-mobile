import { Tokens } from '@revenge-mod/discord/common/tokens'
import { FileModule } from '@revenge-mod/discord/native'
import { getModuleWithImportedPath } from '@revenge-mod/discord/utils/modules/finders'
import { after } from '@revenge-mod/patcher'
import {
	cloneElement,
	createContext,
	createElement,
	Fragment,
	isValidElement,
	useContext,
	useEffect,
	useState,
} from 'react'
import {
	AppState,
	Image,
	processColor,
	StyleSheet,
	useWindowDimensions,
	View,
} from 'react-native'
import { connectDiagnostics } from './diagnostics-client'
import {
	DefaultSettings,
	imageFrame,
	isSupportedMediaUri,
	isVideoUri,
	mediaTransform,
	normalizeSettings,
} from './logic'
import { resolveMediaSource } from './media'
import { createScreenPainter } from './screens'
import SettingsComponent, { FileVideo, VideoErrorBoundary } from './settings'
import { createPanelTransparency } from './transparency'
import type { ReactElement, ReactNode } from 'react'
import type { DiagnosticClient } from './diagnostics-client'
import type { Settings } from './logic'

let panelTransparency: ReturnType<typeof createPanelTransparency> | undefined
let screenPainter: ReturnType<typeof createScreenPainter> | undefined
let backgroundHost: unknown
let paintRequest: number | undefined
const RootBackgroundContext = createContext(false)
type RootThemeProviderModule = {
	RootThemeContextProvider?: (...args: unknown[]) => unknown
}
let diagnosticClient: DiagnosticClient | undefined
let settings = DefaultSettings
let saveSettings: ((value: Partial<Settings>) => Promise<unknown>) | undefined
let rootBackgroundInserted = false
let chatSurfaceMarkerLogged = false
let backgroundLayoutLogged = false

function panelTransparencyActive() {
	return (
		settings.enabled &&
		settings.transparentPanels &&
		isSupportedMediaUri(settings.sourceUri.trim())
	)
}

function scheduleScreenPaint() {
	if (!screenPainter || paintRequest !== undefined) return
	paintRequest = requestAnimationFrame(() => {
		paintRequest = undefined
		const changed = screenPainter?.apply(
			backgroundHost,
			panelTransparencyActive(),
			panelTransparency?.originalColors ?? [],
		)
		if (changed)
			console.info('[BgVideo] opaque screen backdrops updated', changed)
	})
}

function notifySettingsListeners() {
	const active = panelTransparencyActive()
	panelTransparency?.setActive(active)
	if (!active) {
		screenPainter?.apply(
			backgroundHost,
			false,
			panelTransparency?.originalColors ?? [],
		)
		screenPainter?.restore()
	}
	scheduleScreenPaint()
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

function mediaStyle(settings: Settings, width: number, height: number) {
	const [scale, translateX, translateY] = mediaTransform(
		settings,
		width,
		height,
	)
	return [
		StyleSheet.absoluteFillObject,
		{
			transform: [{ scale }, { translateX }, { translateY }],
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
	if ('visibleMessagesWindowHandler' in props && props.style != null) {
		if (!chatSurfaceMarkerLogged) {
			console.info('[BgVideo] ChatView surface matched')
			chatSurfaceMarkerLogged = true
		}
		return cloneElement(element, {
			style: [props.style, transparentChatStyle],
		})
	}

	const children = patchChatSurfaceTree(props.children as ReactNode)
	return children === props.children
		? element
		: cloneElement(element, { children })
}

function patchChatViewSurface(
	exports: unknown,
	cleanup: (callback: () => void) => void,
) {
	const component = (exports as { default?: { type?: unknown } } | undefined)
		?.default
	if (!component || typeof component.type !== 'function') {
		console.warn('[BgVideo] ChatView export shape not recognized')
		return
	}
	console.info('[BgVideo] ChatView component hook installed')
	const original = component.type

	const patched = function (this: unknown, ...args: unknown[]) {
		const currentSettings = useCurrentSettings()
		const hasRootBackground = useContext(RootBackgroundContext)
		const rendered = Reflect.apply(original, this, args) as ReactNode
		if (!currentSettings.enabled || !currentSettings.transparentPanels)
			return rendered
		const chatTree = patchChatSurfaceTree(rendered)
		scheduleScreenPaint()
		return hasRootBackground
			? chatTree
			: createElement(
					Fragment,
					null,
					createElement(BackgroundLayer, {
						key: 'revenge-bgvideo-chat',
					}),
					chatTree,
				)
	}
	component.type = patched
	cleanup(() => {
		if (component.type === patched) component.type = original
	})
}

function BackgroundLayer() {
	const currentSettings = useCurrentSettings()
	const rootLayer = useContext(RootBackgroundContext)
	const window = useWindowDimensions()
	const [layout, setLayout] = useState<{
		width: number
		height: number
	} | null>(null)
	const { width, height } = layout ?? window
	const [imageSize, setImageSize] = useState<{
		uri: string
		width: number
		height: number
	} | null>(null)
	const [uri, setUri] = useState<string | null>(null)
	const [foreground, setForeground] = useState(
		AppState.currentState === 'active',
	)
	const sourceUri = currentSettings.sourceUri.trim()

	useEffect(() => {
		const subscription = AppState.addEventListener('change', state => {
			setForeground(state === 'active')
			if (state === 'active') scheduleScreenPaint()
		})
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
		void resolveMediaSource({ ...currentSettings, sourceUri })
			.then(result => {
				if (!active) return
				console.info(
					'[BgVideo] media source resolved',
					result.cache ? 'cached' : result.uri ? 'direct' : 'empty',
				)
				setUri(result.uri)
				const currentCache = currentSettings.cache
				if (
					result.cache?.fullPath !== currentCache?.fullPath ||
					result.cache?.sourceUri !== currentCache?.sourceUri
				) {
					settings = { ...settings, cache: result.cache }
					void saveSettings?.({ cache: result.cache }).catch(() =>
						console.warn('[BgVideo] cache metadata persist failed'),
					)
					notifySettingsListeners()
				}
			})
			.catch(() => {
				if (!active) return
				setUri(null)
				console.warn('[BgVideo] media source resolution failed')
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
		<View
			ref={ref => {
				backgroundHost = ref
				diagnosticClient?.expose('bgHost', ref)
				scheduleScreenPaint()
			}}
			pointerEvents="none"
			style={[StyleSheet.absoluteFillObject, { overflow: 'hidden' }]}
			onLayout={event => {
				const { width: layerWidth, height: layerHeight } =
					event.nativeEvent.layout
				if (layerWidth <= 0 || layerHeight <= 0) return
				scheduleScreenPaint()
				setLayout(current =>
					current?.width === layerWidth && current.height === layerHeight
						? current
						: { width: layerWidth, height: layerHeight },
				)
				if (!backgroundLayoutLogged) {
					backgroundLayoutLogged = true
					console.info(
						'[BgVideo] background layer laid out',
						rootLayer ? 'root' : 'chat',
						Math.round(layerWidth),
						Math.round(layerHeight),
					)
				}
			}}
		>
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
					style={imageFrame(
						currentSettings,
						width,
						height,
						imageSize?.uri === uri ? imageSize : undefined,
					)}
					onLoad={event => {
						console.info('[BgVideo] image loaded')
						const { width: sourceWidth, height: sourceHeight } =
							event.nativeEvent.source
						if (
							Number.isFinite(sourceWidth) &&
							Number.isFinite(sourceHeight) &&
							sourceWidth > 0 &&
							sourceHeight > 0
						)
							setImageSize(current =>
								current?.uri === uri &&
								current.width === sourceWidth &&
								current.height === sourceHeight
									? current
									: { uri, width: sourceWidth, height: sourceHeight },
							)
					}}
					onError={() => console.warn('[BgVideo] image load failed')}
				/>
			)}
		</View>
	)
}

function injectBackground(tree: unknown) {
	if (!isValidElement(tree)) return tree
	if (!rootBackgroundInserted)
		console.info('[BgVideo] RootThemeContextProvider element inserted')
	rootBackgroundInserted = true
	return createElement(
		RootBackgroundContext.Provider,
		{ value: true },
		createElement(
			Fragment,
			null,
			createElement(BackgroundLayer, { key: 'revenge-bgvideo-mobile' }),
			tree,
		),
	)
}

export default plugin<{ jsonStorage: Settings }>({
	jsonStorage: { load: true, default: DefaultSettings },
	async start({ cleanup, jsonStorage }) {
		rootBackgroundInserted = false
		chatSurfaceMarkerLogged = false
		backgroundLayoutLogged = false
		settings = normalizeSettings(await jsonStorage.get())
		try {
			if (
				await FileModule.fileExists(
					'/sdcard/Android/data/com.discord/files/.bgvideo-diagnostic',
				)
			) {
				diagnosticClient = connectDiagnostics(revenge)
				diagnosticClient.expose('getBgHost', () => backgroundHost)
				diagnosticClient.expose('repaintBg', scheduleScreenPaint)
				cleanup(() => {
					diagnosticClient?.disconnect()
					diagnosticClient = undefined
				})
			}
		} catch (error) {
			console.warn('[BgDiag] setup failed', String(error))
		}
		panelTransparency = createPanelTransparency(Tokens)
		panelTransparency.setActive(panelTransparencyActive())
		screenPainter = createScreenPainter(
			value => StyleSheet.flatten(value as never),
			value => processColor(value as never),
			(node, props) => {
				const renderer = (
					globalThis as typeof globalThis & {
						nativeFabricUIManager?: {
							setNativeProps(node: unknown, props: unknown): void
						}
					}
				).nativeFabricUIManager
				if (!renderer?.setNativeProps)
					throw new Error('Fabric painting unavailable')
				renderer.setNativeProps(node, props)
			},
		)
		console.info(
			'[BgVideo] background token transparency ready',
			panelTransparency.tokenCount,
		)
		cleanup(
			getModuleWithImportedPath<{
				getRootNavigationRef(): {
					addListener(event: string, callback: () => void): () => void
				}
			}>('modules/main_tabs_v2/RootNavigationRef.native.tsx', exports => {
				try {
					cleanup(
						exports
							.getRootNavigationRef()
							.addListener('state', scheduleScreenPaint),
					)
				} catch {}
			}),
		)
		saveSettings = value => jsonStorage.set(value)
		cleanup(
			jsonStorage.subscribe(() => {
				settings = normalizeSettings(jsonStorage.cache)
				notifySettingsListeners()
			}),
		)
		cleanup(
			getModuleWithImportedPath<RootThemeProviderModule>(
				'modules/themes/RootThemeContextProvider.native.tsx',
				exports => {
					if (typeof exports?.RootThemeContextProvider !== 'function') return
					console.info('[BgVideo] RootThemeContextProvider hook installed')
					cleanup(
						after(
							exports as Required<RootThemeProviderModule>,
							'RootThemeContextProvider',
							tree => injectBackground(tree),
						),
					)
				},
			),
		)
		cleanup(
			getModuleWithImportedPath<{ default?: { type?: unknown } }>(
				'modules/chat/native/ChatView.tsx',
				exports => patchChatViewSurface(exports, cleanup),
			),
		)
		cleanup(() => {
			rootBackgroundInserted = false
			chatSurfaceMarkerLogged = false
			backgroundLayoutLogged = false
			saveSettings = undefined
			settings = DefaultSettings
			panelTransparency?.restore()
			screenPainter?.apply(
				backgroundHost,
				false,
				panelTransparency?.originalColors ?? [],
			)
			screenPainter?.restore()
			panelTransparency = undefined
			screenPainter = undefined
			backgroundHost = undefined
			if (paintRequest !== undefined) cancelAnimationFrame(paintRequest)
			paintRequest = undefined
			notifySettingsListeners()
		})
	},
	SettingsComponent,
})
