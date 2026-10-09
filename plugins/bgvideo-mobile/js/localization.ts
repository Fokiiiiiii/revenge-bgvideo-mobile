import { getStore } from '@revenge-mod/discord/flux'
import { useEffect, useState } from 'react'
import { translate } from './translation'

type LocaleStore = {
	locale?: string
	addChangeListener?: (listener: () => void) => void
	removeChangeListener?: (listener: () => void) => void
}

export function useTranslator() {
	const [locale, setLocale] = useState('en-US')

	useEffect(() => {
		let removeLocaleListener: (() => void) | undefined
		const removeStoreFinder = getStore('LocaleStore', store => {
			const localeStore = store as unknown as LocaleStore
			const update = () => setLocale(localeStore.locale ?? 'en-US')
			update()
			localeStore.addChangeListener?.(update)
			removeLocaleListener = () => localeStore.removeChangeListener?.(update)
		})

		return () => {
			removeLocaleListener?.()
			removeStoreFinder?.()
		}
	}, [])

	return (key: string, fallback: string) => translate(locale, key, fallback)
}
