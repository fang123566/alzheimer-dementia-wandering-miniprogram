const path = require('path')
const fs = require('fs')
const sqlite3 = require('sqlite3').verbose()

const dbDir = path.join(__dirname)
const dbPath = path.join(dbDir, 'guardian.sqlite')

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new sqlite3.Database(dbPath)

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err)
      resolve({ lastID: this.lastID, changes: this.changes })
    })
  })
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err)
      resolve(row || null)
    })
  })
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err)
      resolve(rows || [])
    })
  })
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    age INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  const bindingColumns = await all(`PRAGMA table_info(bindings)`)
  const needRebuild = !bindingColumns.length || !bindingColumns.some(c => c.name === 'note') || !bindingColumns.some(c => c.name === 'updated_at')

  if (needRebuild) {
    await run('ALTER TABLE bindings RENAME TO bindings_legacy').catch(() => {})
    await run(`CREATE TABLE IF NOT EXISTS bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      elderly_id INTEGER NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (family_id, elderly_id),
      FOREIGN KEY (family_id) REFERENCES users(id),
      FOREIGN KEY (elderly_id) REFERENCES users(id)
    )`)
    const legacyExists = await get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bindings_legacy'`)
    if (legacyExists) {
      const legacyColumns = await all(`PRAGMA table_info(bindings_legacy)`)
      const hasNote = legacyColumns.some(c => c.name === 'note')
      const hasUpdatedAt = legacyColumns.some(c => c.name === 'updated_at')
      const noteExpr = hasNote ? 'COALESCE(note, "")' : '""'
      const updatedAtExpr = hasUpdatedAt ? 'updated_at' : 'created_at'
      await run(
        `INSERT OR IGNORE INTO bindings (id, family_id, elderly_id, note, created_at, updated_at)
         SELECT id, family_id, elderly_id, ${noteExpr}, created_at, ${updatedAtExpr}
         FROM bindings_legacy`
      )
      await run('DROP TABLE bindings_legacy')
    }
  } else {
    await run(`CREATE TABLE IF NOT EXISTS bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      elderly_id INTEGER NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (family_id, elderly_id),
      FOREIGN KEY (family_id) REFERENCES users(id),
      FOREIGN KEY (elderly_id) REFERENCES users(id)
    )`)
  }
}

module.exports = {
  db,
  run,
  get,
  all,
  initDb,
  dbPath
}
