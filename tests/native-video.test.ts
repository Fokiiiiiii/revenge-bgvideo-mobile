import { describe, expect, test } from 'bun:test'
import { act, createElement } from 'react'
import { create } from 'react-test-renderer'
import { DefaultSettings } from '../plugins/bgvideo-mobile/js/logic'
import { nativeControls } from './runtime-mocks'
import type { ComponentProps } from 'react'
import type { ReactTestRenderer } from 'react-test-renderer'

const { FileVideo, default: SettingsComponent } = await import(
	'../plugins/bgvideo-mobile/js/settings'
)

describe('BgVideo native video host', () => {
	test('preview supplies named React Native transforms', async () => {
		const settings = {
			...DefaultSettings,
			sourceUri: 'https://example.com/bg.mp4',
			zoom: 2,
		}
		const api = { jsonStorage: { use: () => settings } } as ComponentProps<
			typeof SettingsComponent
		>['api']
		let renderer: ReactTestRenderer | undefined
		try {
			await act(async () => {
				renderer = create(createElement(SettingsComponent, { api }))
			})
			const transforms =
				renderer?.root.findByType('RNCWebView').props.style[0][1].transform
			expect(transforms).toEqual([
				{ scale: 2 },
				{ translateX: 0 },
				{ translateY: 0 },
			])
		} finally {
			await act(async () => renderer?.unmount())
		}
	})
	test('passes the registered WebView source and resolves navigation locks', async () => {
		const props = {
			...DefaultSettings,
			sourceUri: 'file:///data/user/0/com.discord/cache/wallpaper.mp4',
			mediaType: 'video' as const,
		}
		nativeControls.registeredComponents.clear()
		nativeControls.registeredComponents.add('RNCWebView')
		nativeControls.getViewManagerConfig.mockClear()
		nativeControls.requireNativeComponent.mockClear()
		nativeControls.shouldStartLoadWithLockIdentifier.mockClear()

		let renderer: ReactTestRenderer | undefined
		try {
			await act(async () => {
				renderer = create(
					createElement(FileVideo, {
						uri: props.sourceUri,
						settings: props,
						visible: false,
						style: {},
					}),
				)
			})
			const mountedRenderer = renderer
			if (!mountedRenderer)
				throw new Error('FileVideo renderer was not created')
			expect(mountedRenderer.toJSON()).toBeNull()
			expect(nativeControls.requireNativeComponent).not.toHaveBeenCalled()

			await act(async () => {
				mountedRenderer.update(
					createElement(FileVideo, {
						uri: props.sourceUri,
						settings: props,
						visible: true,
						style: {},
					}),
				)
			})
			const webView = mountedRenderer.root.findByType('RNCWebView')
			expect(webView.props.source).toMatchObject({
				baseUrl: 'file:///data/user/0/com.discord/cache/',
			})
			expect(webView.props.newSource).toBe(webView.props.source)
			expect(webView.props.mediaPlaybackRequiresUserAction).toBe(false)
			expect(webView.props.allowFileAccess).toBe(true)
			expect(webView.props.allowFileAccessFromFileURLs).toBe(false)
			expect(webView.props.allowUniversalAccessFromFileURLs).toBe(false)

			await act(async () => {
				webView.props.onShouldStartLoadWithRequest({
					nativeEvent: { lockIdentifier: 12 },
				})
			})
			expect(
				nativeControls.shouldStartLoadWithLockIdentifier,
			).toHaveBeenCalledWith(true, 12)
			const previousSource = webView.props.source
			await act(async () => {
				mountedRenderer.update(
					createElement(FileVideo, {
						uri: props.sourceUri,
						settings: { ...props, positionX: 75, positionY: 25 },
						visible: true,
						style: {},
					}),
				)
			})
			const movedSource =
				mountedRenderer.root.findByType('RNCWebView').props.source
			expect(movedSource).not.toBe(previousSource)
			expect(movedSource.html).toContain('object-position:25% 75%')
		} finally {
			if (renderer) {
				await act(async () => renderer?.unmount())
			}
		}
	})
})
