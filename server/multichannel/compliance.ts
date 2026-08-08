import { parsePhoneNumberFromString } from 'libphonenumber-js'
import type { Channel, MessagePurpose } from './types'

const gsmBasic = new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"])
const gsmExtended = new Set([...'^{}\\[~]|€'])
const stopWords = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'ARRET'])

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase().normalize('NFKC')
}

export function normalizePhone(value: string, defaultCountry: string = 'FR') {
  const phone = parsePhoneNumberFromString(value, defaultCountry as never)
  if (!phone?.isValid()) throw new Error('Phone number must be valid E.164')
  return phone.number
}

export function smsSegments(value: string) {
  let units = 0
  let encoding: 'GSM-7' | 'UCS-2' = 'GSM-7'
  for (const character of value) {
    if (gsmBasic.has(character)) units += 1
    else if (gsmExtended.has(character)) units += 2
    else { encoding = 'UCS-2'; break }
  }
  if (encoding === 'UCS-2') units = [...value].length
  const single = encoding === 'GSM-7' ? 160 : 70
  const multipart = encoding === 'GSM-7' ? 153 : 67
  const segments = units <= single ? 1 : Math.ceil(units / multipart)
  return { encoding, units, segments, perSegment: segments === 1 ? single : multipart }
}

export function isSuppressionKeyword(value: string) {
  return stopWords.has(value.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
}

export function requiresConsent(channel: Channel, purpose: MessagePurpose) {
  return purpose === 'marketing' && ['email', 'sms', 'whatsapp', 'push', 'voice'].includes(channel)
}

export type ConsentSnapshot = { granted: boolean; withdrawnAt?: string | null; expiresAt?: string | null }

export function consentAllows(snapshot: ConsentSnapshot | undefined, channel: Channel, purpose: MessagePurpose, at = new Date()) {
  if (!requiresConsent(channel, purpose)) return true
  if (!snapshot?.granted || snapshot.withdrawnAt) return false
  return !snapshot.expiresAt || new Date(snapshot.expiresAt) > at
}

const frenchFixedHolidays = new Set(['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'])

function easterSunday(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function isoDateInZone(date: Date, timezone: string) {
  const fields = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  return Object.fromEntries(fields.map(({ type, value }) => [type, value]))
}

export function isFrenchPublicHoliday(date: Date, timezone = 'Europe/Paris') {
  const parts = isoDateInZone(date, timezone)
  const md = `${parts.month}-${parts.day}`
  if (frenchFixedHolidays.has(md)) return true
  const local = `${parts.year}-${parts.month}-${parts.day}`
  const easter = easterSunday(Number(parts.year))
  return [1, 39, 50].some((offset) => {
    const holiday = new Date(easter.getTime() + offset * 86400000)
    return holiday.toISOString().slice(0, 10) === local
  })
}

export function frenchCallWindowAllows(at: Date, timezone: string, preciselyScheduledException = false) {
  if (preciselyScheduledException) return { allowed: true as const }
  const parts = isoDateInZone(at, timezone)
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun' || isFrenchPublicHoliday(at, timezone)) return { allowed: false as const, reason: 'French marketing calls are not allowed on weekends or public holidays' }
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  if (!((minutes >= 600 && minutes < 780) || (minutes >= 840 && minutes < 1200))) return { allowed: false as const, reason: 'French marketing calls are allowed 10:00-13:00 and 14:00-20:00 local time' }
  return { allowed: true as const }
}

export function assertPurposeContent(purpose: MessagePurpose, text: string) {
  if (purpose === 'marketing') return
  const promotionalSignals = [/\bdiscount\b/i, /\bsale\b/i, /\bpromo(code|tion)?\b/i, /\boffer expires\b/i, /\bremise\b/i, /\bsolde?s?\b/i]
  if (promotionalSignals.some((pattern) => pattern.test(text))) throw new Error(`${purpose} messages cannot contain promotional content`)
}
