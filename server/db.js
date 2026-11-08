'use strict';
/* SQLite storage (built into Node 22.13+, no extra packages). */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

/* on Railway a mounted Volume is used automatically when DB_PATH is not set */
const file = process.env.DB_PATH || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'qumri.db') : path.join(__dirname, 'data', 'qumri.db'));
if (process.env.RAILWAY_ENVIRONMENT && !process.env.DB_PATH && !process.env.RAILWAY_VOLUME_MOUNT_PATH) console.log("DIQQAT: Railway'da Volume ulanmagan, har yangilanishda baza o'chadi. Service → Volumes → /data");
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = new DatabaseSync(file);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, first_name TEXT, lang TEXT, created TEXT DEFAULT (datetime('now')),
  premium_until TEXT, remind INTEGER DEFAULT 1, banned INTEGER DEFAULT 0, last_active TEXT, chat_id INTEGER);
CREATE TABLE IF NOT EXISTS state (user_id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS usage (user_id INTEGER, day TEXT, ai INTEGER DEFAULT 0, tts_chars INTEGER DEFAULT 0, stt_sec INTEGER DEFAULT 0, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, user_id INTEGER, stars INTEGER, created TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS reminders (user_id INTEGER, day TEXT, PRIMARY KEY (user_id, day));
CREATE TABLE IF NOT EXISTS sent (user_id INTEGER, slot TEXT, PRIMARY KEY (user_id, slot));
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, updated TEXT DEFAULT (datetime('now')));
`);
/* reminder hours (Tashkent), comma separated; added after the first release */
try { db.exec("ALTER TABLE users ADD COLUMN remind_hours TEXT DEFAULT '9,20'"); } catch (e) { /* already there */ }
const HOURS = [8, 9, 12, 15, 18, 20, 22];
const parseHours = (s) => [...new Set(String(s || '').split(',').map(Number).filter((h) => HOURS.includes(h)))].sort((a, b) => a - b);

const st = {
  upsertUser: db.prepare(`INSERT INTO users (id, first_name, lang, last_active, chat_id) VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, lang = excluded.lang, last_active = datetime('now'),
    chat_id = COALESCE(excluded.chat_id, users.chat_id)`),
  getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
  getState: db.prepare('SELECT json FROM state WHERE user_id = ?'),
  putState: db.prepare(`INSERT INTO state (user_id, json, updated) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated = datetime('now')`),
  getUsage: db.prepare('SELECT ai, tts_chars, stt_sec FROM usage WHERE user_id = ? AND day = ?'),
  addUsage: db.prepare(`INSERT INTO usage (user_id, day, ai, tts_chars, stt_sec) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, day) DO UPDATE SET ai = ai + excluded.ai, tts_chars = tts_chars + excluded.tts_chars, stt_sec = stt_sec + excluded.stt_sec`),
  addPayment: db.prepare('INSERT OR IGNORE INTO payments (charge_id, user_id, stars) VALUES (?, ?, ?)'),
  setPremium: db.prepare('UPDATE users SET premium_until = ? WHERE id = ?'),
  setRemind: db.prepare('UPDATE users SET remind = ? WHERE id = ?'),
  setBanned: db.prepare('UPDATE users SET banned = ? WHERE id = ?'),
  remindTargets: db.prepare(`SELECT u.id, u.chat_id, u.first_name, u.remind_hours, u.last_active, s.json FROM users u LEFT JOIN state s ON s.user_id = u.id
    WHERE u.remind = 1 AND u.banned = 0 AND u.chat_id IS NOT NULL
    AND (',' || u.remind_hours || ',') LIKE ? AND NOT EXISTS (SELECT 1 FROM sent r WHERE r.user_id = u.id AND r.slot = ?)`),
  weeklyTargets: db.prepare(`SELECT u.id, u.chat_id, s.json FROM users u LEFT JOIN state s ON s.user_id = u.id
    WHERE u.remind = 1 AND u.banned = 0 AND u.chat_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sent r WHERE r.user_id = u.id AND r.slot = ?)`),
  markReminded: db.prepare('INSERT OR IGNORE INTO sent (user_id, slot) VALUES (?, ?)'),
  setHours: db.prepare('UPDATE users SET remind_hours = ?, remind = ? WHERE id = ?'),
  cleanSent: db.prepare("DELETE FROM sent WHERE slot < ?"),
  kvGet: db.prepare('SELECT v FROM kv WHERE k = ?'),
  kvSet: db.prepare("INSERT INTO kv (k, v, updated) VALUES (?, ?, datetime('now')) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated = excluded.updated"),
  kvDel: db.prepare('DELETE FROM kv WHERE k = ?'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  countActive: db.prepare('SELECT COUNT(*) AS n FROM usage WHERE day = ?'),
  countPremium: db.prepare("SELECT COUNT(*) AS n FROM users WHERE premium_until > datetime('now')")
};

/* one copy of the database per day in data/backups, the last 7 are kept */
function backup() {
  if (file === ':memory:') return null;
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
  const out = path.join(dir, 'qumri-' + day + '.db');
  if (fs.existsSync(out)) return out;
  db.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'");
  fs.readdirSync(dir).filter((f) => /^qumri-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -7).forEach((f) => fs.unlinkSync(path.join(dir, f)));
  return out;
}

module.exports = {
  backup,
  close() { try { db.exec('PRAGMA optimize'); db.close(); } catch (e) { /* already closed */ } },
  touchUser(u, chatId) { st.upsertUser.run(u.id, String(u.first_name || '').slice(0, 64), String(u.language_code || '').slice(0, 8), chatId == null ? null : chatId); return st.getUser.get(u.id); },
  getUser: (id) => st.getUser.get(id),
  getState(id) { const r = st.getState.get(id); try { return r ? JSON.parse(r.json) : {}; } catch (e) { return {}; } },
  putState: (id, obj) => st.putState.run(id, JSON.stringify(obj)),
  usage: (id, day) => st.getUsage.get(id, day) || { ai: 0, tts_chars: 0, stt_sec: 0 },
  addUsage: (id, day, ai, tts, stt) => st.addUsage.run(id, day, ai || 0, tts || 0, stt || 0),
  /* returns false when this charge was already counted (Telegram can resend updates) */
  addPayment: (charge, id, stars) => st.addPayment.run(charge, id, stars).changes === 1,
  setPremium: (id, untilIso) => st.setPremium.run(untilIso, id),
  setRemind: (id, on) => st.setRemind.run(on ? 1 : 0, id),
  setBanned: (id, on) => st.setBanned.run(on ? 1 : 0, id),
  remindTargets: (hour, slot) => st.remindTargets.all('%,' + hour + ',%', slot),
  kvGet: (k) => { const r = st.kvGet.get(k); return r ? r.v : ''; },
  kvSet: (k, v) => st.kvSet.run(k, v),
  kvDel: (k) => st.kvDel.run(k),
  weeklyTargets: (slot) => st.weeklyTargets.all(slot),
  markReminded: (id, slot) => st.markReminded.run(id, slot),
  cleanSent: (beforeDay) => st.cleanSent.run(beforeDay),
  hours: (user) => (user && user.remind ? parseHours(user.remind_hours) : []),
  setHours(id, list) { const h = parseHours((list || []).join(',')); st.setHours.run(h.join(','), h.length ? 1 : 0, id); return h; },
  HOURS,
  stats: (day) => ({ users: st.countUsers.get().n, activeToday: st.countActive.get(day).n, premium: st.countPremium.get().n })
};
