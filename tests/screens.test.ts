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
	test('does not erase the video shading overlay inside its own background host', () => {
		const paint = mock(() => {})
		const shade = {
			tag: 5,
			type: 'RCTView',
			memoizedProps: {
				style: {
					position: 'absolute',
					left: 0,
					right: 0,
					top: 0,
					bottom: 0,
					backgroundColor: '#323339',
				},
			},
			stateNode: { node: { id: 'shade' }, canonical: { nativeTag: 4 } },
		}
		const screen = {
			tag: 5,
			type: 'RCTView',
			memoizedProps: { style: { flex: 1, backgroundColor: '#323339' } },
			stateNode: { node: { id: 'screen' }, canonical: { nativeTag: 1 } },
		}
		const background = {
			tag: 5,
			type: 'RCTView',
			stateNode: { node: {}, canonical: { nativeTag: 3 } },
			child: shade,
			sibling: screen,
		}
		const host = { __nativeTag: 3, __internalInstanceHandle: background }
		const controller = createScreenPainter(flatten, processColor, paint)
		expect(controller.apply(host, true, ['#323339'])).toBe(1)
		expect(paint).toHaveBeenCalledWith(screen.stateNode.node, {
			backgroundColor: 0,
		})
		expect(paint).not.toHaveBeenCalledWith(shade.stateNode.node, {
			backgroundColor: 0,
		})
	})
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

	test('paints a channel absolute-fill backdrop and restores it without touching partial overlays', () => {
		const paint = mock(() => {})
		const node = {}
		const style = {
			position: 'absolute',
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
			backgroundColor: '#323339',
		}
		const view = {
			tag: 5,
			type: 'RCTView',
			memoizedProps: { style },
			stateNode: { node, canonical: { nativeTag: 7 } },
		}
		const partial = {
			tag: 5,
			type: 'RCTView',
			memoizedProps: { style: { ...style, bottom: 60 } },
			stateNode: { node: {}, canonical: { nativeTag: 8 } },
		}
		Object.assign(view, { sibling: partial })
		const controller = createScreenPainter(flatten, processColor, paint)
		const host = { __internalInstanceHandle: view }
		expect(controller.apply(host, true, ['#323339'])).toBe(1)
		expect(paint).toHaveBeenLastCalledWith(node, { backgroundColor: 0 })
		expect(controller.apply(host, false, ['#323339'])).toBe(1)
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
