import { describe, expect, test } from 'bun:test'
import {
	base64SizeBytes,
	cacheRelativePath,
	DefaultSettings,
	isOverCacheLimit,
	shouldCacheRemoteAsset,
	isSupportedMediaUri,
	isVideoUri,
	normalizeSettings,
} from '../plugins/bgvideo-mobile/js/logic'

describe('BgVideo settings and media helpers', () => {
	test('normalizes transform and cache limits', () => {
		expect(
			normalizeSettings({ zoom: 20, positionX: -10, maxCacheMB: 0 }),
		).toMatchObject({
			zoom: 4,
			positionX: 0,
			maxCacheMB: 16,
		})
		expect(normalizeSettings(null)).toEqual(DefaultSettings)
	})

	test('supports file, content, and HTTP sources while rejecting YouTube', () => {
		expect(isSupportedMediaUri('https://cdn.example.com/wallpaper.mp4')).toBe(
			true,
		)
		expect(isSupportedMediaUri('content://media/video/42')).toBe(true)
		expect(
			isSupportedMediaUri('file:///storage/emulated/0/wallpaper.webp'),
		).toBe(true)
		expect(isSupportedMediaUri('https://youtu.be/example')).toBe(false)
	})

	test('detects video formats and keeps a stable cache path with extension', () => {
		expect(
			isVideoUri('https://cdn.example.com/wallpaper.webm?token=x', 'auto'),
		).toBe(true)
		expect(isVideoUri('content://media/item/42', 'video')).toBe(true)
		expect(
			cacheRelativePath('https://cdn.example.com/wallpaper.webm', 'auto'),
		).toMatch(/\.webm$/)
		expect(
			cacheRelativePath('https://cdn.example.com/wallpaper.webm', 'auto'),
		).toBe(cacheRelativePath('https://cdn.example.com/wallpaper.webm', 'auto'))
	})

	test('counts base64 bytes and enforces cache limit', () => {
		expect(base64SizeBytes('aGVsbG8=')).toBe(5)
		expect(isOverCacheLimit(17 * 1024 * 1024, 16)).toBe(true)
		expect(isOverCacheLimit(8 * 1024 * 1024, 16)).toBe(false)
	})

	test('skips base64 caching remote media without a known size', () => {
		expect(shouldCacheRemoteAsset('https://cdn.example/video.mp4', undefined, 16)).toBe(false)
		expect(shouldCacheRemoteAsset('https://cdn.example/video.mp4', 8 * 1024 * 1024, 16)).toBe(true)
		expect(shouldCacheRemoteAsset('https://cdn.example/video.mp4', 17 * 1024 * 1024, 16)).toBe(false)
		expect(shouldCacheRemoteAsset('content://media/video/42', undefined, 16)).toBe(true)
	})
})
