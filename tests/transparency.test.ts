import { describe, expect, test } from 'bun:test'
import { createPanelTransparency } from '../plugins/bgvideo-mobile/js/transparency'

const names = [
	'BACKGROUND_BASE_LOW',
	'BACKGROUND_BASE_LOWER',
	'BACKGROUND_BASE_LOWEST',
	'BACKGROUND_SURFACE_HIGH',
	'BACKGROUND_SURFACE_HIGHEST',
	'BG_SURFACE_RAISED',
	'CHANNEL_BACKGROUND_DEFAULT',
	'CARD_BACKGROUND_DEFAULT',
	'CHANNELTEXTAREA_BACKGROUND',
	'CHAT_INPUT_BACKGROUND',
	'MODAL_BACKGROUND',
	'MODAL_FOOTER_BACKGROUND',
] as const

const modes = ['dark', 'light', 'midnight', 'darker'] as const
type Mode = (typeof modes)[number]
type Cell = { raw?: string; color?: string; opacity: number }
type Definition = Record<Mode, Cell> & { gradient: { dark: Cell; light: Cell } }

function createDefinition(name: string): Definition {
	return {
		dark: { raw: `${name}-dark`, opacity: 0.125 },
		light: { raw: `${name}-light`, opacity: 0.25 },
		midnight: { raw: `${name}-midnight`, opacity: 0.375 },
		darker: { raw: `${name}-darker`, opacity: 0.625 },
		gradient: {
			dark: { color: `${name}-gradient-dark`, opacity: 0.75 },
			light: { color: `${name}-gradient-light`, opacity: 0.875 },
		},
	}
}

function createFixture() {
	const definitions = Object.fromEntries(
		names.map(name => [name, createDefinition(name)]),
	) as Record<string, Definition>
	const colors = Object.fromEntries(
		names.map(name => [name, { token: name }]),
	) as Record<string, object>
	const rawColors = Object.fromEntries(
		names.map(name => [name, { raw: `${name}-palette`, opacity: 0.5 }]),
	) as Record<string, Cell>
	const tokens: Record<string, unknown> = {
		SemanticColor: definitions,
		default: {
			colors,
			internal: {
				resolveSemanticColor(themeString: string, colorObject: object) {
					const name = (colorObject as { token: string }).token
					return `${themeString}:${name}:${definitions[name][themeString as Mode].opacity}`
				},
			},
		},
		RawColor: rawColors,
	}
	return { definitions, rawColors, tokens }
}

function opacitySnapshot(definition: Definition) {
	return [
		...modes.map(mode => definition[mode].opacity),
		definition.gradient.dark.opacity,
		definition.gradient.light.opacity,
	]
}

describe('BgVideo panel transparency', () => {
	test('makes all four modes and both gradients transparent without changing raw colors', () => {
		const { definitions, rawColors, tokens } = createFixture()
		const rawColorsBefore = Object.fromEntries(
			names.map(name => [name, { ...rawColors[name] }]),
		)
		const transparency = createPanelTransparency(tokens)

		expect(transparency.tokenCount).toBe(names.length)
		transparency.setActive(true)
		for (const name of names) {
			for (const mode of modes) {
				expect(definitions[name][mode].opacity).toBe(0)
				expect(definitions[name][mode].raw).toBe(`${name}-${mode}`)
			}
			expect(definitions[name].gradient.dark.opacity).toBe(0)
			expect(definitions[name].gradient.dark.color).toBe(
				`${name}-gradient-dark`,
			)
			expect(definitions[name].gradient.light.opacity).toBe(0)
			expect(definitions[name].gradient.light.color).toBe(
				`${name}-gradient-light`,
			)
		}
		expect(rawColors).toEqual(rawColorsBefore)
	})

	test('leaves unrelated tokens unchanged', () => {
		const { definitions, tokens } = createFixture()
		const unrelated = createDefinition('BACKGROUND_ACCENT')
		definitions.BACKGROUND_ACCENT = unrelated
		const before = opacitySnapshot(unrelated)

		createPanelTransparency(tokens).setActive(true)

		expect(opacitySnapshot(unrelated)).toEqual(before)
	})

	test('restores exact original opacities through repeated activation and restore', () => {
		const { definitions, tokens } = createFixture()
		const before = Object.fromEntries(
			names.map(name => [name, opacitySnapshot(definitions[name])]),
		)
		const transparency = createPanelTransparency(tokens)

		transparency.setActive(true)
		transparency.setActive(true)
		transparency.setActive(false)
		expect(
			Object.fromEntries(
				names.map(name => [name, opacitySnapshot(definitions[name])]),
			),
		).toEqual(before)
		transparency.setActive(true)
		transparency.restore()
		expect(
			Object.fromEntries(
				names.map(name => [name, opacitySnapshot(definitions[name])]),
			),
		).toEqual(before)
		transparency.setActive(true)
		transparency.restore()
		expect(
			Object.fromEntries(
				names.map(name => [name, opacitySnapshot(definitions[name])]),
			),
		).toEqual(before)
	})

	test('captures resolved colors before mutating opacity', () => {
		const { definitions, tokens } = createFixture()
		const expected = names.flatMap(name =>
			modes.map(mode => `${mode}:${name}:${definitions[name][mode].opacity}`),
		)
		const transparency = createPanelTransparency(tokens)

		expect(transparency.originalColors).toEqual(expected)
		transparency.setActive(true)
		expect(transparency.originalColors).toEqual(expected)
	})

	test('skips missing and malformed definitions and works without a resolver', () => {
		const definitions: Record<string, unknown> = {
			[names[0]]: {
				dark: { raw: 'bad', opacity: '1' },
				light: { raw: 'ok', opacity: 0.25 },
				midnight: { raw: 'nan', opacity: Number.NaN },
				darker: null,
				gradient: {
					dark: { color: 'infinite', opacity: Number.POSITIVE_INFINITY },
					light: null,
				},
			},
			[names[1]]: null,
		}
		const tokens: Record<string, unknown> = { SemanticColor: definitions }
		const transparency = createPanelTransparency(tokens)

		expect(transparency.originalColors).toEqual([])
		expect(transparency.tokenCount).toBe(1)
		transparency.setActive(true)
		expect((definitions[names[0]] as Definition).light.opacity).toBe(0)
		expect((definitions[names[0]] as Definition).dark.opacity).toBe('1')
		transparency.restore()
		expect((definitions[names[0]] as Definition).light.opacity).toBe(0.25)
		expect(createPanelTransparency(null).tokenCount).toBe(0)
	})
})
