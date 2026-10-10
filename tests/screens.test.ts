import { describe, expect, mock, test } from 'bun:test'
import { createScreenPainter } from '../plugins/bgvideo-mobile/js/screens'

const flatten = (value: unknown) =>
	value as { flex?: number; backgroundColor?: unknown } | undefined
const processColor = (value: unknown) =>
	({
		'#323339': 0xff323339,
		'#32333900': 0x323339,
		transparent: 0,
		'#ff0000': 0xffff0000,
	})[String(value) as '#323339']

describe('mounted background surfaces', () => {
	test('paints only matching full-screen native Views and restores original colors', () => {
		const paint = mock(() => {})
		const node = {}
		const view = {
			tag: 5,
			type: 'RCTView',
			memoizedProps: { style: { flex: 1, backgroundColor: '#323339' } },
			stateNode: { node, canonical: { nativeTag: 1 } },
		}
		const button = {
			tag: 5,
			type: 'RCTView',
			memoizedProps: { style: { backgroundColor: '#323339' } },
			stateNode: { node: {}, canonical: { nativeTag: 2 } },
		}
		const root = { child: view }
		const host = { __internalInstanceHandle: { return: root } }
		Object.assign(view, { sibling: button })
		const controller = createScreenPainter(flatten, processColor, paint)
		expect(controller.apply(host, true, ['#323339'])).toBe(1)
		expect(paint).toHaveBeenLastCalledWith(node, { backgroundColor: 0 })
		controller.restore()
		expect(paint).toHaveBeenLastCalledWith(node, {
			backgroundColor: 0xff323339,
		})
	})

	test('restores a token-resolved alpha-zero background when disabled', () => {
		const paint = mock(() => {})
		const node = {}
		const view = {
			tag: 5,
			type: 'RCTView',
			memoizedProps: { style: { flex: 1, backgroundColor: '#32333900' } },
			stateNode: { node, canonical: { nativeTag: 3 } },
		}
		const controller = createScreenPainter(flatten, processColor, paint)
		expect(
			controller.apply({ __internalInstanceHandle: view }, false, ['#323339']),
		).toBe(1)
		expect(paint).toHaveBeenCalledWith(node, { backgroundColor: 0xff323339 })
	})

	test('leaves intentional transparency, images and unrelated colors unchanged', () => {
		const paint = mock(() => {})
		const nodes = ['transparent', '#ff0000', '#323339'].map(
			(backgroundColor, index) => ({
				tag: 5,
				type: index === 2 ? 'RCTImageView' : 'RCTView',
				memoizedProps: { style: { flex: 1, backgroundColor } },
				stateNode: { node: {}, canonical: { nativeTag: index } },
			}),
		)
		Object.assign(nodes[0]!, { sibling: nodes[1] })
		Object.assign(nodes[1]!, { sibling: nodes[2] })
		const controller = createScreenPainter(flatten, processColor, paint)
		expect(
			controller.apply({ __internalInstanceHandle: nodes[0] }, true, [
				'#323339',
			]),
		).toBe(0)
		expect(paint).not.toHaveBeenCalled()
		expect(controller.apply(null, true, ['#323339'])).toBe(0)
	})
})
