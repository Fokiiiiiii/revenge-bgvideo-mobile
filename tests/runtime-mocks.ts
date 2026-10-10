import { mock } from 'bun:test'
import { createElement, useEffect } from 'react'

type ImageLoadEvent = {
	nativeEvent: {
		source: { uri: string; width: number; height: number }
	}
}

function MockRNImage(props: Record<string, unknown>) {
	useEffect(() => {
		const onLoad = props.onLoad as ((event: ImageLoadEvent) => void) | undefined
		const imageSource = props.source as { uri?: string } | undefined
		onLoad?.({
			nativeEvent: {
				source: {
					uri: imageSource?.uri ?? '',
					width: 1920,
					height: 1080,
				},
			},
		})
	}, [])
	return createElement('Image', props)
}

export const FileModule = {
	fileExists: mock(async (_path: string) => false),
	readAsset: mock(async (_uri: string, _encoding: string) => 'aGVsbG8='),
	writeFile: mock(
		async (
			_bucket: string,
			relativePath: string,
			_data: string,
			_encoding: string,
		) => `/mock-cache/${relativePath}`,
	),
	removeFile: mock(async (_bucket: string, _relativePath: string) => undefined),
}

export const fileModule = FileModule

export const nativeControls = {
	registeredComponents: new Set(['RNCWebView']),
	getViewManagerConfig: mock((name: string) =>
		nativeControls.registeredComponents.has(name) ? {} : null,
	),
	requireNativeComponent: mock((name: string) => name),
	shouldStartLoadWithLockIdentifier: mock(
		(_shouldStart: boolean, _lockIdentifier: number) => undefined,
	),
}

export const tokenFixture = {
	SemanticColor: Object.fromEntries(
		[
			'BACKGROUND_BASE_LOW',
			'BACKGROUND_BASE_LOWER',
			'BACKGROUND_BASE_LOWEST',
		].map(name => [
			name,
			{
				dark: { raw: 'NEUTRAL_69', opacity: 1 },
				light: { raw: 'NEUTRAL_2', opacity: 1 },
				midnight: { raw: 'NEUTRAL_100', opacity: 1 },
				darker: { raw: 'NEUTRAL_86', opacity: 1 },
			},
		]),
	),
	default: {
		colors: Object.fromEntries(
			[
				'BACKGROUND_BASE_LOW',
				'BACKGROUND_BASE_LOWER',
				'BACKGROUND_BASE_LOWEST',
			].map(name => [name, { name }]),
		),
		internal: {
			resolveSemanticColor: (_mode: string, color: { name: string }) =>
				tokenFixture.SemanticColor[color.name]?.dark.opacity === 0
					? '#32333900'
					: '#323339',
		},
	},
}

Object.assign(globalThis, {
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
	cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
})
mock.module('@revenge-mod/discord/common/tokens', () => ({
	Tokens: tokenFixture,
}))

mock.module('@revenge-mod/discord/native', () => ({ FileModule }))

mock.module('@revenge-mod/discord/flux', () => ({
	getStore: (_name: string, callback: (store: { locale: string }) => void) => {
		callback({ locale: 'en-US' })
		return () => undefined
	},
}))

mock.module('react-native', () => ({
	AppState: {
		currentState: 'active',
		addEventListener: () => ({ remove() {} }),
	},
	Image: MockRNImage,
	Pressable: 'Pressable',
	requireNativeComponent: nativeControls.requireNativeComponent,
	ScrollView: 'ScrollView',
	StyleSheet: {
		absoluteFillObject: {
			position: 'absolute',
			top: 0,
			right: 0,
			bottom: 0,
			left: 0,
		},
		create: (styles: unknown) => styles,
	},
	Text: 'Text',
	TurboModuleRegistry: {
		get: (name: string) =>
			name === 'RNCWebView'
				? {
						shouldStartLoadWithLockIdentifier:
							nativeControls.shouldStartLoadWithLockIdentifier,
					}
				: null,
	},
	UIManager: { getViewManagerConfig: nativeControls.getViewManagerConfig },
	processColor: (value: unknown) =>
		value === 'transparent'
			? 0
			: typeof value === 'string' && value.startsWith('#')
				? parseInt(value.slice(1), 16)
				: undefined,
	useWindowDimensions: () => ({ width: 400, height: 800 }),
	View: 'View',
}))

mock.module('@revenge-mod/components/Page', () => ({ default: 'Page' }))

mock.module('@revenge-mod/discord/design', () => ({
	Design: {
		Stack: 'Stack',
		TableRowGroup: 'TableRowGroup',
		TableSwitchRow: 'TableSwitchRow',
		TextInput: 'TextInput',
	},
}))
