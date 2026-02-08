import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import en, { type TranslationKey, type Translations } from './en'
import ko from './ko'

export type Locale = 'en' | 'ko'

const translations: Record<Locale, Translations> = { en, ko }

function detectLocale(): Locale {
    const saved = localStorage.getItem('locale')
    if (saved === 'en' || saved === 'ko') return saved
    const lang = navigator.language.toLowerCase()
    if (lang.startsWith('ko')) return 'ko'
    return 'en'
}

interface I18nContextValue {
    locale: Locale
    setLocale: (locale: Locale) => void
    t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nContextValue>({
    locale: 'en',
    setLocale: () => { },
    t: (key) => en[key],
})

export function I18nProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState<Locale>(detectLocale)

    const setLocale = useCallback((l: Locale) => {
        setLocaleState(l)
        localStorage.setItem('locale', l)
    }, [])

    const t = useCallback((key: TranslationKey): string => {
        return translations[locale]?.[key] ?? en[key] ?? key
    }, [locale])

    return (
        <I18nContext.Provider value={{ locale, setLocale, t }}>
            {children}
        </I18nContext.Provider>
    )
}

export function useI18n() {
    return useContext(I18nContext)
}

export type { TranslationKey }
