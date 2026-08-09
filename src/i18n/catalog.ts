import arMessages from './locales/ar.json'
import enMessages from './locales/en.json'
import esMessages from './locales/es.json'
import frMessages from './locales/fr.json'

export const localeCodes = ['en', 'fr', 'es', 'ar'] as const
export type Locale = (typeof localeCodes)[number]
export type Direction = 'ltr' | 'rtl'

export type LocaleDefinition = {
  code: Locale
  direction: Direction
  englishName: string
  nativeName: string
  messages: Record<string, string>
}

export const locales: Record<Locale, LocaleDefinition> = {
  en: { code: 'en', direction: 'ltr', englishName: 'English', nativeName: 'English', messages: enMessages },
  fr: { code: 'fr', direction: 'ltr', englishName: 'French', nativeName: 'Français', messages: frMessages },
  es: { code: 'es', direction: 'ltr', englishName: 'Spanish', nativeName: 'Español', messages: esMessages },
  ar: { code: 'ar', direction: 'rtl', englishName: 'Arabic', nativeName: 'العربية', messages: arMessages },
}

export function resolveLocale(value?: string | null): Locale {
  const base = value?.trim().toLowerCase().split(/[-_]/)[0]
  return localeCodes.includes(base as Locale) ? (base as Locale) : 'en'
}

export function translateMessage(locale: Locale, message: string): string {
  if (locale === 'en' || !message) return message
  const leading = message.match(/^\s*/)?.[0] ?? ''
  const trailing = message.match(/\s*$/)?.[0] ?? ''
  const key = message.trim()
  return key ? `${leading}${locales[locale].messages[key] ?? key}${trailing}` : message
}

export function isCatalogMessage(message: string) {
  return Object.prototype.hasOwnProperty.call(locales.en.messages, message.trim())
}
