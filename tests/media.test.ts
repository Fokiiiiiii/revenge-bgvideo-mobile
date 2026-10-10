import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cacheRelativePath } from '../plugins/bgvideo-mobile/js/logic'
import { FileModule } from './runtime-mocks'
import type { CacheEntry, Settings } from '../plugins/bgvideo-mobile/js/logic'

const { resolveMediaSource } = await import(
	'../plugins/bgvideo-mobile/js/media'
)

const originalFetch = globalThis.fetch
const fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
	headResponse(5),
)

function headResponse(size?: number) {
	return {
		ok: true,
		headers: {
			get: (name: string) =>
				name.toLowerCase() === 'content-length' && size !== undefined
					? String(size)
					: null,
		},
	} as Response
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
	return {
		enabled: true,
		sourceUri: 'https://cdn.example/video.mp4',
		mediaType: 'video',
		zoom: 1,
		positionX: 0,
		positionY: 0,
		crop: true,
		loop: true,
		pauseInBackground: true,
		maxCacheMB: 16,
		transparentPanels: true,
		cache: null,
		...overrides,
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>(accept => {
		resolve = accept
	})
	return { promise, resolve }
}

function base64ForSize(sizeBytes: number) {
	return 'A'.repeat(Math.ceil(sizeBytes / 3) * 4)
}

function resetFileModuleMocks() {
	FileModule.fileExists.mockReset()
	FileModule.fileExists.mockImplementation(async () => false)
	FileModule.readAsset.mockReset()
	FileModule.readAsset.mockImplementation(async () => 'aGVsbG8=')
	FileModule.writeFile.mockReset()
	FileModule.writeFile.mockImplementation(
		async (_bucket, relativePath) => `/mock-cache/${relativePath}`,
	)
	FileModule.removeFile.mockReset()
	FileModule.removeFile.mockImplementation(async () => undefined)
}

beforeEach(() => {
	fetchMock.mockReset()
	fetchMock.mockImplementation(async () => headResponse(5))
	globalThis.fetch = fetchMock as unknown as typeof fetch
	resetFileModuleMocks()
})

afterEach(() => {
	fetchMock.mockReset()
	resetFileModuleMocks()
	globalThis.fetch = originalFetch
})

describe('BgVideo media source resolution', () => {
	test('caches a bounded remote file and returns its file URI', async () => {
		const result = await resolveMediaSource(makeSettings())

		expect(result.uri).toMatch(/^file:\/\//)
		expect(result.cache).toMatchObject({
			sourceUri: 'https://cdn.example/video.mp4',
			sizeBytes: 5,
		})
		expect(FileModule.readAsset).toHaveBeenCalledTimes(1)
		expect(FileModule.writeFile).toHaveBeenCalledTimes(1)
	})

	test('reuses a safe existing cache entry', async () => {
		const cache: CacheEntry = {
			sourceUri: 'https://cdn.example/video.mp4',
			relativePath: 'revenge-bgvideo/existing.mp4',
			fullPath: '/mock-cache/existing.mp4',
			sizeBytes: 5,
		}
		FileModule.fileExists.mockImplementation(async () => true)

		const result = await resolveMediaSource(makeSettings({ cache }))

		expect(result).toEqual({
			uri: 'file:///mock-cache/existing.mp4',
			cache,
		})
		expect(fetchMock).not.toHaveBeenCalled()
		expect(FileModule.readAsset).not.toHaveBeenCalled()
	})

	test('uses the direct source when the HEAD size is unknown or outside the cache bounds', async () => {
		fetchMock.mockImplementation(async () => headResponse(undefined))
		const unknown = await resolveMediaSource(makeSettings())
		expect(unknown).toEqual({
			uri: 'https://cdn.example/video.mp4',
			cache: null,
		})
		expect(FileModule.readAsset).not.toHaveBeenCalled()

		fetchMock.mockImplementation(async () => headResponse(40 * 1024 * 1024))
		const large = await resolveMediaSource(makeSettings({ maxCacheMB: 64 }))
		expect(large).toEqual({
			uri: 'https://cdn.example/video.mp4',
			cache: null,
		})
		expect(FileModule.readAsset).not.toHaveBeenCalled()
	})

	test('bounds decoded Base64 by the user limit and the 32 MiB hard limit', async () => {
		fetchMock.mockImplementation(async () => headResponse(1))
		FileModule.readAsset.mockImplementationOnce(async () =>
			base64ForSize(1024 * 1024 + 1),
		)
		const userLimitResult = await resolveMediaSource(
			makeSettings({ maxCacheMB: 1 }),
		)
		expect(userLimitResult).toEqual({
			uri: 'https://cdn.example/video.mp4',
			cache: null,
		})
		expect(FileModule.writeFile).not.toHaveBeenCalled()

		FileModule.readAsset.mockImplementationOnce(async () =>
			base64ForSize(32 * 1024 * 1024 + 1),
		)
		const hardLimitResult = await resolveMediaSource(
			makeSettings({ maxCacheMB: 64 }),
		)
		expect(hardLimitResult).toEqual({
			uri: 'https://cdn.example/video.mp4',
			cache: null,
		})
		expect(FileModule.writeFile).not.toHaveBeenCalled()
	})

	test('coalesces concurrent resolution and cache writes for the same input', async () => {
		const readStarted = deferred<void>()
		const releaseRead = deferred<string>()
		FileModule.readAsset.mockImplementation(() => {
			readStarted.resolve()
			return releaseRead.promise
		})

		const settings = makeSettings()
		const first = resolveMediaSource(settings)
		const second = resolveMediaSource({ ...settings })

		await readStarted.promise
		await new Promise(resolve => setTimeout(resolve, 0))
		const readsAtOnce = FileModule.readAsset.mock.calls.length
		releaseRead.resolve('aGVsbG8=')
		const results = await Promise.all([first, second])

		expect(readsAtOnce).toBe(1)
		expect(results[0]).toEqual(results[1])
		expect(FileModule.writeFile).toHaveBeenCalledTimes(1)
	})

	test('allows a later retry after a cache read failure', async () => {
		FileModule.readAsset.mockRejectedValueOnce(new Error('offline'))

		const failed = await resolveMediaSource(makeSettings())
		const retried = await resolveMediaSource(makeSettings())

		expect(failed).toEqual({
			uri: 'https://cdn.example/video.mp4',
			cache: null,
		})
		expect(retried.cache).not.toBeNull()
		expect(FileModule.readAsset).toHaveBeenCalledTimes(2)
	})

	test('does not remove a cache path another resolution is using', async () => {
		const remoteUri = 'https://cdn.example/video.mp4'
		const relativePath = cacheRelativePath(remoteUri, 'video')
		const readStarted = deferred<void>()
		const releaseRead = deferred<string>()
		FileModule.readAsset.mockImplementation((uri: string) => {
			if (uri === remoteUri) {
				readStarted.resolve()
				return releaseRead.promise
			}
			return Promise.resolve('aGVsbG8=')
		})

		const remote = resolveMediaSource(makeSettings({ sourceUri: remoteUri }))
		await readStarted.promise
		const local = await resolveMediaSource(
			makeSettings({
				sourceUri: 'content://media/video/42',
				cache: {
					sourceUri: 'https://cdn.example/old.mp4',
					relativePath,
					fullPath: `/mock-cache/${relativePath}`,
					sizeBytes: 5,
				},
			}),
		)

		expect(local.uri).toBe('content://media/video/42')
		expect(FileModule.removeFile).not.toHaveBeenCalled()
		releaseRead.resolve('aGVsbG8=')
		await remote
	})

	test('falls back after a timed out HEAD request', async () => {
		fetchMock.mockImplementation(
			(_input, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => reject(new Error('aborted')),
						{ once: true },
					)
				}),
		)

		const result = await resolveMediaSource(makeSettings())

		expect(result).toEqual({
			uri: 'https://cdn.example/video.mp4',
			cache: null,
		})
		expect(FileModule.readAsset).not.toHaveBeenCalled()
	})
})
