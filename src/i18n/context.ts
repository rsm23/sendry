import { createContext, useContext } from 'react'
import type { Direction, Locale } from '@/i18n/catalog'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export type I18nContextValue = {
  locale: Locale
  direction: Direction
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  setLocale: (locale: Locale) => void
  setTheme: (theme: ThemePreference) => void
  t: (message: string, values?: Record<string, string | number>) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
