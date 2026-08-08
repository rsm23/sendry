import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const styles: Record<string, string> = {
  sent: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  sending: 'border-blue-200 bg-blue-50 text-blue-700',
  queued: 'border-blue-200 bg-blue-50 text-blue-700',
  scheduled: 'border-amber-200 bg-amber-50 text-amber-700',
  unconfirmed: 'border-amber-200 bg-amber-50 text-amber-700',
  draft: 'border-slate-200 bg-slate-100 text-slate-700',
  stopped: 'border-orange-200 bg-orange-50 text-orange-700',
  unsubscribed: 'border-slate-200 bg-slate-100 text-slate-600',
  bounced: 'border-red-200 bg-red-50 text-red-700',
  complaint: 'border-red-200 bg-red-50 text-red-700',
  failed: 'border-red-200 bg-red-50 text-red-700',
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge variant="outline" className={cn('font-medium capitalize', styles[status] ?? '', className)}>{status.replaceAll('_', ' ')}</Badge>
}
