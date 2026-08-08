import type { AppDatabase } from './db'

type Subscriber = Record<string, unknown>
type Condition = { group_no: number; field: string; operator: string; value: string }

function comparable(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function testCondition(subscriber: Subscriber, condition: Condition) {
  const custom = typeof subscriber.custom_values === 'string' ? JSON.parse(subscriber.custom_values || '{}') : (subscriber.custom_values ?? {})
  const raw = condition.field.startsWith('custom.') ? (custom as Record<string, unknown>)[condition.field.slice(7)] : subscriber[condition.field]
  const left = comparable(raw)
  const right = condition.value
  const leftLower = left.toLowerCase()
  const rightLower = right.toLowerCase()
  switch (condition.operator) {
    case 'is': return leftLower === rightLower
    case 'is_not': return leftLower !== rightLower
    case 'contains': return leftLower.includes(rightLower)
    case 'not_contains': return !leftLower.includes(rightLower)
    case 'starts_with': return leftLower.startsWith(rightLower)
    case 'not_starts_with': return !leftLower.startsWith(rightLower)
    case 'ends_with': return leftLower.endsWith(rightLower)
    case 'not_ends_with': return !leftLower.endsWith(rightLower)
    case 'before': return new Date(left).getTime() < new Date(right).getTime()
    case 'after': return new Date(left).getTime() > new Date(right).getTime()
    case 'on': return left.slice(0, 10) === right.slice(0, 10)
    case 'greater_than': return Number(left) > Number(right)
    case 'less_than': return Number(left) < Number(right)
    case 'is_true': return ['true', '1', 'yes'].includes(leftLower)
    case 'is_false': return !['true', '1', 'yes'].includes(leftLower)
    case 'exists': return left !== ''
    case 'not_exists': return left === ''
    default: return false
  }
}

export function segmentSubscribers(db: AppDatabase, segmentId: string) {
  const segment = db.prepare('SELECT * FROM segments WHERE id=?').get(segmentId) as { list_id: string; match_mode: string } | undefined
  if (!segment) return []
  const subscribers = db.prepare(`SELECT * FROM subscribers WHERE list_id=? AND status='active'`).all(segment.list_id) as Subscriber[]
  const conditions = db.prepare('SELECT group_no,field,operator,value FROM segment_conditions WHERE segment_id=? ORDER BY group_no,position').all(segmentId) as Condition[]
  if (!conditions.length) return subscribers
  const groups = new Map<number, Condition[]>()
  for (const condition of conditions) groups.set(condition.group_no, [...(groups.get(condition.group_no) ?? []), condition])
  return subscribers.filter((subscriber) => {
    const results = [...groups.values()].map((group) => group.every((condition) => testCondition(subscriber, condition)))
    return segment.match_mode === 'any' ? results.some(Boolean) : results.every(Boolean)
  })
}

export function refreshSegmentCount(db: AppDatabase, segmentId: string) {
  const count = segmentSubscribers(db, segmentId).length
  db.prepare('UPDATE segments SET last_count=?,last_computed_at=?,updated_at=? WHERE id=?').run(count, new Date().toISOString(), new Date().toISOString(), segmentId)
  return count
}
