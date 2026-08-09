import { Languages, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { localeCodes, locales, type Locale } from '@/i18n/catalog'
import { useI18n, type ThemePreference } from '@/i18n/context'
import { cn } from '@/lib/utils'

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

export function PreferencesMenu({
  className,
  onLocaleChange,
  onThemeChange,
}: {
  className?: string
  onLocaleChange?: (locale: Locale) => void | Promise<void>
  onThemeChange?: (theme: ThemePreference) => void | Promise<void>
}) {
  const { locale, setLocale, setTheme, theme } = useI18n()
  const changeLocale = (value: string) => {
    const next = value as Locale
    setLocale(next)
    void onLocaleChange?.(next)
  }
  const changeTheme = (value: string) => {
    const next = value as ThemePreference
    setTheme(next)
    void onThemeChange?.(next)
  }

  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" className={cn('shrink-0', className)} aria-label="Appearance and language"/>}>
      <Languages />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuGroup>
        <DropdownMenuLabel>Language</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={changeLocale}>
          {localeCodes.map((code) => <DropdownMenuRadioItem key={code} value={code}>
            <span lang={code} dir={locales[code].direction} data-i18n-ignore>{locales[code].nativeName}</span>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
          {themeOptions.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}><option.icon />{option.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
