import { expect, mock, test } from 'bun:test'
import { act, createElement, forwardRef, memo } from 'react'
import { create } from 'react-test-renderer'
import { DefaultSettings } from '../plugins/bgvideo-mobile/js/logic'
import { FileModule, tokenFixture } from './runtime-mocks'
import type { ReactTestRenderer } from 'react-test-renderer'
import type { Settings } from '../plugins/bgvideo-mobile/js/logic'

const moduleExports = new Map<string, unknown>()
mock.module('@revenge-mod/modules/finders', () => ({
	getModules: (_filter: unknown, callback: (exports: unknown) => void) => {
		const exports = moduleExports.get('@screenHeaders')
		if (exports) callback(exports)
		return () => undefined
	},
}))
mock.module('@revenge-mod/modules/finders/filters', () => ({
	withProps: () => ({}),
}))

mock.module('@revenge-mod/discord/utils/modules/finders', () => ({
	getModuleWithImportedPath: (
		path: string,
		callback: (exports: unknown) => void,
	) => {
		const exports = moduleExports.get(path)
		if (exports) callback(exports)
		return () => undefined
	},
}))

mock.module('@revenge-mod/patcher', () => ({
	after: (
		target: Record<string, unknown>,
		key: string,
		transform: (result: unknown) => unknown,
	) => {
		const original = target[key]
		if (typeof original !== 'function') return () => undefined
		const patched = function (this: unknown, ...args: unknown[]) {
			return transform(Reflect.apply(original, this, args))
		}
		target[key] = patched
		return () => {
			if (target[key] === patched) target[key] = original
		}
	},
}))

type RuntimePlugin = {
	start(options: {
		cleanup(callback: () => void): void
		jsonStorage: {
			get(): Promise<Settings>
			set(value: Partial<Settings>): Promise<unknown>
			subscribe(listener: () => void): () => void
			cache: Settings
		}
	}): Promise<void>
}

function enableActEnvironment() {
	const hadValue = Reflect.has(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
	const previousValue = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
	Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
	return () => {
		if (hadValue)
			Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousValue)
		else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
	}
}

async function flushMediaEffects() {
	for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

async function loadPlugin(): Promise<RuntimePlugin> {
	const hadFactory = Reflect.has(globalThis, 'plugin')
	const previousFactory = Reflect.get(globalThis, 'plugin')
	Reflect.set(globalThis, 'plugin', (configuration: unknown) => configuration)
	try {
		const module = await import('../plugins/bgvideo-mobile/js/index')
		return module.default as unknown as RuntimePlugin
	} finally {
		if (hadFactory) Reflect.set(globalThis, 'plugin', previousFactory)
		else Reflect.deleteProperty(globalThis, 'plugin')
	}
}

async function startFixture(initial: Partial<Settings>) {
	FileModule.fileExists.mockClear()
	FileModule.readAsset.mockClear()
	FileModule.writeFile.mockClear()
	FileModule.removeFile.mockClear()
	const disposers: Array<() => void> = []
	let storedSettings: Settings = { ...DefaultSettings, ...initial }
	let notifyStorageChange = () => undefined
	let chatRenderCount = 0
	const style = { backgroundColor: 'rgba(0, 0, 0, 0.8)' }
	const ChatView = memo(function ChatView() {
		chatRenderCount += 1
		return createElement('View', {
			testID: 'chat-surface',
			visibleMessagesWindowHandler: () => undefined,
			style,
		})
	})
	const rootModule = {
		RootThemeContextProvider: () =>
			createElement('Root', null, createElement(ChatView)),
	}
	moduleExports.set(
		'modules/themes/RootThemeContextProvider.native.tsx',
		rootModule,
	)
	moduleExports.set('modules/chat/native/ChatView.tsx', { default: ChatView })
	const jsonStorage = {
		get: async () => storedSettings,
		set: async (value: Partial<Settings>) => {
			storedSettings = { ...storedSettings, ...value }
		},
		get cache() {
			return storedSettings
		},
		subscribe(listener: () => void) {
			notifyStorageChange = listener
			return () => {
				if (notifyStorageChange === listener)
					notifyStorageChange = () => undefined
			}
		},
	}
	const plugin = await loadPlugin()
	await plugin.start({
		cleanup: callback => disposers.push(callback),
		jsonStorage,
	})
	return {
		ChatView,
		RootEntry: () => rootModule.RootThemeContextProvider(),
		style,
		get chatRenderCount() {
			return chatRenderCount
		},
		updateSettings(value: Partial<Settings>) {
			storedSettings = { ...storedSettings, ...value }
			notifyStorageChange()
		},
		cleanup() {
			moduleExports.clear()
			for (const dispose of disposers.splice(0).reverse()) dispose()
		},
	}
}

function backgroundLayerCount(renderer: ReactTestRenderer) {
	return renderer.root.findAll(
		instance =>
			typeof instance.type === 'function' &&
			instance.type.name === 'BackgroundLayer',
	).length
}

function chatSurface(renderer: ReactTestRenderer) {
	return renderer.root.findByProps({ testID: 'chat-surface' })
}

test('mapped headers, status bar and member cards use their CSS shades and restore their exports', async () => {
	const restoreActEnvironment = enableActEnvironment()
	Reflect.set(globalThis, '__revengeNextClearVisionMobile', {
		panelColors: {
			header: 'rgba(10,15,33,0.46)',
			statusBar: 'transparent',
			memberCard: 'rgba(21,27,48,0.38)',
			memberList: 'rgba(9,14,31,0.22)',
		},
		refresh: () => {},
	})
	const header = forwardRef(() =>
		createElement('NativeHeader', {
			testID: 'native-header',
			backgroundColor: '#393a41',
		}),
	)
	const status = {
		default: () =>
			createElement('NativeStatus', {
				testID: 'status',
				backgroundColor: '#323339',
				barStyle: 'dark-content',
			}),
	}
	const card = {
		default: memo((props: { unstyled?: boolean }) =>
			createElement(
				'Card',
				{
					testID: props.unstyled ? 'unstyled-member-card' : 'member-card',
					style: props.unstyled ? undefined : { padding: 8 },
					height: 56,
				},
				createElement('Text', {
					testID: 'member-label',
					style: { color: 'white' },
				}),
			),
		),
	}
	const memberScreen = {
		default: memo(() =>
			createElement('View', {
				testID: 'member-screen',
				style: { backgroundColor: '#323339', flex: 1 },
			}),
		),
	}
	moduleExports.set(
		'modules/main_tabs_v2/native/sidebar/details/ChannelDetailsScreen.tsx',
		memberScreen,
	)
	moduleExports.set('@screenHeaders', { ScreenStackHeaderConfig: header })
	moduleExports.set(
		'modules/status_bar/native/components/ThemedStatusBar.tsx',
		status,
	)
	moduleExports.set(
		'modules/main_tabs_v2/native/shared_components/user_list/UserRow.tsx',
		card,
	)
	const usersList = forwardRef(() =>
		createElement('FastestList', {
			testID: 'thread-members',
			style: { flex: 1, backgroundColor: '#323339', paddingHorizontal: 16 },
			sections: [],
		}),
	)
	moduleExports.set(
		'modules/main_tabs_v2/native/shared_components/user_list/UsersFastList.tsx',
		{ UsersFastList: usersList },
	)
	const originalUsersList = usersList.render
	const originalHeader = header.render,
		originalStatus = status.default,
		originalCard = card.default.type
	const fixture = await startFixture({
		enabled: true,
		transparentPanels: true,
		sourceUri: 'file:///wallpaper.png',
	})
	let renderer: ReactTestRenderer | undefined
	try {
		await act(async () => {
			renderer = create(
				createElement(
					'Root',
					null,
					createElement(header),
					createElement(status.default),
					createElement(card.default),
					createElement(card.default, { unstyled: true }),
					createElement(memberScreen.default),
					createElement(usersList),
				),
			)
		})
		expect(
			renderer!.root.findByProps({ testID: 'native-header' }).props
				.backgroundColor,
		).toBe('rgba(10,15,33,0.46)')
		expect(
			renderer!.root.findByProps({ testID: 'status' }).props,
		).toMatchObject({
			backgroundColor: 'transparent',
			translucent: true,
			barStyle: 'light-content',
		})
		expect(
			renderer!.root.findByProps({ testID: 'thread-members' }).props.style,
		).toEqual([
			{ flex: 1, backgroundColor: '#323339', paddingHorizontal: 16 },
			{ backgroundColor: 'rgba(9,14,31,0.22)' },
		])
		const memberCard = renderer!.root.findByProps({
			testID: 'unstyled-member-card',
		})
		expect(memberCard.props.height).toBe(56)
		expect(memberCard.props.style).toEqual([
			{ padding: 0 },
			undefined,
			{ backgroundColor: 'rgba(21,27,48,0.38)' },
		])
		expect(
			renderer!.root.findByProps({ testID: 'member-card' }).props.style,
		).toEqual([
			{ padding: 0 },
			{ padding: 8 },
			{ backgroundColor: 'rgba(21,27,48,0.38)' },
		])
		expect(
			renderer!.root.findAllByProps({ testID: 'member-label' })[0]!.props.style,
		).toEqual({ color: 'white' })
		expect(
			renderer!.root.findByProps({ testID: 'member-screen' }).props.style,
		).toEqual([
			{ backgroundColor: '#323339', flex: 1 },
			{ backgroundColor: 'rgba(9,14,31,0.22)' },
		])
	} finally {
		if (renderer)
			await act(async () => {
				renderer!.unmount()
			})
		fixture.cleanup()
		Reflect.deleteProperty(globalThis, '__revengeNextClearVisionMobile')
		restoreActEnvironment()
	}
	expect(usersList.render).toBe(originalUsersList)
	expect(header.render).toBe(originalHeader)
	expect(status.default).toBe(originalStatus)
	expect(card.default.type).toBe(originalCard)
})

test('cached message backdrop uses ClearVision baseline colors when CSS loaded before BgVideo', async () => {
	const restoreActEnvironment = enableActEnvironment()
	const originalResolver = tokenFixture.default.internal.resolveSemanticColor
	const originalFabric = Reflect.get(globalThis, 'nativeFabricUIManager')
	const paint = mock(() => {})
	Reflect.set(globalThis, 'nativeFabricUIManager', { setNativeProps: paint })
	tokenFixture.default.internal.resolveSemanticColor = () => '#070b1a'
	Reflect.set(globalThis, '__revengeNextClearVisionMobile', {
		originalBackgroundColors: ['#323339'],
		refresh: () => {},
	})
	const node = {}
	const host = {
		__internalInstanceHandle: {
			tag: 5,
			type: 'RCTView',
			memoizedProps: { style: { flex: 1, backgroundColor: '#323339' } },
			stateNode: { node, canonical: { nativeTag: 11 } },
		},
	}
	const fixture = await startFixture({
		enabled: true,
		transparentPanels: true,
		sourceUri: 'file:///wallpaper.png',
		mediaType: 'image',
	})
	let renderer: ReactTestRenderer | undefined
	try {
		await act(async () => {
			renderer = create(createElement(fixture.RootEntry), {
				createNodeMock: () => host,
			})
			await flushMediaEffects()
		})
		await act(async () => {
			await new Promise(resolve => setTimeout(resolve, 5))
		})
		expect(paint).toHaveBeenCalledWith(node, { backgroundColor: 0 })
	} finally {
		if (renderer)
			await act(async () => {
				renderer!.unmount()
			})
		fixture.cleanup()
		tokenFixture.default.internal.resolveSemanticColor = originalResolver
		Reflect.deleteProperty(globalThis, '__revengeNextClearVisionMobile')
		if (originalFabric === undefined)
			Reflect.deleteProperty(globalThis, 'nativeFabricUIManager')
		else Reflect.set(globalThis, 'nativeFabricUIManager', originalFabric)
		restoreActEnvironment()
	}
})

test('ClearVision shading is a single overlay above the root video background and updates through the bridge', async () => {
	const restoreActEnvironment = enableActEnvironment()
	const shared = globalThis as typeof globalThis & {
		__revengeNextClearVisionMobile?: {
			backgroundOverlay: string
			refresh: () => void
		}
		__revengeNextBgVideoMobile?: { refresh: () => void }
	}
	const refresh = mock(() => {})
	shared.__revengeNextClearVisionMobile = {
		backgroundOverlay: 'rgba(7,11,26,0.68)',
		refresh,
	}
	const fixture = await startFixture({
		enabled: true,
		transparentPanels: true,
		sourceUri: 'file:///wallpaper.png',
		mediaType: 'image',
	})
	let renderer: ReactTestRenderer | undefined
	try {
		await act(async () => {
			renderer = create(createElement(fixture.RootEntry))
			await flushMediaEffects()
		})
		expect(
			renderer!.root.findAllByProps({ testID: 'revenge-bgvideo-shading' }),
		).toHaveLength(1)
		expect(
			renderer!.root
				.findByProps({ testID: 'revenge-bgvideo-shading' })
				.props.style.at(-1).backgroundColor,
		).toBe('rgba(7,11,26,0.68)')
		await act(async () => {
			shared.__revengeNextClearVisionMobile!.backgroundOverlay =
				'rgba(5,8,23,0.73)'
			shared.__revengeNextBgVideoMobile!.refresh()
		})
		expect(
			renderer!.root
				.findByProps({ testID: 'revenge-bgvideo-shading' })
				.props.style.at(-1).backgroundColor,
		).toBe('rgba(5,8,23,0.73)')
		expect(refresh.mock.calls.length).toBeGreaterThan(1)
	} finally {
		if (renderer)
			await act(async () => {
				renderer!.unmount()
			})
		fixture.cleanup()
		shared.__revengeNextClearVisionMobile = undefined
		restoreActEnvironment()
	}
})

test('mapped channel and bottom panels keep their render backgrounds transparent and restore on disable', async () => {
	const restoreActEnvironment = enableActEnvironment()
	const paths = [
		'modules/channel_list_v2/native/components/ChannelListPanelBackdrop.tsx',
		'modules/channel_list_v2/native/RedesignGuildHeader.tsx',
		'modules/main_tabs_v2/native/you_bar/YouBarFloatingShade.tsx',
		'modules/main_tabs_v2/native/you_bar/YouBarBackground.tsx',
	]
	const originals = paths.map(
		(_, index) =>
			function Panel() {
				return createElement(
					'View',
					{ testID: `panel-${index}`, style: { backgroundColor: '#323339' } },
					createElement('View', {
						testID: `button-${index}`,
						style: { backgroundColor: '#ff0000' },
					}),
				)
			},
	)
	const modules = originals.map((component, index) => ({
		default: index ? memo(component) : component,
	}))
	paths.forEach((path, index) => moduleExports.set(path, modules[index]))
	const fixture = await startFixture({
		enabled: true,
		transparentPanels: true,
		sourceUri: 'file:///wallpaper.png',
	})
	let renderer: ReactTestRenderer | undefined
	try {
		await act(async () => {
			renderer = create(
				createElement(
					'Root',
					null,
					modules.map((module, index) =>
						createElement(module.default, { key: index }),
					),
				),
			)
		})
		for (let index = 0; index < paths.length; index++) {
			expect(
				renderer!.root.findByProps({ testID: `panel-${index}` }).props.style,
			).toEqual([
				{ backgroundColor: '#323339' },
				{ backgroundColor: 'transparent' },
			])
			expect(
				renderer!.root.findByProps({ testID: `button-${index}` }).props.style,
			).toEqual({ backgroundColor: '#ff0000' })
		}
		expect(backgroundLayerCount(renderer!)).toBe(0)
		const shared = globalThis as typeof globalThis & {
			__revengeNextClearVisionMobile?: unknown
		}
		shared.__revengeNextClearVisionMobile = {
			panelColors: {
				card: 'rgba(16,20,39,0.64)',
				input: 'rgba(10,15,33,0.74)',
			},
			refresh: () => {},
		}
		await act(async () => {
			fixture.updateSettings({ transparentPanels: true })
		})
		for (let index = 0; index < paths.length; index++) {
			const color =
				index === 0
					? 'transparent'
					: index === 2
						? 'rgba(10,15,33,0.74)'
						: 'rgba(16,20,39,0.64)'
			expect(
				renderer!.root.findByProps({ testID: `panel-${index}` }).props.style,
			).toEqual([{ backgroundColor: '#323339' }, { backgroundColor: color }])
		}
		await act(async () => {
			fixture.updateSettings({ enabled: false })
		})
		for (let index = 0; index < paths.length; index++)
			expect(
				renderer!.root.findByProps({ testID: `panel-${index}` }).props.style,
			).toEqual({ backgroundColor: '#323339' })
	} finally {
		if (renderer)
			await act(async () => {
				renderer!.unmount()
			})
		fixture.cleanup()
		restoreActEnvironment()
	}
	Reflect.deleteProperty(globalThis, '__revengeNextClearVisionMobile')
	expect(modules[0]!.default).toBe(originals[0])
	for (let index = 1; index < modules.length; index++)
		expect((modules[index]!.default as { type: unknown }).type).toBe(
			originals[index],
		)
})

test('mounted memoized ChatView reacts to enabled and transparentPanels storage changes', async () => {
	const restoreActEnvironment = enableActEnvironment()
	const fixture = await startFixture({
		enabled: true,
		transparentPanels: false,
		sourceUri: 'file:///storage/emulated/0/bgvideo-wallpaper.png',
		mediaType: 'image',
	})
	let renderer: ReactTestRenderer | undefined
	try {
		await act(async () => {
			renderer = create(createElement(fixture.ChatView))
			await flushMediaEffects()
		})
		expect(chatSurface(renderer!).props.style).toBe(fixture.style)
		expect(backgroundLayerCount(renderer!)).toBe(0)
		const initialRenderCount = fixture.chatRenderCount

		await act(async () => {
			fixture.updateSettings({ transparentPanels: true })
			await flushMediaEffects()
		})
		expect(
			tokenFixture.SemanticColor.BACKGROUND_BASE_LOWEST!.dark.opacity,
		).toBe(0)
		expect(fixture.chatRenderCount).toBeGreaterThan(initialRenderCount)
		expect(chatSurface(renderer!).props.style).toEqual([
			fixture.style,
			{ backgroundColor: 'transparent' },
		])
		expect(backgroundLayerCount(renderer!)).toBe(1)
		expect(renderer!.root.findAllByType('Image')).toHaveLength(1)

		await act(async () => {
			fixture.updateSettings({ enabled: false })
			await flushMediaEffects()
		})
		expect(chatSurface(renderer!).props.style).toBe(fixture.style)
		expect(backgroundLayerCount(renderer!)).toBe(0)
		expect(renderer!.root.findAllByType('Image')).toHaveLength(0)
		expect(
			tokenFixture.SemanticColor.BACKGROUND_BASE_LOWEST!.dark.opacity,
		).toBe(1)
		expect(FileModule.readAsset).not.toHaveBeenCalled()
	} finally {
		if (renderer)
			await act(async () => {
				renderer!.unmount()
			})
		fixture.cleanup()
		restoreActEnvironment()
	}
})

test('root subtree has one background while an outside ChatView gets its fallback', async () => {
	const restoreActEnvironment = enableActEnvironment()
	const fixture = await startFixture({
		enabled: true,
		transparentPanels: true,
		sourceUri: 'file:///storage/emulated/0/bgvideo-wallpaper.png',
		mediaType: 'image',
	})
	let rootRenderer: ReactTestRenderer | undefined
	let outsideRenderer: ReactTestRenderer | undefined
	try {
		await act(async () => {
			rootRenderer = create(createElement(fixture.RootEntry))
			await flushMediaEffects()
		})
		expect(backgroundLayerCount(rootRenderer!)).toBe(1)
		expect(rootRenderer!.root.findAllByType('Image')).toHaveLength(1)

		await act(async () => {
			outsideRenderer = create(createElement(fixture.ChatView))
			await flushMediaEffects()
		})
		expect(backgroundLayerCount(outsideRenderer!)).toBe(1)
		expect(outsideRenderer!.root.findAllByType('Image')).toHaveLength(1)
	} finally {
		for (const renderer of [outsideRenderer, rootRenderer]) {
			if (renderer)
				await act(async () => {
					renderer.unmount()
				})
		}
		fixture.cleanup()
		restoreActEnvironment()
	}
})
