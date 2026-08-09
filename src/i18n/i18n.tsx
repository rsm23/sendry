import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { localeCodes, locales, resolveLocale, translateMessage, type Direction, type Locale } from '@/i18n/catalog'
import { setFormatLocale } from '@/lib/format'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

type I18nContextValue = {
  locale: Locale
  direction: Direction
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  setLocale: (locale: Locale) => void
  setTheme: (theme: ThemePreference) => void
  t: (message: string, values?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)
const textSources = new WeakMap<Text, string>()
const attributeSources = new WeakMap<Element, Map<string, string>>()
const translatedAttributes = ['aria-label', 'alt', 'placeholder', 'title'] as const

function storedLocale(): Locale {
  return resolveLocale(localStorage.getItem('sendry_locale') ?? document.documentElement.dataset.locale ?? navigator.language)
}

function storedTheme(): ThemePreference {
  const value = localStorage.getItem('sendry_theme') ?? document.documentElement.dataset.theme
  return value === 'light' || value === 'dark' ? value : 'system'
}

function shouldIgnore(node: Node) {
  const element = node instanceof Element ? node : node.parentElement
  return Boolean(element?.closest('script, style, code, pre, [data-i18n-ignore]'))
}

function localizeText(node: Text, locale: Locale) {
  if (shouldIgnore(node)) return
  const knownSource = textSources.get(node)
  const expected = knownSource === undefined ? undefined : translateMessage(locale, knownSource)
  const source = knownSource === undefined || (node.data !== expected && node.data !== knownSource) ? node.data : knownSource
  textSources.set(node, source)
  const translated = translateMessage(locale, source)
  if (node.data !== translated) node.data = translated
}

function localizeAttributes(element: Element, locale: Locale) {
  if (shouldIgnore(element)) return
  const sources = attributeSources.get(element) ?? new Map<string, string>()
  for (const attribute of translatedAttributes) {
    const current = element.getAttribute(attribute)
    if (current === null) continue
    const knownSource = sources.get(attribute)
    const expected = knownSource === undefined ? undefined : translateMessage(locale, knownSource)
    const source = knownSource === undefined || (current !== expected && current !== knownSource) ? current : knownSource
    sources.set(attribute, source)
    const translated = translateMessage(locale, source)
    if (current !== translated) element.setAttribute(attribute, translated)
  }
  attributeSources.set(element, sources)
}

function localizeTree(root: Node, locale: Locale) {
  if (root instanceof Text) localizeText(root, locale)
  if (root instanceof Element) localizeAttributes(root, locale)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node instanceof Text) localizeText(node, locale)
    else if (node instanceof Element) localizeAttributes(node, locale)
    node = walker.nextNode()
  }
}

function interpolate(message: string, values?: Record<string, string | number>) {
  if (!values) return message
  return message.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(storedLocale)
  const [theme, updateTheme] = useState<ThemePreference>(storedTheme)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const localeRef = useRef(locale)
  localeRef.current = locale
  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  const setLocale = useCallback((next: Locale) => {
    if (!localeCodes.includes(next)) return
    localStorage.setItem('sendry_locale', next)
    updateLocale(next)
  }, [])
  const setTheme = useCallback((next: ThemePreference) => {
    localStorage.setItem('sendry_theme', next)
    updateTheme(next)
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useLayoutEffect(() => {
    const definition = locales[locale]
    const root = document.documentElement
    root.lang = locale
    root.dir = definition.direction
    root.dataset.locale = locale
    root.dataset.theme = theme
    root.classList.toggle('dark', resolvedTheme === 'dark')
    root.style.colorScheme = resolvedTheme
    setFormatLocale(locale)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#17191f' : '#f9f8f4')
  }, [locale, resolvedTheme, theme])

  useLayoutEffect(() => {
    const root = document.getElementById('root')
    if (!root) return
    localizeTree(root, locale)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') localizeText(record.target as Text, localeRef.current)
        else if (record.type === 'attributes') localizeAttributes(record.target as Element, localeRef.current)
        else for (const node of record.addedNodes) localizeTree(node, localeRef.current)
      }
    })
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] })
    return () => observer.disconnect()
  }, [locale])

  const t = useCallback((message: string, values?: Record<string, string | number>) => interpolate(translateMessage(locale, message), values), [locale])
  const value = useMemo<I18nContextValue>(() => ({ locale, direction: locales[locale].direction, theme, resolvedTheme, setLocale, setTheme, t }), [locale, resolvedTheme, setLocale, setTheme, t, theme])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useI18n must be used inside I18nProvider')
  return context
}
