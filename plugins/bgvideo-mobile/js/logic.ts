export interface CacheEntry {
	sourceUri: string
	relativePath: string
	fullPath: string
	sizeBytes: number
}

export interface Settings {
	enabled: boolean
	sourceUri: string
	mediaType: 'auto' | 'image' | 'video'
	zoom: number
	positionX: number
	positionY: number
	crop: boolean
	loop: boolean
	pauseInBackground: boolean
	maxCacheMB: number
	transparentPanels: boolean
	cache: CacheEntry | null
}

export const DefaultSettings: Settings = {
	enabled: false,
	sourceUri: '',
	mediaType: 'auto',
	zoom: 1,
	positionX: 50,
	positionY: 50,
	crop: true,
	loop: true,
	pauseInBackground: true,
	maxCacheMB: 256,
	transparentPanels: true,
	cache: null,
}

function boundedNumber(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
) {
	const number = typeof value === 'number' ? value : Number(value)
	return Number.isFinite(number)
		? Math.min(max, Math.max(min, number))
		: fallback
}

export function normalizeSettings(value: unknown): Settings {
	const source =
		value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
	const rawCache =
		source.cache && typeof source.cache === 'object'
			? (source.cache as Record<string, unknown>)
			: null
	const cache =
		rawCache &&
		typeof rawCache.sourceUri === 'string' &&
		typeof rawCache.relativePath === 'string' &&
		typeof rawCache.fullPath === 'string' &&
		typeof rawCache.sizeBytes === 'number'
			? {
					sourceUri: rawCache.sourceUri,
					relativePath: rawCache.relativePath,
					fullPath: rawCache.fullPath,
					sizeBytes: Math.max(0, rawCache.sizeBytes),
				}
			: null
	return {
		enabled:
			typeof source.enabled === 'boolean'
				? source.enabled
				: DefaultSettings.enabled,
		sourceUri:
			typeof source.sourceUri === 'string'
				? source.sourceUri.trim()
				: DefaultSettings.sourceUri,
		mediaType:
			source.mediaType === 'image' || source.mediaType === 'video'
				? source.mediaType
				: 'auto',
		zoom: boundedNumber(source.zoom, DefaultSettings.zoom, 1, 4),
		positionX: boundedNumber(
			source.positionX,
			DefaultSettings.positionX,
			0,
			100,
		),
		positionY: boundedNumber(
			source.positionY,
			DefaultSettings.positionY,
			0,
			100,
		),
		crop: typeof source.crop === 'boolean' ? source.crop : DefaultSettings.crop,
		loop: typeof source.loop === 'boolean' ? source.loop : DefaultSettings.loop,
		pauseInBackground:
			typeof source.pauseInBackground === 'boolean'
				? source.pauseInBackground
				: DefaultSettings.pauseInBackground,
		maxCacheMB: boundedNumber(
			source.maxCacheMB,
			DefaultSettings.maxCacheMB,
			16,
			1024,
		),
		transparentPanels:
			typeof source.transparentPanels === 'boolean'
				? source.transparentPanels
				: DefaultSettings.transparentPanels,
		cache,
	}
}

export function isSupportedMediaUri(value: string): boolean {
	if (
		/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)(?:\/|$)/i.test(
			value.trim(),
		)
	)
		return false
	return /^(?:https?:\/\/|file:\/\/|content:\/\/)/i.test(value.trim())
}

export function isVideoUri(
	uri: string,
	mediaType: Settings['mediaType'],
): boolean {
	if (mediaType === 'video') return true
	if (mediaType === 'image') return false
	return /\.(?:mp4|webm|m4v|mov)(?:$|[?#])/i.test(uri)
}

export function cacheRelativePath(
	uri: string,
	mediaType: Settings['mediaType'],
): string {
	let hash = 2166136261
	for (let index = 0; index < uri.length; index++) {
		hash ^= uri.charCodeAt(index)
		hash = Math.imul(hash, 16777619)
	}
	const path = uri.split(/[?#]/, 1)[0].toLowerCase()
	const extension =
		path.match(/\.(mp4|webm|m4v|mov|png|jpe?g|webp|gif)$/)?.[1] ??
		(isVideoUri(uri, mediaType) ? 'mp4' : 'img')
	return `revenge-bgvideo/${(hash >>> 0).toString(16)}.${extension}`
}

export function base64SizeBytes(value: string): number {
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
	return Math.max(0, Math.floor((value.length * 3) / 4) - padding)
}

export function isOverCacheLimit(
	sizeBytes: number,
	maxCacheMB: number,
): boolean {
	return sizeBytes > maxCacheMB * 1024 * 1024
}

export function resolveVideoComponentExport(value: unknown): unknown {
	const moduleExport =
		value && typeof value === 'object'
			? (value as Record<string, unknown>)
			: undefined
	const defaultExport = moduleExport?.default
	const videoExport = moduleExport?.Video
	const defaultValue =
		defaultExport && typeof defaultExport === 'object'
			? (defaultExport as Record<string, unknown>)
			: undefined
	const videoValue =
		videoExport && typeof videoExport === 'object'
			? (videoExport as Record<string, unknown>)
			: undefined
	const candidates = [
		defaultValue?.default,
		defaultValue?.type,
		defaultExport,
		videoValue?.default,
		videoValue?.type,
		videoExport,
		moduleExport?.type,
		value,
	]
	return candidates.find(candidate => {
		if (typeof candidate === 'function') return true
		if (!candidate || typeof candidate !== 'object') return false
		const type = (candidate as { $$typeof?: unknown }).$$typeof
		return (
			type === Symbol.for('react.forward_ref') ||
			type === Symbol.for('react.memo') ||
			type === Symbol.for('react.lazy')
		)
	})
}

export function resolveVideoComponentModule(value: unknown): unknown {
	try {
		const moduleExport =
			value && (typeof value === 'object' || typeof value === 'function')
				? (value as Record<string, unknown>)
				: undefined
		const getVideoComponent = moduleExport?.getVideoComponent
		return typeof getVideoComponent === 'function'
			? resolveVideoComponentExport(getVideoComponent.call(value))
			: undefined
	} catch {
		return undefined
	}
}

export function shouldCacheRemoteAsset(
	uri: string,
	expectedSize: number | undefined,
	maxCacheMB: number,
) {
	if (!/^https?:\/\//i.test(uri)) return true
	return (
		expectedSize !== undefined &&
		Number.isFinite(expectedSize) &&
		expectedSize > 0 &&
		!isOverCacheLimit(expectedSize, maxCacheMB)
	)
}
