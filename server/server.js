'use strict';
/* Qumri server: serves the Telegram Mini App, its API, and the bot webhook. No npm packages needed. */
const path0 = require('node:path');
/* read .env next to package.json (works the same on Windows, macOS and Linux; real environment variables win) */
try { process.loadEnvFile(path0.join(__dirname, '..', '.env')); } catch (e) { /* no .env file: use the environment */ }
if (process.argv.includes('--polling')) process.env.USE_POLLING = '1';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const S = require('./services');
const bot = require('./bot');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
/* 8080 is often taken on Windows (Postgres, Tomcat...), so a less common port is the default */
const PORT = +process.env.PORT || 3478;
const INSTANCE = crypto.randomBytes(8).toString('hex');
let port = PORT;
const INIT_MAX_AGE = 24 * 3600;
/* Telegram IDs of the owner(s): only they see and change the AI keys in the Mini App */
const ADMIN_IDS = String(process.env.ADMIN_IDS || '').split(',').map((s) => +s.trim()).filter(Boolean);

if (!BOT_TOKEN) { console.error('BOT_TOKEN is missing'); process.exit(1); }
if (!WEBHOOK_SECRET && !process.env.USE_POLLING) { console.error('WEBHOOK_SECRET is missing (any long random string)'); process.exit(1); }

const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

/* ---------- Telegram Mini App signature check ----------
   Telegram signs initData with the bot token. If the signature does not match,
   or it is older than a day, the request is refused. */
const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
function verifyInitData(raw) {
  if (!raw || raw.length > 4096) return null;
  const p = new URLSearchParams(raw);
  const hash = p.get('hash'); if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null;
  p.delete('hash');
  const check = [...p.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => k + '=' + v).join('\n');
  const calc = crypto.createHmac('sha256', secretKey).update(check).digest();
  if (!crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'))) return null;
  const age = Date.now() / 1000 - (+p.get('auth_date') || 0);
  if (!(age >= -60 && age < INIT_MAX_AGE)) return null;
  try { const u = JSON.parse(p.get('user') || 'null'); return u && Number.isSafeInteger(u.id) ? u : null; } catch (e) { return null; }
}

/* ---------- rate limits (in memory; per user and per IP) ---------- */
const buckets = new Map();
function allow(key, perMinute) {
  const now = Date.now(); let b = buckets.get(key);
  if (!b) { b = { t: perMinute, at: now }; buckets.set(key, b); }
  b.t = Math.min(perMinute, b.t + ((now - b.at) / 60000) * perMinute); b.at = now;
  if (b.t < 1) return false; b.t -= 1; return true;
}
setInterval(() => { const old = Date.now() - 10 * 60000; for (const [k, b] of buckets) if (b.at < old) buckets.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
/* short status lines for the terminal, each at most once a minute (never request contents) */
const logged = new Map();
function logOnce(key, text) { const t = logged.get(key) || 0; if (Date.now() - t > 60000) { logged.set(key, Date.now()); console.log(text); } }
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin'
};
const CSP = ["default-src 'self'", "script-src 'self' 'unsafe-inline' https://telegram.org", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "img-src 'self' data: blob:", "media-src 'self' blob:", "connect-src 'self'",
  "frame-ancestors https://web.telegram.org https://*.telegram.org", "base-uri 'none'", "form-action 'none'", "object-src 'none'"].join('; ');

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({}, SEC_HEADERS, headers || {}));
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = +req.headers['content-length'] || 0;
    if (len > limit) { reject(new S.ApiError('too_long', 413)); req.resume(); return; }
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new S.ApiError('too_long', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  const b = await readBody(req, limit);
  try { const v = JSON.parse(b.toString('utf8') || '{}'); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch (e) { throw new S.ApiError('bad_json'); }
}
function clientIp(req) {
  return (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
}

/* The app sends its whole copy, but the bot may have added words or mistakes since the app loaded.
   Keep those (newer than the app's copy) instead of wiping them, and never lose practice minutes. */
function mergeState(cur, s, base) {
  const keep = (mine, app, key) => {
    if (!Array.isArray(app)) return mine;
    const have = new Set(app.map(key));
    return app.concat((mine || []).filter((x) => x && (x.t || 0) > base && !have.has(key(x))));
  };
  const out = Object.assign({}, cur, s);
  out.words = keep(cur.words, s.words, (w) => String(w.w).toLowerCase());
  out.mistakes = keep(cur.mistakes, s.mistakes, (m) => String(m.better).toLowerCase());
  if (s.flu && cur.flu) { out.flu = Object.assign({}, cur.flu); for (const k in s.flu) { const a = cur.flu[k], b = s.flu[k]; out.flu[k] = !a ? b : (b.n >= a.n ? b : a); } }
  if (s.days && cur.days) { out.days = Object.assign({}, cur.days); for (const k in s.days) out.days[k] = Math.max(out.days[k] || 0, s.days[k]); }
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

/* progress sent by the app: keep only known keys, sane sizes */
function cleanState(s) {
  const out = {};
  const arr = (v, n) => (Array.isArray(v) ? v.slice(-n) : undefined);
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  if (Array.isArray(s.words)) out.words = s.words.slice(-1000).filter((w) => w && w.w).map((w) => ({
    w: str(w.w, 60), uz: str(w.uz, 120), ex: str(w.ex, 200), box: Math.max(0, Math.min(6, +w.box || 0)), due: day(w.due) || '1970-01-01',
    src: str(w.src, 8), seen: Math.max(0, +w.seen || 0), used: Math.max(0, +w.used || 0), sound: str(w.sound, 60) || undefined, trick: str(w.trick, 400) || undefined, t: Math.max(0, +w.t || 0) || undefined }));
  if (Array.isArray(s.mistakes)) out.mistakes = s.mistakes.slice(-200).filter((m) => m && m.better).map((m) => ({
    cat: S.prompts.CATS[m.cat] ? m.cat : undefined,
    said: str(m.said, 200), better: str(m.better, 200), en: str(m.en, 200), uz: str(m.uz, 300), day: day(m.day) || '1970-01-01',
    n: Math.max(1, Math.min(999, +m.n || 1)), ok: Math.max(0, Math.min(9, +m.ok || 0)), t: Math.max(0, +m.t || 0) || undefined }));
  if (Array.isArray(s.chat)) out.chat = s.chat.slice(-30).filter((t) => t && (t.role === 'user' || t.role === 'assistant')).map((t) => ({ role: t.role, content: str(t.content, 1500) }));
  if (s.days && typeof s.days === 'object' && !Array.isArray(s.days)) {
    out.days = {}; Object.keys(s.days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-400).forEach((k) => { out.days[k] = Math.max(0, Math.min(86400000, +s.days[k] || 0)); });
  }
  if (s.settings && typeof s.settings === 'object') {
    const t = s.settings; out.settings = { level: S.prompts.LEVELS.includes(t.level) ? t.level : 'B1', goal: Math.min(60, Math.max(1, +t.goal || 10)), rate: Math.min(1.25, Math.max(0.7, +t.rate || 0.95)), readUz: t.readUz !== false, handsfree: t.handsfree !== false, calm: t.calm !== false, corrections: t.corrections === 'main' ? 'main' : 'all', lang: t.lang === 'en' ? 'en' : 'both', about: str(t.about, 200).trim() || undefined, gender: ['female', 'male'].includes(t.gender) ? t.gender : 'auto',
      style: S.prompts.pick(S.prompts.STYLES, t.style) ? t.style : 'samimiy', topic: S.prompts.pick(S.prompts.TOPICS, t.topic) ? t.topic : 'free' };
    const c = t.char || {};
    out.settings.char = { id: S.prompts.pick(S.prompts.CHARACTERS, c.id) ? c.id : 'nur', color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : '',
      acc: ['none', 'doppi', 'glasses', 'bow', 'crown', 'phones'].includes(c.acc) ? c.acc : 'none',
      name: S.prompts.cleanName(c.name, '') };
  }
  if (s.flu && typeof s.flu === 'object' && !Array.isArray(s.flu)) {
    out.flu = {}; Object.keys(s.flu).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-60).forEach((k) => { const x = s.flu[k] || {};
      out.flu[k] = { w: Math.max(0, Math.min(1e5, +x.w || 0)), s: Math.max(0, Math.min(1e5, +x.s || 0)), f: Math.max(0, Math.min(1e5, +x.f || 0)), n: Math.max(0, Math.min(1e4, +x.n || 0)) }; });
  }
  if (typeof s.lastDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.lastDay)) out.lastDay = s.lastDay;
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

/* ---------- API ---------- */
async function apiRoute(req, res, url) {
  const tgUser = verifyInitData(req.headers['x-init-data']);
  if (!tgUser) { logOnce('auth', "Mini App: Telegram imzosi tekshiruvdan o'tmadi (sahifani Telegram ichidan, bot tugmasi orqali oching; kompyuter soati to'g'rimi?)"); return json(res, 401, { error: 'auth' }); }
  if (url.pathname === '/api/me') logOnce('me' + tgUser.id, 'Mini App: ulandi ✓');
  const user = db.touchUser(tgUser);
  if (user.banned) return json(res, 403, { error: 'banned' });
  if (!allow('u' + user.id, 40)) return json(res, 429, { error: 'rate_limited' });

  if (url.pathname === '/api/me' && req.method === 'GET')
    return json(res, 200, { now: Date.now(), quota: S.quota(user), state: db.getState(user.id), name: user.first_name, remind: db.hours(user), voice: S.anyVoice(), admin: ADMIN_IDS.includes(user.id) });

  /* ---- owner only: AI keys and their health ---- */
  if (url.pathname.startsWith('/api/admin/')) {
    if (!ADMIN_IDS.includes(user.id)) return json(res, 403, { error: 'forbidden' });
    if (!allow('adm' + user.id, 20)) return json(res, 429, { error: 'rate_limited' });
    if (url.pathname === '/api/admin/keys' && req.method === 'GET') return json(res, 200, { keys: S.keyList() });
    if (url.pathname === '/api/admin/keys' && req.method === 'POST') {
      const b = await readJson(req, 2048);
      return json(res, 200, { keys: S.setKey(String(b.id || ''), b.value) });
    }
    if (url.pathname === '/api/admin/check' && req.method === 'POST') {
      if (!allow('chk' + user.id, 4)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, await S.checkAll());
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'method' });

  if (url.pathname === '/api/state') {
    const raw = await readJson(req, 300 * 1024);
    db.putState(user.id, mergeState(db.getState(user.id), cleanState(raw), +raw._base || 0));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/remind') {
    const b = await readJson(req, 1024);
    return json(res, 200, { hours: db.setHours(user.id, Array.isArray(b.hours) ? b.hours.slice(0, 10) : []) });
  }
  if (url.pathname === '/api/ai') {
    if (!allow('ai' + user.id, 15)) return json(res, 429, { error: 'rate_limited' });
    const b = await readJson(req, 64 * 1024);
    const out = await S.runAI(user, String(b.type || ''), b.payload || {});
    return json(res, 200, out);
  }
  if (url.pathname === '/api/tts') {
    if (!allow('tts' + user.id, 30)) return json(res, 429, { error: 'rate_limited' });
    const b = await readJson(req, 8 * 1024);
    const mp3 = await S.tts(user, b.text, !!b.uz, String(b.emotion || ''), b.speed, 'mp3', String(b.voice || ''), String(b.style || ''));
    return send(res, 200, mp3, { 'content-type': mp3.mime || 'audio/mpeg', 'cache-control': 'private, max-age=600' });
  }
  if (url.pathname === '/api/stt') {
    if (!allow('stt' + user.id, 12)) return json(res, 429, { error: 'rate_limited' });
    const buf = await readBody(req, 3 * 1024 * 1024);
    if (buf.length < 1000) return json(res, 400, { error: 'too_short' });
    return json(res, 200, await S.stt(user, buf, req.headers['content-type'], 0, url.searchParams.get('lang') === 'auto' ? 'auto' : 'en', S.prompts.cleanName(url.searchParams.get('name'), '')));
  }
  if (url.pathname === '/api/invoice') {
    if (!allow('inv' + user.id, 5)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { link: await bot.invoiceLink(user.id) });
  }
  return json(res, 404, { error: 'not_found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!allow('ip' + clientIp(req), 240)) return json(res, 429, { error: 'rate_limited' });
    if (url.pathname.startsWith('/api/')) return await apiRoute(req, res, url);
    if (url.pathname === '/tg/webhook' && req.method === 'POST') {
      const got = Buffer.from(String(req.headers['x-telegram-bot-api-secret-token'] || ''));
      const want = Buffer.from(WEBHOOK_SECRET);
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return send(res, 401, 'no');
      const update = await readJson(req, 1024 * 1024);
      send(res, 200, 'ok');
      bot.handleUpdate(update).catch((e) => console.error('bot', e.message));
      return;
    }
    if (url.pathname === '/health') return send(res, 200, 'ok', { 'content-type': 'text/plain', 'x-qumri': INSTANCE });
    if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
      logOnce('page', 'Mini App: sahifa telefonga yuborildi');
      return send(res, 200, INDEX, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'cache-control': 'no-cache' });
    }
    return send(res, 404, 'not found', { 'content-type': 'text/plain' });
  } catch (e) {
    if (e instanceof S.ApiError) return json(res, e.status, { error: e.code });
    console.error('server', e.message);
    if (!res.headersSent) json(res, 500, { error: 'server' });
  }
});
server.requestTimeout = 90000;
server.headersTimeout = 20000;

/* Start on PORT; if another program already answers there, move to the next port.
   (On Windows two programs can share a port number on different addresses, and the tunnel
   would then reach the other program: that is why we ask /health who is really there.) */
/* is any program already answering on this port at 127.0.0.1? (plain http, no proxy) */
function busy(p) {
  return new Promise((resolve) => {
    const rq = http.get({ host: '127.0.0.1', port: p, path: '/health', timeout: 1500 }, (r) => { r.resume(); resolve(true); });
    rq.on('timeout', () => { rq.destroy(); resolve(true); });
    rq.on('error', () => resolve(false));
  });
}
async function listen() {
  if (!PUBLIC_URL && !process.env.PORT_STRICT) {
    while (port < PORT + 20 && await busy(port)) { console.log(port + '-portda boshqa dastur ishlayapti, ' + (port + 1) + ' ga o\'tyapman'); port++; }
  }
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && !process.env.PORT_STRICT && port < PORT + 20) { console.log(port + '-port band, ' + (port + 1) + ' ni sinayapman'); port++; listen(); }
    else { console.error('server:', e.message); process.exit(1); }
  });
  server.listen(port, () => { server.removeAllListeners('error'); started(); });
}
listen();
async function started() {
  console.log('Qumri listening on', port);
  S.loadKeys();
  console.log('Ovozni tanish:', S.C.groqKey ? 'groq' : S.C.openaiKey ? 'openai' : 'yoq', '| jonli ovoz:', S.C.openaiKey ? 'openai (tekshirilmoqda)' : 'bepul ovoz tekshirilmoqda');
  console.log('AI larni tekshiryapman...');
  S.selfTest().then(() => S.voiceTest()).catch((e) => console.error('selftest', e.message));
  const polling = !!process.env.USE_POLLING;
  let url = PUBLIC_URL;
  /* Telegram opens a Mini App only from an https address. On your own computer a free
     Cloudflare tunnel gives one: it starts by itself when cloudflared is installed. */
  if (!url && polling) url = await startTunnel();
  if (url && !PUBLIC_URL) checkTunnel(url);
  try { await bot.setup({ publicUrl: url, secret: WEBHOOK_SECRET, polling }); }
  catch (e) { console.error('bot setup failed:', e.message); }
}

let tunnel = null;
/* a new quick tunnel needs a few seconds before the internet can see it */
async function checkTunnel(url) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try { const r = await fetch(url + '/health'); if (r.ok && r.headers.get('x-qumri') === INSTANCE) { console.log("Mini App manzili internetdan ochilyapti ✓ Telegramda botga /start yozing va \"Gaplashish\" tugmasini bosing."); return; } } catch (e) { /* not yet */ }
  }
  console.log("Mini App manzili internetdan ochilmayapti ✗ (Cloudflare tunnel ishlamadi). npm run dev ni qayta ishga tushirib ko'ring.");
}
function startTunnel() {
  return new Promise((resolve) => {
    const { spawn } = require('node:child_process');
    let done = false, found = false;
    const finish = (u) => { if (!done) { done = true; resolve(u); } };
    try { tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:' + port], { windowsHide: true }); }
    catch (e) { tunnel = null; }
    const noTunnel = () => {
      console.log("Mini App: https manzil yo'q, shuning uchun Telegramda ochilmaydi. Bot matn va ovoz bilan ishlayveradi.");
      console.log('  Yechim: cloudflared ni o\'rnating (Windows: winget install --id Cloudflare.cloudflared), terminalni yopib qayta oching va npm run dev qiling.');
      finish('');
    };
    if (!tunnel) return noTunnel();
    tunnel.on('error', () => { tunnel = null; noTunnel(); });
    const look = (b) => { if (done || found) return; const m = String(b).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) { found = true; console.log('Mini App manzili:', m[0]); setTimeout(() => finish(m[0]), 4000); } };
    tunnel.stdout.on('data', look); tunnel.stderr.on('data', look);
    tunnel.on('exit', () => { if (!done) noTunnel(); });
    setTimeout(() => { if (!done) { console.log('cloudflared javob bermadi.'); noTunnel(); } }, 30000);
  });
}

/* daily backup (first one a minute after start) */
const doBackup = () => { try { const f = db.backup(); if (f) console.log('backup:', path.basename(f)); } catch (e) { console.error('backup failed:', e.message); } };
setTimeout(doBackup, 60000).unref();
setInterval(doBackup, 6 * 3600000).unref();

/* Ctrl+C or a Railway redeploy: finish requests, then close the database cleanly */
let stopping = false;
function shutdown(sig) {
  if (stopping) return; stopping = true;
  console.log(sig, '- stopping');
  bot.stop && bot.stop();
  if (tunnel) try { tunnel.kill(); } catch (e) { /* gone */ }
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => { db.close(); process.exit(0); }, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (e) => console.error('unhandled:', e && e.message ? e.message : e));

module.exports = { verifyInitData, cleanState, mergeState };
