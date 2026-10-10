import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { FileModule } from '@revenge-mod/discord/native'
import { Component, createElement, useEffect, useMemo, useState } from 'react'
import {
	AppState,
	Image,
	Pressable,
	requireNativeComponent,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { useTranslator } from './localization'
import { buildVideoHtml, isSupportedMediaUri, isVideoUri, normalizeSettings } from './logic'
import type { PluginSettingsComponent } from '@revenge-mod/plugins/types'
import type { ComponentProps, ComponentType, ReactNode } from 'react'
import type { Settings } from './logic'

type Props = ComponentProps<PluginSettingsComponent<{ jsonStorage: Settings }>>
type VideoProps = Record<string, unknown>

const { Stack, TableRowGroup, TableSwitchRow, TextInput } = Design

export class VideoErrorBoundary extends Component<
	{ children?: ReactNode; fallback?: ReactNode },
	{ hasError: boolean }
> {
	state = { hasError: false }

	static getDerivedStateFromError() {
		return { hasError: true }
	}

	componentDidCatch(error: Error) {
		console.warn('[BgVideo] video render failed:', error.message)
	}

	render() {
		return this.state.hasError
			? (this.props.fallback ?? null)
			: (this.props.children ?? null)
	}
}

let nativeWebView: ComponentType<VideoProps> | undefined

export function FileVideo({
	uri,
	settings,
	visible,
	style,
}: {
	uri: string
	settings: Settings
	visible: boolean
	style: unknown
}) {
	const source = useMemo(
		() => ({
			html: buildVideoHtml(uri, settings),
			baseUrl: 'https://discord.com/',
		}),
		[uri, settings.crop, settings.loop],
	)
	if (!visible) return null
	try {
		nativeWebView ??= requireNativeComponent<VideoProps>(
			'RNCWebViewContainer',
		) as ComponentType<VideoProps>
	} catch {
		return null
	}
	return createElement(nativeWebView, {
		source,
		javaScriptEnabled: true,
		allowFileAccess: true,
		cacheEnabled: true,
		messagingEnabled: false,
		overScrollMode: 'never',
		style: [style, { backgroundColor: 'transparent' }],
	})
}

function toFileUri(path: string) {
	return path.startsWith('file://') ? path : `file://${path}`
}

function Preview({ settings }: { settings: Settings }) {
	const t = useTranslator()
	const [foreground, setForeground] = useState(AppState.currentState === 'active')
	const uri =
		settings.cache?.sourceUri === settings.sourceUri
			? toFileUri(settings.cache.fullPath)
			: settings.sourceUri

	useEffect(() => {
		const subscription = AppState.addEventListener('change', state =>
			setForeground(state === 'active'),
		)
		return () => subscription.remove()
	}, [])

	if (!uri)
		return (
			<View style={styles.preview}>
				<Text style={styles.previewText}>
					{t(
						'previewPasteSource',
						'Paste an image or video source to preview it.',
					)}
				</Text>
			</View>
		)
	if (!isSupportedMediaUri(uri))
		return (
			<View style={styles.preview}>
				<Text style={styles.previewText}>
					{t(
						'previewUnsupportedSource',
						'Use an HTTP(S), file://, or content:// URI. YouTube is not supported.',
					)}
				</Text>
			</View>
		)
	const video = isVideoUri(uri, settings.mediaType)
	const transform = [
		{ scale: settings.zoom },
		{ translateX: ((settings.positionX - 50) / 50) * 56 },
		{ translateY: ((settings.positionY - 50) / 50) * 32 },
	]
	const mediaStyle = [StyleSheet.absoluteFillObject, { transform }]
	return (
		<View style={styles.preview}>
			{video ? (
				<FileVideo
					key={uri}
					uri={uri}
					settings={settings}
					visible={foreground || !settings.pauseInBackground}
					style={mediaStyle}
				/>
			) : (
				<Image
					source={{ uri }}
					resizeMode={settings.crop ? 'cover' : 'contain'}
					style={mediaStyle}
				/>
			)}
		</View>
	)
}

const styles = StyleSheet.create({
	clearCache: {
		alignSelf: 'flex-start',
		paddingHorizontal: 12,
		paddingVertical: 8,
	},
	preview: {
		aspectRatio: 16 / 9,
		backgroundColor: '#15171b',
		borderRadius: 12,
		justifyContent: 'center',
		overflow: 'hidden',
		padding: 12,
		position: 'relative',
	},
	previewText: {
		color: '#f2f3f5',
	},
})

export default function SettingsComponent({ api }: Props) {
	const settings = api.jsonStorage.use(value => value)!
	const t = useTranslator()
	const [sourceUri, setSourceUri] = useState(settings.sourceUri)
	const [zoom, setZoom] = useState(String(settings.zoom))
	const [positionX, setPositionX] = useState(String(settings.positionX))
	const [positionY, setPositionY] = useState(String(settings.positionY))
	const [maxCacheMB, setMaxCacheMB] = useState(String(settings.maxCacheMB))
	const clearCache = () => {
		if (settings.cache)
			void FileModule.removeFile('cache', settings.cache.relativePath)
		void api.jsonStorage.set({ cache: null })
	}
	return (
		<Page>
			<ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
				<Stack spacing={16}>
					<VideoErrorBoundary
						fallback={
							<View style={styles.preview}>
								<Text style={styles.previewText}>
									動画プレビューを表示できません。URLを確認してください。
								</Text>
							</View>
						}
					>
						<Preview settings={settings} />
					</VideoErrorBoundary>
					<TableRowGroup title={t('backgroundMedia', 'Background media')}>
						<TableSwitchRow
							label={t('enableBackground', 'Enable background')}
							value={settings.enabled}
							onValueChange={(value: boolean) =>
								void api.jsonStorage.set({ enabled: value })
							}
						/>
						<TextInput
							label={t('imageVideoSource', 'Image/video URL or URI')}
							defaultValue={sourceUri}
							onChange={setSourceUri}
							onBlur={() =>
								void api.jsonStorage.set({ sourceUri: sourceUri.trim() })
							}
							returnKeyType="done"
						/>
						<TableSwitchRow
							label={t('treatSourceAsVideo', 'Treat source as video')}
							value={settings.mediaType === 'video'}
							onValueChange={(value: boolean) =>
								void api.jsonStorage.set({
									mediaType: value ? 'video' : 'auto',
								})
							}
						/>
						<TableSwitchRow
							label={t('cropToFill', 'Crop to fill')}
							value={settings.crop}
							onValueChange={(value: boolean) =>
								void api.jsonStorage.set({ crop: value })
							}
						/>
						<TextInput
							label={t('zoom', 'Zoom (1–4)')}
							returnKeyType="done"
							defaultValue={zoom}
							onChange={setZoom}
							onBlur={() =>
								void api.jsonStorage.set({
									zoom: normalizeSettings({ zoom: Number(zoom) }).zoom,
								})
							}
						/>
						<TextInput
							label={t('positionX', 'Position X (0–100)')}
							returnKeyType="done"
							defaultValue={positionX}
							onChange={setPositionX}
							onBlur={() =>
								void api.jsonStorage.set({
									positionX: normalizeSettings({ positionX: Number(positionX) })
										.positionX,
								})
							}
						/>
						<TextInput
							label={t('positionY', 'Position Y (0–100)')}
							returnKeyType="done"
							defaultValue={positionY}
							onChange={setPositionY}
							onBlur={() =>
								void api.jsonStorage.set({
									positionY: normalizeSettings({ positionY: Number(positionY) })
										.positionY,
								})
							}
						/>
					</TableRowGroup>
					<TableRowGroup title={t('playbackAndCache', 'Playback and cache')}>
						<TableSwitchRow
							label={t('loopVideo', 'Loop video')}
							value={settings.loop}
							onValueChange={(value: boolean) =>
								void api.jsonStorage.set({ loop: value })
							}
						/>
						<TableSwitchRow
							label={t(
								'pauseInBackground',
								'Pause when app is in the background',
							)}
							value={settings.pauseInBackground}
							onValueChange={(value: boolean) =>
								void api.jsonStorage.set({ pauseInBackground: value })
							}
						/>
						<TableSwitchRow
							label={t(
								'transparentPanels',
								'Transparent chat surface',
							)}
							value={settings.transparentPanels}
							onValueChange={(value: boolean) =>
								void api.jsonStorage.set({ transparentPanels: value })
							}
						/>
						<TextInput
							label={t('cacheLimit', 'Cache limit (MB)')}
							returnKeyType="done"
							defaultValue={maxCacheMB}
							onChange={setMaxCacheMB}
							onBlur={() =>
								void api.jsonStorage.set({
									maxCacheMB: normalizeSettings({
										maxCacheMB: Number(maxCacheMB),
									}).maxCacheMB,
								})
							}
						/>
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={t('clearBgVideoCache', 'Clear BgVideo cache')}
							onPress={clearCache}
							style={styles.clearCache}
						>
							<Text>
								{t('clearCachedBackground', 'Clear cached background')}
							</Text>
						</Pressable>
					</TableRowGroup>
				</Stack>
			</ScrollView>
		</Page>
	)
}
