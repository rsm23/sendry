import { useId, useState } from "react"
import { CalendarDays } from "lucide-react"
import { arSA, enUS, es, fr } from "react-day-picker/locale"
import { useI18n } from "@/i18n/context"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  id?: string
  ariaLabel?: string
  placeholder?: "Date" | "Date and time"
  disabled?: boolean
  className?: string
}

const calendarLocales = { en: enUS, fr, es, ar: arSA }

export function DatePicker(props: DatePickerProps) {
  return <DatePickerControl {...props} />
}

export function DateTimePicker(props: DatePickerProps) {
  return <DatePickerControl {...props} includeTime />
}

function DatePickerControl({ value, onChange, id, ariaLabel, placeholder = "Date", disabled, className, includeTime = false }: DatePickerProps & { includeTime?: boolean }) {
  const { direction, locale, t } = useI18n()
  const generatedId = useId()
  const controlId = id ?? generatedId
  const [open, setOpen] = useState(false)
  const selected = parseLocalValue(value)
  const displayValue = selected
    ? new Intl.DateTimeFormat(locale, includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(selected)
    : t(placeholder)

  const selectDate = (date?: Date) => {
    if (!date) return
    onChange(formatLocalValue(date, includeTime ? timeFromValue(value) : null))
    if (!includeTime) setOpen(false)
  }

  const changeTime = (time: string) => {
    const date = selected ?? new Date()
    onChange(formatLocalValue(date, time || "00:00"))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button id={controlId} type="button" variant="outline" className={cn("w-full justify-start font-normal", !selected && "text-muted-foreground", className)} disabled={disabled} aria-label={ariaLabel ?? t(placeholder)} />}>
        <CalendarDays data-icon="inline-start" />
        <span className="truncate">{displayValue}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-(--available-height) w-auto gap-0 overflow-y-auto overscroll-contain p-0">
        <PopoverHeader className="sr-only"><PopoverTitle>{t(placeholder)}</PopoverTitle></PopoverHeader>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={selectDate}
          captionLayout="dropdown"
          startMonth={new Date(new Date().getFullYear() - 5, 0)}
          endMonth={new Date(new Date().getFullYear() + 10, 11)}
          locale={calendarLocales[locale]}
          dir={direction}
        />
        {includeTime ? (
          <FieldGroup className="gap-3 border-t p-3">
            <Field>
              <FieldLabel htmlFor={`${controlId}-time`}>Date and time</FieldLabel>
              <Input id={`${controlId}-time`} type="time" value={timeFromValue(value)} onChange={(event) => changeTime(event.target.value)} />
            </Field>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>Done</Button>
          </FieldGroup>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

function parseLocalValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!match) return undefined
  const [, year, month, day, hours = "00", minutes = "00"] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function formatLocalValue(date: Date, time: string | null) {
  const datePart = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-")
  return time === null ? datePart : `${datePart}T${time}`
}

function timeFromValue(value: string) {
  return /T(\d{2}:\d{2})/.exec(value)?.[1] ?? "09:00"
}

function pad(value: number) {
  return String(value).padStart(2, "0")
}
