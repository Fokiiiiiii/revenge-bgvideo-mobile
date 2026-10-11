type Fiber = {
	tag?: number
	type?: unknown
	return?: Fiber
	child?: Fiber
	sibling?: Fiber
	memoizedProps?: { style?: unknown }
	stateNode?: {
		current?: Fiber
		node?: unknown
		canonical?: { nativeTag?: number }
	}
}

type NativePaint = (node: unknown, props: { backgroundColor: number }) => void
type Style = {
	flex?: number
	backgroundColor?: unknown
	position?: string
	left?: number
	right?: number
	top?: number
	bottom?: number
}

export function createScreenPainter(
	flatten: (style: unknown) => Style | undefined,
	processColor: (color: unknown) => unknown,
	paint: NativePaint,
) {
	const saved = new Map<number, { node: unknown; color: number }>()
	return {
		apply(host: unknown, active: boolean, colors: string[]) {
			let root = (host as { __internalInstanceHandle?: Fiber } | null)
				?.__internalInstanceHandle
			if (!root) return 0
			const backgroundTag = (host as { __nativeTag?: number }).__nativeTag
			for (let depth = 0; root.return && depth < 1000; depth++)
				root = root.return
			root = root.stateNode?.current ?? root
			const palette = new Map<number, number>()
			for (const color of colors) {
				const value = processColor(color)
				if (typeof value === 'number') {
					const old = palette.get(value & 0xffffff)
					if (old === undefined || value >>> 24 > old >>> 24)
						palette.set(value & 0xffffff, value)
				}
			}
			const stack = [root]
			const seen = new Set<number>()
			let visited = 0
			let changed = 0
			while (stack.length && visited++ < 20_000) {
				const fiber = stack.pop()!
				if (fiber.sibling) stack.push(fiber.sibling)
				if (
					backgroundTag !== undefined &&
					fiber.stateNode?.canonical?.nativeTag === backgroundTag
				)
					continue
				if (fiber.child) stack.push(fiber.child)
				if (fiber.tag !== 5 || fiber.type !== 'RCTView') continue
				const tag = fiber.stateNode?.canonical?.nativeTag
				const node = fiber.stateNode?.node
				if (tag === undefined || !node) continue
				seen.add(tag)
				const style = flatten(fiber.memoizedProps?.style)
				if (
					!style ||
					(style.flex !== 1 &&
						!(
							style.position === 'absolute' &&
							style.left === 0 &&
							style.right === 0 &&
							style.top === 0 &&
							style.bottom === 0
						))
				)
					continue
				const value = processColor(style.backgroundColor)
				if (typeof value !== 'number') continue
				const original =
					saved.get(tag)?.color ??
					(palette.has(value & 0xffffff)
						? value >>> 24 > 0
							? value
							: palette.get(value & 0xffffff)
						: undefined)
				if (
					original === undefined ||
					(style.backgroundColor === 'transparent' && !saved.has(tag))
				)
					continue
				try {
					paint(node, { backgroundColor: active ? 0 : original })
					if (active) saved.set(tag, { node, color: original })
					else saved.delete(tag)
					changed++
				} catch {}
			}
			for (const tag of saved.keys()) if (!seen.has(tag)) saved.delete(tag)
			return changed
		},
		restore() {
			for (const { node, color } of saved.values()) {
				try {
					paint(node, { backgroundColor: color })
				} catch {}
			}
			saved.clear()
		},
	}
}
