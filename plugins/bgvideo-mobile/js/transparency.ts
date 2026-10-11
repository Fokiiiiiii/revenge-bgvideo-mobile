export function createPanelTransparency(tokens: unknown) {
	const names = [
		'BACKGROUND_BASE_LOW',
		'BACKGROUND_BASE_LOWER',
		'BACKGROUND_BASE_LOWEST',
		'BACKGROUND_SURFACE_HIGH',
		'BACKGROUND_SURFACE_HIGHEST',
		'CHANNEL_BACKGROUND_DEFAULT',
	]
	const modes = ['dark', 'light', 'midnight', 'darker'] as const
	const asRecord = (value: unknown): Record<string, unknown> | undefined =>
		value !== null && typeof value === 'object'
			? (value as Record<string, unknown>)
			: undefined
	const root = asRecord(tokens)
	const definitions = asRecord(root?.SemanticColor)
	const saved = new Map<Record<string, unknown>, number>()
	const mutableNames = new Set<string>()

	for (const name of names) {
		const definition = asRecord(definitions?.[name])
		if (!definition) continue
		let hasOpacity = false
		const save = (value: unknown) => {
			const cell = asRecord(value)
			if (
				!cell ||
				typeof cell.opacity !== 'number' ||
				!Number.isFinite(cell.opacity)
			)
				return
			if (!saved.has(cell)) saved.set(cell, cell.opacity)
			hasOpacity = true
		}
		for (const mode of modes) save(definition[mode])
		const gradient = asRecord(definition.gradient)
		save(gradient?.dark)
		save(gradient?.light)
		if (hasOpacity) mutableNames.add(name)
	}

	const originalColors: string[] = []
	const defaults = asRecord(root?.default)
	const colors = asRecord(defaults?.colors)
	const internal = asRecord(defaults?.internal)
	const resolveSemanticColor = internal?.resolveSemanticColor
	if (typeof resolveSemanticColor === 'function') {
		for (const name of mutableNames) {
			const color = colors?.[name]
			if (color === null || typeof color !== 'object') continue
			for (const mode of modes) {
				let resolved: unknown
				try {
					resolved = Reflect.apply(resolveSemanticColor, internal, [
						mode,
						color,
						{},
					])
				} catch {
					resolved = undefined
				}
				if (typeof resolved === 'string') originalColors.push(resolved)
			}
		}
	}

	const restore = () => {
		for (const [cell, opacity] of saved) cell.opacity = opacity
	}

	return {
		setActive(active: boolean) {
			for (const [cell, opacity] of saved) cell.opacity = active ? 0 : opacity
		},
		restore,
		originalColors,
		tokenCount: mutableNames.size,
	}
}
