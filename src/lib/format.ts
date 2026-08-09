let activeLocale = 'en'

export function setFormatLocale(locale: string) { activeLocale = locale }

export const number = { format: (value: number | bigint) => new Intl.NumberFormat(activeLocale).format(value) }
export const percent = (value: number, digits = 1) => new Intl.NumberFormat(activeLocale, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value / 100)
export const shortDate = (value?: string | null) => value ? new Intl.DateTimeFormat(activeLocale, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—'
export const relative = (value?: string | null) => {
  if (!value) return '—'
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(activeLocale, { numeric: 'auto' })
  if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), 'minute')
  if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), 'hour')
  return formatter.format(Math.round(seconds / 86400), 'day')
}
