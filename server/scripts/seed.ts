import { createDatabase } from '../db'

const db = createDatabase()
const result = db.prepare('SELECT COUNT(*) AS users FROM users').get() as { users: number }
console.log(JSON.stringify({ ok: true, users: result.users }))
db.close()
