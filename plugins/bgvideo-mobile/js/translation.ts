import japanese from './locales/ja'

const japaneseMessages = japanese as Record<string, string>

export function translate(locale: string, key: string, fallback: string) {
	return locale.toLowerCase().startsWith('ja')
		? (japaneseMessages[key] ?? fallback)
		: fallback
}
