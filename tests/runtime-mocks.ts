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

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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
