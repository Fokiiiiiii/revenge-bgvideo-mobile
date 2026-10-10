import { describe, expect, test } from 'bun:test'
import { translate } from '../plugins/bgvideo-mobile/js/translation'

describe('BgVideo Japanese messages', () => {
	test('uses Japanese for Japanese Discord locales and English otherwise', () => {
		expect(translate('ja', 'enableBackground', 'Enable background')).toBe(
			'背景を有効化',
		)
		expect(translate('ja-JP', 'enableBackground', 'Enable background')).toBe(
			'背景を有効化',
		)
		expect(translate('en-US', 'enableBackground', 'Enable background')).toBe(
			'Enable background',
		)
		expect(translate('ja', 'cacheLimit', 'Cache limit')).toBe(
			'キャッシュ上限 (MB、32MB超の素材は直接再生)',
		)
	})
})
