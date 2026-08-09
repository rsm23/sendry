type Translate = (message: string, values?: Record<string, string | number>) => string
type AlertCopy = { id: string; title: string; detail: string }

export function localizeAlert<T extends AlertCopy>(alert: T, t: Translate) {
  if (alert.id === 'paused-automations') {
    const count = Number.parseInt(alert.title, 10) || 0
    return {
      title: t(count === 1 ? '{count} paused automation' : '{count} paused automations', { count }),
      detail: t('Open Automations to review or resume delivery.'),
    }
  }
  if (alert.id === 'bounce-rate') {
    const percent = Number.parseInt(alert.detail, 10) || 0
    return {
      title: t('Bounce rate needs attention'),
      detail: t('{percent}% of recent delivery events were bounces.', { percent }),
    }
  }
  if (alert.id === 'monthly-allowance') {
    const percent = Number.parseInt(alert.detail, 10) || 0
    return {
      title: t('Monthly allowance is nearly used'),
      detail: t('{percent}% of the configured allowance has been used.', { percent }),
    }
  }
  return { title: t(alert.title), detail: t(alert.detail) }
}
