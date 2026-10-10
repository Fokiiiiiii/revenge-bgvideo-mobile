import { describe, expect, test } from 'bun:test'
import {
	buildVideoHtml,
	imageFrame,
	mediaTransform,
} from '../plugins/bgvideo-mobile/js/logic'

describe('mediaTransform', () => {
	test('uses the full crop excess at zoom 1 and 2', () => {
		expect(
			mediaTransform(
				{ zoom: 1, positionX: 0, positionY: 100, crop: true },
				400,
				800,
			),
		).toEqual([1, 0, 0])
		expect(
			mediaTransform(
				{ zoom: 2, positionX: 0, positionY: 100, crop: true },
				400,
				800,
			),
		).toEqual([2, -100, 200])
		expect(
			mediaTransform(
				{ zoom: 2, positionX: 50, positionY: 50, crop: true },
				400,
				800,
			),
		).toEqual([2, 0, 0])
	})

	test('pans wide cover excess at positions 0, 50, and 100 for zoom 1 and 2', () => {
		const viewport = { width: 400, height: 800 }
		const source = { width: 1920, height: 1080 }
		const positions = [
			{ value: 0, normalized: -1 },
			{ value: 50, normalized: 0 },
			{ value: 100, normalized: 1 },
		]

		for (const zoom of [1, 2]) {
			const centered = imageFrame(
				{ zoom, positionX: 50, positionY: 50, crop: true },
				viewport.width,
				viewport.height,
				source,
			)
			expect(centered.width).toBeCloseTo(1422.2222)
			expect(centered.height).toBe(800)
			expect(centered.left).toBeCloseTo(-511.1111)
			expect(centered.top).toBe(0)

			for (const { value, normalized } of positions) {
				const horizontalSettings = {
					zoom,
					positionX: value,
					positionY: 50,
					crop: true,
				}
				const horizontal = imageFrame(
					horizontalSettings,
					viewport.width,
					viewport.height,
					source,
				)
				expect(horizontal.transform[1].translateX).toBeCloseTo(
					normalized *
						((zoom * horizontal.width - viewport.width) / (2 * zoom)),
				)

				const nativeTransform = mediaTransform(
					horizontalSettings,
					viewport.width,
					viewport.height,
				)
				const videoOffset =
					(zoom * (normalized * (horizontal.width - viewport.width))) / 2 +
					zoom * nativeTransform[1]
				expect(videoOffset).toBeCloseTo(
					zoom * horizontal.transform[1].translateX,
				)

				const verticalSettings = {
					zoom,
					positionX: 50,
					positionY: value,
					crop: true,
				}
				const vertical = imageFrame(
					verticalSettings,
					viewport.width,
					viewport.height,
					source,
				)
				expect(vertical.transform[2].translateY).toBeCloseTo(
					normalized *
						((zoom * vertical.height - viewport.height) / (2 * zoom)),
				)
				const verticalNativeTransform = mediaTransform(
					verticalSettings,
					viewport.width,
					viewport.height,
				)
				const videoVerticalOffset =
					(zoom * (normalized * (vertical.height - viewport.height))) / 2 +
					zoom * verticalNativeTransform[2]
				expect(videoVerticalOffset).toBeCloseTo(
					zoom * vertical.transform[2].translateY,
				)
			}
		}
	})

	test('fits contain media inside the viewport and preserves its 18% translation', () => {
		const frame = imageFrame(
			{ zoom: 1, positionX: 0, positionY: 100, crop: false },
			400,
			800,
			{ width: 1920, height: 1080 },
		)

		expect(frame.width).toBe(400)
		expect(frame.height).toBe(225)
		expect(frame.left).toBe(0)
		expect(frame.top).toBe(287.5)
		expect(frame.transform).toEqual([
			{ scale: 1 },
			{ translateX: -72 },
			{ translateY: 144 },
		])
	})

	test('falls back to a viewport-sized image frame without valid source dimensions', () => {
		const settings = {
			zoom: 2,
			positionX: 0,
			positionY: 100,
			crop: true,
		}
		const viewportFrame = imageFrame(settings, 400, 800)

		expect(viewportFrame).toEqual({
			position: 'absolute',
			width: 400,
			height: 800,
			left: 0,
			top: 0,
			transform: [{ scale: 2 }, { translateX: -100 }, { translateY: 200 }],
		})
		expect(imageFrame(settings, 400, 800, { width: 0, height: 1080 })).toEqual(
			viewportFrame,
		)
	})

	test('anchors cropped video to inverse settings and keeps contain centered', () => {
		const uri = 'https://cdn.example/video.mp4'
		const crop = buildVideoHtml(uri, {
			crop: true,
			loop: true,
			positionX: 0,
			positionY: 100,
		})
		const contain = buildVideoHtml(uri, {
			crop: false,
			loop: true,
			positionX: 0,
			positionY: 100,
		})

		expect(crop).toContain('object-position:100% 0%')
		expect(contain).toContain('object-position:50% 50%')
	})
})
