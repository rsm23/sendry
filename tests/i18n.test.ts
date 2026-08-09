import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { localeCodes, locales, resolveLocale, translateMessage } from '../src/i18n/catalog'
import { number, setFormatLocale } from '../src/lib/format'

describe('localization contract', () => {
  it('keeps every locale catalog in exact parity with English', () => {
    const englishKeys = Object.keys(locales.en.messages).sort()
    expect(englishKeys.length).toBeGreaterThan(800)
    for (const locale of localeCodes) expect(Object.keys(locales[locale].messages).sort()).toEqual(englishKeys)
  })

  it('resolves regional variants, translations, and Arabic direction', () => {
    expect(resolveLocale('fr-FR')).toBe('fr')
    expect(resolveLocale('ar_MA')).toBe('ar')
    expect(resolveLocale('de-DE')).toBe('en')
    expect(locales.ar.direction).toBe('rtl')
    expect(translateMessage('fr', 'Campaigns')).toBe('Campagnes')
    expect(translateMessage('es', 'Settings')).toBe('Configuración')
    expect(translateMessage('ar', 'Inbox')).toBe('البريد الوارد')
  })

  it('formats numbers with the active locale', () => {
    setFormatLocale('en')
    const english = number.format(1234567)
    setFormatLocale('ar')
    const arabic = number.format(1234567)
    expect(arabic).not.toBe(english)
    setFormatLocale('en')
  })

  it('keeps page layout utilities logical for RTL', () => {
    const roots = ['src/pages', 'src/components/app-shell.tsx']
    const files = roots.flatMap((root) => {
      const absolute = path.resolve(root)
      return fs.statSync(absolute).isDirectory()
        ? fs.readdirSync(absolute).filter((file) => file.endsWith('.tsx')).map((file) => path.join(absolute, file))
        : [absolute]
    })
    const physicalUtility = /(?:^|[\s"'])(?:-?(?:left|right|ml|mr|pl|pr)-|border-(?:l|r)(?![a-z]))/
    for (const file of files) expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(physicalUtility)
  })
})
