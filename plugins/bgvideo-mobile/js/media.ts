import { FileModule } from '@revenge-mod/discord/native'
import {
	base64SizeBytes,
	cacheRelativePath,
	isOverCacheLimit,
	isSupportedMediaUri,
	shouldCacheRemoteAsset,
} from './logic'
import type { CacheEntry, Settings } from './logic'

const MEBIBYTE = 1024 * 1024
const MAX_CACHE_MB = 32
const HEAD_TIMEOUT_MS = 1_000

type MediaResolution = {
	uri: string | null
	cache: CacheEntry | null
}

const inFlightResolutions = new Map<string, Promise<MediaResolution>>()
const activeCachePaths = new Map<string, number>()
const pendingCacheRemovals = new Map<string, Promise<void>>()

function trackCachePaths(
	value: Settings,
	targetRelativePath: string,
): Set<string> {
	const paths = new Set([targetRelativePath])
	if (value.cache?.relativePath) paths.add(value.cache.relativePath)
	for (const path of paths)
		activeCachePaths.set(path, (activeCachePaths.get(path) ?? 0) + 1)
	return paths
}

function untrackCachePaths(paths: ReadonlySet<string>) {
	for (const path of paths) {
		const activeCount = activeCachePaths.get(path) ?? 0
		if (activeCount <= 1) activeCachePaths.delete(path)
		else activeCachePaths.set(path, activeCount - 1)
	}
}

async function waitForCacheRemovals(paths: ReadonlySet<string>) {
	await Promise.all([...paths].map(path => pendingCacheRemovals.get(path)))
}

function toFileUri(path: string) {
	return path.startsWith('file://') ? path : `file://${path}`
}

async function removeCachedFile(
	entry: CacheEntry | null,
	targetRelativePath: string,
	ownedPaths: ReadonlySet<string>,
) {
	if (!entry || entry.relativePath === targetRelativePath) return
	const activeCount = activeCachePaths.get(entry.relativePath) ?? 0
	const otherActiveCount =
		activeCount - Number(ownedPaths.has(entry.relativePath))
	if (otherActiveCount > 0) return

	const pending = pendingCacheRemovals.get(entry.relativePath)
	if (pending) {
		await pending
		return
	}

	const removal = Promise.resolve()
		.then(() => FileModule.removeFile('cache', entry.relativePath))
		.then(
			() => undefined,
			() => undefined,
		)
	pendingCacheRemovals.set(entry.relativePath, removal)
	try {
		await removal
	} finally {
		if (pendingCacheRemovals.get(entry.relativePath) === removal)
			pendingCacheRemovals.delete(entry.relativePath)
	}
}

async function contentLength(uri: string) {
	if (!/^https?:\/\//i.test(uri)) return undefined
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		const controller = new AbortController()
		const timeoutResponse = new Promise<undefined>(resolve => {
			timeout = setTimeout(() => {
				controller.abort()
				resolve(undefined)
			}, HEAD_TIMEOUT_MS)
		})
		const response = await Promise.race([
			fetch(uri, { method: 'HEAD', signal: controller.signal }),
			timeoutResponse,
		])
		if (!response?.ok) return undefined
		const value = Number(response.headers.get('content-length'))
		return Number.isFinite(value) && value > 0 ? value : undefined
	} catch {
		return undefined
	} finally {
		if (timeout !== undefined) clearTimeout(timeout)
	}
}

export function resolveMediaSource(value: Settings): Promise<MediaResolution> {
	const sourceUri = value.sourceUri.trim()
	if (!sourceUri || !isSupportedMediaUri(sourceUri))
		return Promise.resolve({ uri: null, cache: null })

	const targetRelativePath = cacheRelativePath(sourceUri, value.mediaType)
	const key = JSON.stringify([
		sourceUri,
		String(value.maxCacheMB),
		value.mediaType,
		targetRelativePath,
		value.cache?.sourceUri ?? null,
		value.cache?.relativePath ?? null,
		value.cache?.fullPath ?? null,
		value.cache?.sizeBytes ?? null,
	])
	const existingResolution = inFlightResolutions.get(key)
	if (existingResolution) return existingResolution

	const ownedPaths = trackCachePaths(value, targetRelativePath)
	let resolution!: Promise<MediaResolution>
	resolution = (async () => {
		await waitForCacheRemovals(ownedPaths)
		const cacheLimitMB = Math.min(
			Number.isFinite(value.maxCacheMB) ? Math.max(0, value.maxCacheMB) : 0,
			MAX_CACHE_MB,
		)
		const maxBytes = cacheLimitMB * MEBIBYTE
		const existing = value.cache?.sourceUri === sourceUri ? value.cache : null

		if (
			existing &&
			Number.isFinite(existing.sizeBytes) &&
			existing.sizeBytes >= 0 &&
			existing.sizeBytes <= maxBytes
		) {
			try {
				if (await FileModule.fileExists(existing.fullPath))
					return { uri: toFileUri(existing.fullPath), cache: existing }
			} catch {}
		}

		const expectedSize = await contentLength(sourceUri)
		if (!shouldCacheRemoteAsset(sourceUri, expectedSize, cacheLimitMB)) {
			if (value.cache?.sourceUri !== sourceUri)
				await removeCachedFile(value.cache, targetRelativePath, ownedPaths)
			return { uri: sourceUri, cache: null }
		}

		try {
			// shortcut: FileModule returns a whole Base64 file; replace with native streaming when available.
			const data = await FileModule.readAsset(sourceUri, 'base64')
			const sizeBytes = base64SizeBytes(data)
			if (isOverCacheLimit(sizeBytes, cacheLimitMB)) {
				if (value.cache)
					await removeCachedFile(value.cache, targetRelativePath, ownedPaths)
				return { uri: sourceUri, cache: null }
			}

			const fullPath = await FileModule.writeFile(
				'cache',
				targetRelativePath,
				data,
				'base64',
			)
			const cache = {
				sourceUri,
				relativePath: targetRelativePath,
				fullPath,
				sizeBytes,
			}
			if (value.cache && value.cache.relativePath !== targetRelativePath)
				await removeCachedFile(value.cache, targetRelativePath, ownedPaths)
			return { uri: toFileUri(fullPath), cache }
		} catch {
			if (value.cache?.sourceUri !== sourceUri)
				await removeCachedFile(value.cache, targetRelativePath, ownedPaths)
			return { uri: sourceUri, cache: null }
		}
	})().finally(() => {
		untrackCachePaths(ownedPaths)
		if (inFlightResolutions.get(key) === resolution)
			inFlightResolutions.delete(key)
	})
	inFlightResolutions.set(key, resolution)
	return resolution
}
