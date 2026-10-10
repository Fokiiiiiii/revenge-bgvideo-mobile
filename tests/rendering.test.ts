import { expect, mock, test } from 'bun:test'
import { act, createElement, memo } from 'react'
import { create } from 'react-test-renderer'
import { DefaultSettings } from '../plugins/bgvideo-mobile/js/logic'
import { FileModule } from './runtime-mocks'
import type { ReactTestRenderer } from 'react-test-renderer'
import type { Settings } from '../plugins/bgvideo-mobile/js/logic'

const moduleExports = new Map<string, unknown>()

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
