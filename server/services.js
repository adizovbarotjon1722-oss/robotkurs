'use strict';
/* Calls to Anthropic (conversation) and OpenAI (speech in and out), plus limits.
   Keys stay here on the server and never reach the phone. */
const db = require('./db');
const prompts = require('../shared/prompts');

const C = {
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  openaiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.CLAUDE_MODEL || 'claude-haiku-5-5',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  groqKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo',
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  freeDaily: +process.env.FREE_DAILY_AI || 200,
  premiumDaily: +process.env.PREMIUM_DAILY_AI || 400,
  freeTts: +process.env.FREE_DAILY_TTS_CHARS || 8000,
  premiumTts: +process.env.PREMIUM_DAILY_TTS_CHARS || 80000,
  freeStt: +process.env.FREE_DAILY_STT_SEC || 900,
  premiumStt: +process.env.PREMIUM_DAILY_STT_SEC || 7200
};

/* Calendar day in Uzbekistan, so limits and streaks reset at local midnight. */
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date()); }
/* the owner (ADMIN_IDS in .env) is never limited */
const OWNERS = String(process.env.ADMIN_IDS || '').split(',').map((s) => +s.trim()).filter(Boolean);
function isPremium(user) { return !!(user && (OWNERS.includes(user.id) || (user.premium_until && new Date(user.premium_until + 'Z') > new Date()))); }
function quota(user) {
  const u = db.usage(user.id, today()), prem = isPremium(user);
  const max = prem ? C.premiumDaily : C.freeDaily;
  return { premium: prem, left: Math.max(0, max - u.ai), max, ttsLeft: Math.max(0, (prem ? C.premiumTts : C.freeTts) - u.tts_chars), sttLeft: Math.max(0, (prem ? C.premiumStt : C.freeStt) - u.stt_sec) };
}

/* a stuck AI hands over to the next one after this long */
const AI_TIMEOUT = +process.env.AI_TIMEOUT_MS || 25000;
class ApiError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status || 400; } }

async function withTimeout(url, opts, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, Object.assign({}, opts, { signal: ac.signal })); }
  finally { clearTimeout(t); }
}

async function claude(messages, max) {
  if (!C.anthropicKey) throw new ApiError('not_configured', 503);
  const r = await withTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': C.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: C.model, max_tokens: Math.min(max || 800, 1200), messages })
  }, AI_TIMEOUT);
  if (!r.ok) {
    /* only the API's own error text is logged, never the conversation */
    let why = ''; try { const e = await r.json(); why = (e.error && (e.error.type + ': ' + e.error.message)) || ''; } catch (x) {}
    console.error('anthropic', r.status, why.slice(0, 300));
    const err = new ApiError('upstream', 502); err.http = r.status; err.why = why; throw err;
  }
  const j = await r.json();
  return (j.content || []).map((c) => c.text || '').join('');
}

/* Free option: Google Gemini (aistudio.google.com). Same prompts; roles map to user/model. */
async function gemini(messages, max) {
  if (!C.geminiKey) throw new ApiError('not_configured', 503);
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] }));
  const r = await withTimeout('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(C.geminiModel) + ':generateContent', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': C.geminiKey },
    /* extra room: newer Gemini models spend part of the budget on thinking */
    body: JSON.stringify({ contents, generationConfig: { maxOutputTokens: Math.max(1024, Math.min((max || 800) * 3, 4096)), responseMimeType: 'application/json', temperature: 0.8 } })
  }, AI_TIMEOUT);
  if (!r.ok) {
    let why = ''; try { const e = await r.json(); why = (e.error && (e.error.status + ': ' + e.error.message)) || ''; } catch (x) {}
    console.error('gemini', r.status, why.slice(0, 300));
    const err = new ApiError(r.status === 429 ? 'rate_limited' : 'upstream', r.status === 429 ? 429 : 502); err.http = r.status; err.why = why; throw err;
  }
  const j = await r.json();
  const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text.trim()) {
    const c = j.candidates && j.candidates[0];
    console.error('gemini: bo\'sh javob', (c && c.finishReason) || (j.promptFeedback && j.promptFeedback.blockReason) || '');
  }
  return text;
}
/* OpenAI-compatible chat (Groq, Cerebras, OpenRouter, Mistral, OpenAI) */
async function openaiLike(name, url, key, model, messages, max, json) {
  if (!key) throw new ApiError('not_configured', 503);
  const body = { model, messages: messages.map((m) => ({ role: m.role, content: String(m.content) })), max_tokens: Math.min(max || 800, 1500), temperature: 0.8 };
  if (json !== false) body.response_format = { type: 'json_object' };
  const r = await withTimeout(url, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'x-title': 'English Speaking' },
    body: JSON.stringify(body)
  }, AI_TIMEOUT);
  if (!r.ok) {
    let why = ''; try { const e = await r.json(); why = (e.error && (e.error.message || e.error)) || e.message || ''; } catch (x) {}
    console.error(name, r.status, String(why).slice(0, 300));
    const err = new ApiError(r.status === 429 ? 'rate_limited' : 'upstream', r.status === 429 ? 429 : 502);
    err.http = r.status; err.why = String(why); throw err;
  }
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

/* Free and paid OpenAI-compatible services. Models get retired now and then, so unless you set
   one in .env, the server asks the service which models this key can use and picks the best. */
const COMPAT = {
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', key: 'GROQ_API_KEY', model: 'GROQ_CHAT_MODEL',
    prefer: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'qwen/qwen3-32b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'] },
  cerebras: { label: 'Cerebras', base: 'https://api.cerebras.ai/v1', key: 'CEREBRAS_API_KEY', model: 'CEREBRAS_MODEL',
    prefer: ['gpt-oss-120b', 'llama-3.3-70b', 'qwen-3-235b-a22b-instruct-2507', 'qwen-3-32b', 'llama3.1-8b'] },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', key: 'OPENROUTER_API_KEY', model: 'OPENROUTER_MODEL', json: false, freeOnly: true,
    prefer: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free', 'deepseek/deepseek-chat-v3-0324:free', 'google/gemma-3-27b-it:free', 'qwen/qwen3-235b-a22b:free', 'mistralai/mistral-small-3.2-24b-instruct:free'] },
  mistral: { label: 'Mistral', base: 'https://api.mistral.ai/v1', key: 'MISTRAL_API_KEY', model: 'MISTRAL_MODEL',
    prefer: ['mistral-small-latest', 'mistral-medium-latest', 'open-mistral-nemo', 'ministral-8b-latest'] }
};
const SKIP_MODEL = /whisper|guard|tts|orpheus|playai|compound|distil|embed|moderation|ocr|vision|audio|image|transcri|codestral|pixtral/i;
const picked = {};
/* when none of the known good models is there, take the biggest one (a 1.7B model is too weak for teaching) */
const STRONG = [/gpt-oss-120b/, /llama-3\.3-70b/, /deepseek-(chat|v3|r1)/, /qwen3?-.*(235b|480b|coder)/, /kimi-k2/, /llama-4-maverick/, /gemma-3-27b/, /mistral-(small|medium)/, /glm-4/, /nemotron.*(49b|70b|253b)/];
function bestBySize(ids) {
  for (const re of STRONG) { const m = ids.find((x) => re.test(x)); if (m) return m; }
  const size = (x) => { const m = x.match(/(\d+(?:\.\d+)?)b\b/i); return m ? +m[1] : 0; };
  return ids.slice().sort((a, b) => size(b) - size(a))[0];
}
async function pickModel(id, refresh) {
  const p = COMPAT[id], fixed = process.env[p.model];
  if (fixed && !refresh) return fixed;
  if (picked[id] && !refresh) return picked[id];
  try {
    const r = await withTimeout(p.base + '/models', { headers: { authorization: 'Bearer ' + process.env[p.key] } }, 15000);
    let ids = ((await r.json()).data || []).filter((m) => m && m.active !== false).map((m) => m.id);
    if (p.freeOnly) ids = ids.filter((m) => /:free$/.test(m));
    picked[id] = p.prefer.find((m) => ids.includes(m)) || bestBySize(ids.filter((m) => !SKIP_MODEL.test(m))) || p.prefer[0];
  } catch (e) { picked[id] = picked[id] || p.prefer[0]; }
  console.log(id + ' model:', picked[id]);
  return picked[id];
}
async function compatChat(id, m, x) {
  const p = COMPAT[id], key = process.env[p.key], url = p.base + '/chat/completions';
  try { return await openaiLike(id, url, key, await pickModel(id), m, x, p.json); }
  catch (e) {
    if (e.http === 404 || (e.http === 400 && /model/i.test(e.why))) { delete process.env[p.model]; return openaiLike(id, url, key, await pickModel(id, true), m, x, p.json); }
    if (e.http === 400 && p.json !== false && /json|response_format/i.test(e.why)) return openaiLike(id, url, key, await pickModel(id), m, x, false);
    throw e;
  }
}

/* Every configured AI, in order. AI_PROVIDER (or AI_ORDER=gemini,groq,anthropic) puts one first.
   If one fails (no credit, limit, network), the next one answers, and the failed one rests for a while. */
const ENGINES = {
  anthropic: { key: () => C.anthropicKey, run: claude, label: 'Claude' },
  gemini: { key: () => C.geminiKey, run: gemini, label: 'Gemini' },
  groq: { key: () => process.env.GROQ_API_KEY, run: (m, x) => compatChat('groq', m, x), label: 'Groq' },
  cerebras: { key: () => process.env.CEREBRAS_API_KEY, run: (m, x) => compatChat('cerebras', m, x), label: 'Cerebras' },
  openrouter: { key: () => process.env.OPENROUTER_API_KEY, run: (m, x) => compatChat('openrouter', m, x), label: 'OpenRouter' },
  mistral: { key: () => process.env.MISTRAL_API_KEY, run: (m, x) => compatChat('mistral', m, x), label: 'Mistral' },
  openai: { key: () => C.openaiKey, run: (m, x) => openaiLike('openai', 'https://api.openai.com/v1/chat/completions', C.openaiKey, C.openaiChatModel, m, x), label: 'OpenAI' }
};
const DEFAULT_ORDER = ['anthropic', 'gemini', 'groq', 'cerebras', 'mistral', 'openrouter', 'openai'];
const speed = {}; /* seconds each AI took in the start-up test; failed ones are missing */
function order() {
  if (!process.env.AI_ORDER && Object.keys(speed).length) {
    /* fastest working AI first; AI_PROVIDER stays first only if it works and answers within 8 s */
    const fav = String(process.env.AI_PROVIDER || '').toLowerCase();
    const ok = Object.keys(speed).filter((s) => ENGINES[s].key()).sort((a, b) => speed[a] - speed[b]);
    if (ok.includes(fav) && speed[fav] <= 8) ok.splice(ok.indexOf(fav), 1), ok.unshift(fav);
    return ok.concat(DEFAULT_ORDER.filter((s) => !ok.includes(s) && ENGINES[s].key()));
  }
  const want = String(process.env.AI_ORDER || process.env.AI_PROVIDER || '').toLowerCase().split(',').map((s) => s.trim()).filter((s) => ENGINES[s]);
  const all = want.concat(DEFAULT_ORDER.filter((s) => !want.includes(s)));
  return all.filter((s) => ENGINES[s].key());
}
const resting = new Map();
const provider = () => order().filter((s) => !(resting.get(s) > Date.now())).concat(order())[0] || 'yoq';
let lastEngine = '';
async function complete(messages, max) {
  const list = order(); if (!list.length) throw new ApiError('not_configured', 503);
  let last;
  /* round 1: every AI that is not resting, in order. Round 2: if all failed, try every one again
     (a limit or a network hiccup is often gone a second later). */
  for (let round = 1; round <= 2; round++) {
    const now = Date.now();
    const names = round === 1 ? list.filter((s) => !(resting.get(s) > now)) : list;
    for (const name of names) {
      try {
        const text = await ENGINES[name].run(messages, max);
        if (!String(text).trim()) throw new ApiError('empty', 502);
        resting.delete(name); lastEngine = name;
        return text;
      } catch (e) {
        last = e;
        if (e.code === 'not_configured') continue;
        console.error('AI', name, 'ishlamadi:', e.code || e.name || '', e.code ? '' : String(e.message).slice(0, 200), "-> keyingisiga o'tyapman");
        /* no credit or bad key: rest long; a rate limit or network error: rest a little */
        const hard = e.http === 401 || e.http === 403 || e.http === 402 || /credit|billing|quota/i.test(e.why || '');
        resting.set(name, Date.now() + (hard ? 30 : 2) * 60000);
      }
    }
    if (round === 1) await new Promise((r) => setTimeout(r, 1500));
  }
  throw last && last.code === 'rate_limited' ? last : new ApiError('upstream', 502);
}
/* at start-up: try each AI once with a tiny request and print which ones work */
/* why an AI failed, in plain Uzbek (shown in the Mini App to the owner and printed in the terminal) */
function whyText(e) {
  const w = String(e.why || '');
  if (e.code === 'empty') return "bo'sh javob qaytardi";
  if (/terms acceptance/i.test(w)) return "Groq saytida shu ovoz modeli uchun shartlarni qabul qiling (console.groq.com/playground?model=canopylabs/orpheus-v1-english → Accept)";
  if (e.name === 'AbortError') return 'javob kelmadi (' + AI_TIMEOUT / 1000 + ' s)';
  if (e.http === 401 || e.http === 403 || /invalid.*key|api key not valid|unauthor/i.test(w)) return "kalit noto'g'ri yoki bloklangan";
  if (e.http === 402 || /credit|billing|quota|balance/i.test(w)) return "kredit (pul) tugagan yoki limit to'lgan";
  if (e.http === 429) return 'limitga urildi, birozdan keyin o\'tadi';
  if (e.http === 503 || /overloaded|high demand|unavailable/i.test(w)) return 'xizmat hozir band, keyinroq o\'tadi';
  if (e.http) return 'xato ' + e.http + (w ? ': ' + w.slice(0, 90) : '');
  return 'internet xatosi: ' + String((e.cause && e.cause.code) || e.message || e.code).slice(0, 80);
}
/* try every AI at once with a tiny request */
async function checkAI() {
  const ping = [{ role: 'user', content: 'Reply only with this JSON: {"ok":true}' }];
  return Promise.all(Object.keys(ENGINES).map(async (name) => {
    const r = { id: name, label: ENGINES[name].label };
    if (!ENGINES[name].key()) return Object.assign(r, { status: 'nokey' });
    const t0 = Date.now();
    try {
      const t = await ENGINES[name].run(ping, 200); if (!String(t).trim()) throw new ApiError('empty', 502);
      speed[name] = (Date.now() - t0) / 1000; resting.delete(name);
      return Object.assign(r, { status: 'ok', sec: +speed[name].toFixed(1), model: name === 'anthropic' ? C.model : name === 'gemini' ? C.geminiModel : name === 'openai' ? C.openaiChatModel : picked[name] || '' });
    } catch (e) { delete speed[name]; resting.set(name, Date.now() + 2 * 60000); return Object.assign(r, { status: 'fail', why: whyText(e) }); }
  }));
}
async function selfTest() {
  const res = await checkAI();
  res.forEach((r) => console.log('  ' + r.label + ': ' + (r.status === 'nokey' ? "kalit yo'q" : r.status === 'ok' ? 'ishlayapti ✓ (' + r.sec + ' s)' : 'ISHLAMAYAPTI ✗ (' + r.why + ')')));
  if (C.openaiKey && resting.get('openai') > Date.now()) voiceDown();
  console.log('Navbat (eng tezi birinchi): ' + order().filter((s) => speed[s] != null).join(' → ') + (order().some((s) => speed[s] == null) ? ' | zaxirada: ' + order().filter((s) => speed[s] == null).join(', ') : ''));
}

/* type + data in, text out. The prompt is always built here from a whitelist. */
async function runAI(user, type, payload) {
  if (!prompts.TYPES.includes(type)) throw new ApiError('bad_type');
  const q = quota(user);
  if (q.left <= 0) { console.log("AI: kunlik limit tugadi (" + q.max + " ta). Ko'paytirish: .env da FREE_DAILY_AI=500 yoki ADMIN_IDS ga Telegram ID ingizni yozing"); throw new ApiError('quota', 402); }
  let b;
  try { b = prompts.build(type, payload); } catch (e) { throw new ApiError('bad_payload'); }
  const t0 = Date.now();
  let text;
  try { text = await complete(b.messages, b.max); }
  catch (e) { console.log('AI: ' + type + ' ✗ hech bir AI javob bermadi (' + (e.code || e.message) + ')'); throw e; }
  console.log('AI: ' + type + ' ✓ ' + lastEngine + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  db.addUsage(user.id, today(), 1, 0, 0);
  return { text, quota: quota(user) };
}

const MOOD = { excited: 'very excited and bubbly', proud: 'proud and cheering', love: 'soft and affectionate', gentle: 'gentle and patient, reassuring', sad: 'soft and caring, a little sad', surprised: 'surprised and amazed', laughing: 'giggling and playful', thinking: 'curious and thoughtful', happy: 'cheerful and warm', neutral: 'calm and friendly', listening: 'calm and friendly', sleepy: 'calm and friendly' };
/* ---------- free live voice (no OpenAI credit needed) ----------
   Groq (English) and Gemini (English and Uzbek) can speak too. They return WAV audio,
   which the Mini App plays. Telegram voice messages need OGG, so the bot still uses text then. */
const FEMALE_V = ['shimmer', 'nova', 'coral', 'sage', 'ballad'];
function wavHeader(len, rate, ch, bits) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + len, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * bits / 8, 28);
  h.writeUInt16LE(ch * bits / 8, 32); h.writeUInt16LE(bits, 34); h.write('data', 36); h.writeUInt32LE(len, 40);
  return h;
}
/* several WAV files (same format) joined into one */
function wavJoin(list) {
  let fmt = null; const parts = [];
  for (const b of list) {
    if (b.toString('ascii', 0, 4) !== 'RIFF') { parts.push(b); continue; }
    let p = 12;
    while (p + 8 <= b.length) {
      const id = b.toString('ascii', p, p + 4); let size = b.readUInt32LE(p + 4);
      if (id === 'fmt ' && !fmt) fmt = { ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
      if (id === 'data') { if (size === 0xffffffff || p + 8 + size > b.length) size = b.length - p - 8; parts.push(b.subarray(p + 8, p + 8 + size)); break; }
      p += 8 + size + (size % 2);
    }
  }
  fmt = fmt || { ch: 1, rate: 24000, bits: 16 };
  const data = Buffer.concat(parts);
  return Buffer.concat([wavHeader(data.length, fmt.rate, fmt.ch, fmt.bits), data]);
}
const chunks = (text, n) => {
  const out = []; let cur = '';
  String(text).split(/(?<=[.!?…])\s+/).forEach((s) => {
    while (s.length > n) { const i = s.lastIndexOf(' ', n) > 20 ? s.lastIndexOf(' ', n) : n; if (cur) { out.push(cur); cur = ''; } out.push(s.slice(0, i)); s = s.slice(i).trim(); }
    if ((cur + ' ' + s).trim().length > n) { if (cur) out.push(cur); cur = s; } else cur = (cur + ' ' + s).trim();
  });
  if (cur) out.push(cur); return out.filter(Boolean);
};
const freeDown = {}; /* provider -> time until which it is skipped */
let groqTtsModel = '';
async function groqSpeak(text, female) {
  if (!C.groqKey) throw new ApiError('not_configured', 503);
  if (!groqTtsModel) {
    try {
      const r = await withTimeout('https://api.groq.com/openai/v1/models', { headers: { authorization: 'Bearer ' + C.groqKey } }, 15000);
      const ids = ((await r.json()).data || []).map((m) => m.id);
      groqTtsModel = process.env.GROQ_TTS_MODEL || ids.find((m) => /orpheus.*english|orpheus-v\d/i.test(m)) || ids.find((m) => /^playai-tts$/i.test(m)) || ids.find((m) => /tts|orpheus/i.test(m) && !/arabic/i.test(m)) || 'canopylabs/orpheus-v1-english';
    } catch (e) { groqTtsModel = process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english'; }
  }
  const playai = /playai/i.test(groqTtsModel);
  const voice = process.env['GROQ_TTS_VOICE_' + (female ? 'F' : 'M')] || (playai ? (female ? 'Arista-PlayAI' : 'Fritz-PlayAI') : (female ? 'diana' : 'troy'));
  const out = [];
  for (const part of chunks(text, 190)) {
    const r = await withTimeout('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + C.groqKey },
      body: JSON.stringify({ model: groqTtsModel, voice, input: part, response_format: 'wav' })
    }, 30000);
    if (!r.ok) {
      let why = ''; try { const e = await r.json(); why = (e.error && e.error.message) || ''; } catch (x) {}
      console.error('ovoz (groq ' + groqTtsModel + ')', r.status, String(why).slice(0, 300));
      if (/terms/i.test(why)) console.log("  -> console.groq.com saytida shu model uchun shartlarni (terms) qabul qiling, keyin ovoz ishlaydi.");
      const e = new ApiError(r.status === 429 ? 'rate_limited' : 'upstream', 502); e.http = r.status; e.why = why; throw e;
    }
    out.push(Buffer.from(await r.arrayBuffer()));
  }
  return wavJoin(out);
}
let geminiTtsModel = '';
async function geminiSpeak(text, female, uz) {
  if (!C.geminiKey) throw new ApiError('not_configured', 503);
  if (!geminiTtsModel) {
    try {
      const r = await withTimeout('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': C.geminiKey } }, 15000);
      const ids = ((await r.json()).models || []).map((m) => String(m.name).replace(/^models\//, ''));
      geminiTtsModel = process.env.GEMINI_TTS_MODEL || ids.find((m) => /flash.*tts/i.test(m)) || ids.find((m) => /tts/i.test(m)) || 'gemini-2.5-flash-preview-tts';
    } catch (e) { geminiTtsModel = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts'; }
  }
  const say = (uz ? 'Read this aloud in Uzbek, warmly: ' : 'Say in a friendly, natural, conversational tone: ') + text;
  const r = await withTimeout('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(geminiTtsModel) + ':generateContent', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': C.geminiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: say }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: female ? 'Kore' : 'Puck' } } } } })
  }, 30000);
  if (!r.ok) {
    let why = ''; try { const e = await r.json(); why = (e.error && e.error.message) || ''; } catch (x) {}
    console.error('ovoz (gemini ' + geminiTtsModel + ')', r.status, String(why).slice(0, 200));
    const e = new ApiError(r.status === 429 ? 'rate_limited' : 'upstream', 502); e.http = r.status; throw e;
  }
  const j = await r.json();
  const part = ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).find((p) => p.inlineData && p.inlineData.data);
  if (!part) throw new ApiError('upstream', 502);
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const rate = +((String(part.inlineData.mimeType || '').match(/rate=(\d+)/) || [])[1]) || 24000;
  return Buffer.concat([wavHeader(pcm.length, rate, 1, 16), pcm]);
}
const ttsCache = new Map();
async function freeSpeak(text, uz, female) {
  const key = (uz ? 'u' : 'e') + (female ? 'f' : 'm') + '|' + text;
  if (ttsCache.has(key)) return ttsCache.get(key);
  const order = uz ? ['gemini'] : ['groq', 'gemini'];
  let last;
  for (const p of order) {
    if (freeDown[p] > Date.now()) continue;
    try {
      const buf = p === 'groq' ? await groqSpeak(text, female) : await geminiSpeak(text, female, uz);
      if (ttsCache.size > 150) ttsCache.delete(ttsCache.keys().next().value);
      ttsCache.set(key, buf); return buf;
    } catch (e) {
      last = e; if (e.code === 'not_configured') continue;
      freeDown[p] = Date.now() + (e.code === 'rate_limited' ? 2 : 15) * 60000;
    }
  }
  throw last && last.code !== 'not_configured' ? last : new ApiError('not_configured', 503);
}
const freeVoiceOn = () => (!!C.groqKey && !(freeDown.groq > Date.now())) || (!!C.geminiKey && !(freeDown.gemini > Date.now()));

async function tts(user, text, uz, emotion, speed, format, voice, style) {
  /* OpenAI when it works; otherwise the free voices (Mini App only: WAV) */
  if (!voiceOn() || !C.openaiKey) {
    if (format !== 'mp3' || uz === 'mixed') throw new ApiError('not_configured', 503);
    text = String(text || '').trim().slice(0, 600);
    if (!text) throw new ApiError('bad_payload');
    if (quota(user).ttsLeft < text.length) throw new ApiError('quota', 402);
    const buf = await freeSpeak(text, !!uz, FEMALE_V.includes(voice) || !voice);
    db.addUsage(user.id, today(), 0, text.length, 0);
    buf.mime = 'audio/wav'; return buf;
  }
  if (!C.openaiKey) throw new ApiError('not_configured', 503);
  text = String(text || '').trim().slice(0, uz === 'mixed' ? 1200 : 600);
  if (!text) throw new ApiError('bad_payload');
  if (quota(user).ttsLeft < text.length) throw new ApiError('quota', 402);
  const mood = prompts.pick(MOOD, emotion, MOOD.happy);
  const r = await withTimeout('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + C.openaiKey },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts', voice: prompts.VOICES.includes(voice) ? voice : 'shimmer', input: text, response_format: format || 'mp3',
      speed: Math.min(1.25, Math.max(0.7, +speed || 1)),
      instructions: (uz === 'mixed' ? 'This is a vocabulary lesson: read English words and sentences in clear, slow English and the Uzbek translations (Latin script) in Uzbek, with a short pause between items. '
        : uz ? 'Speak in Uzbek (the text is Uzbek in Latin script), warmly, like a caring friend. '
        : 'Speak natural, relaxed conversational English like a friend on a phone call, not too fast. ') + (prompts.pick(prompts.STYLES, style) ? 'Speaking style: ' + prompts.STYLES[style].tts + '. ' : '') + 'Mood: ' + mood + '.'
    })
  }, 30000);
  if (!r.ok) { let why = ''; try { const e = await r.json(); why = (e.error && e.error.message) || ''; } catch (x) {} console.error('tts', r.status, String(why).slice(0, 300)); if (r.status === 401 || r.status === 429 && /quota|credit|billing/i.test(why)) voiceDown(); const err = new ApiError('upstream', 502); err.http = r.status; err.why = why; throw err; }
  db.addUsage(user.id, today(), 0, text.length, 0);
  return Buffer.from(await r.arrayBuffer());
}

const AUDIO_TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a' };
/* speech-to-text: Groq (free, Whisper large v3) when its key is set, otherwise OpenAI */
async function stt(user, buf, mime, seconds, lang, name) {
  const groq = !!C.groqKey;
  if (!groq && !C.openaiKey) throw new ApiError('not_configured', 503);
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[base];
  if (!ext) throw new ApiError('bad_audio', 415);
  const secs = Math.max(1, Math.round(seconds || buf.length / 4000));
  if (quota(user).sttLeft < secs) throw new ApiError('quota', 402);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: base }), 'speech.' + ext);
  fd.append('model', groq ? C.groqModel : 'whisper-1');
  if (lang !== 'auto') fd.append('language', 'en'); /* 'auto' lets the learner ask a question in Uzbek */
  fd.append('response_format', 'verbose_json');
  /* the companion's name is unusual for an English model: hint it so "Aziza" is not heard as "a pizza" */
  fd.append('prompt', (name ? 'Hey ' + name + '! ' : '') + (lang === 'auto' ? 'Hello! Salom, qalaysiz? How are you? Men yaxshiman.' : (name ? name + ', listen.' : '')));
  const r = await withTimeout(groq ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: 'Bearer ' + (groq ? C.groqKey : C.openaiKey) }, body: fd }, 45000);
  if (!r.ok) { let why = ''; try { const e = await r.json(); why = (e.error && e.error.message) || ''; } catch (x) {} console.error('Ovoz → matn ✗', r.status, String(why).slice(0, 300)); throw new ApiError('upstream', 502); }
  const j = await r.json();
  const segs = Array.isArray(j.segments) ? j.segments : [];
  /* whisper's average log-probability turned into a rough 0..1 clarity score */
  const conf = segs.length ? Math.exp(segs.reduce((a, s) => a + (s.avg_logprob || 0), 0) / segs.length) : null;
  db.addUsage(user.id, today(), 0, 0, Math.round(j.duration || secs));
  console.log('Ovoz → matn ✓ ' + Math.round(j.duration || secs) + ' s' + (String(j.text || '').trim() ? '' : " (bo'sh: hech narsa eshitilmadi)"));
  return { dur: Math.round((j.duration || secs) * 10) / 10, text: String(j.text || '').trim().slice(0, 2000), conf: conf == null ? null : Math.round(conf * 100) / 100 };
}

/* OpenAI voice: on when the key works. Without credit the Mini App uses the phone's own voice instead. */
let voiceOffUntil = 0;
const voiceDown = () => { if (voiceOffUntil < Date.now()) console.log("jonli ovoz: OpenAI ishlamadi, bepul ovozga (Groq/Gemini) o'tdim"); voiceOffUntil = Date.now() + 60 * 60000; };
const voiceOn = () => !!C.openaiKey && voiceOffUntil < Date.now();
const anyVoice = () => voiceOn() || freeVoiceOn();
/* at start-up: say "Hi" once to see which free voice works */
async function voiceTest() {
  if (voiceOn()) return;
  for (const p of ['groq', 'gemini']) {
    if (!(p === 'groq' ? C.groqKey : C.geminiKey)) continue;
    try { const b = p === 'groq' ? await groqSpeak('Hi there!', true) : await geminiSpeak('Hi there!', true, false); if (b.length > 1000) { console.log('Jonli ovoz: ' + p + ' ✓ (bepul)'); return; } }
    catch (e) { freeDown[p] = Date.now() + 15 * 60000; }
  }
  console.log("Jonli ovoz: bepul ovoz ham ishlamadi, Mini App telefon ovozini ishlatadi (Telegram ichida ba'zi telefonlarda ovoz chiqmasligi mumkin).");
}
/* ---------- AI keys that the owner can change from the Mini App ----------
   Keys typed in the app are stored encrypted in the database and win over .env / Railway variables.
   Clearing one goes back to the .env value. Nothing needs a restart. */
const crypto = require('node:crypto');
const KEY_DEFS = [
  { id: 'ANTHROPIC_API_KEY', label: 'Claude', engine: 'anthropic', site: 'console.anthropic.com', paid: true },
  { id: 'GEMINI_API_KEY', label: 'Gemini', engine: 'gemini', site: 'aistudio.google.com' },
  { id: 'GROQ_API_KEY', label: 'Groq', engine: 'groq', site: 'console.groq.com', note: "suhbat + ovozni tanish + jonli ovoz" },
  { id: 'CEREBRAS_API_KEY', label: 'Cerebras', engine: 'cerebras', site: 'cloud.cerebras.ai' },
  { id: 'MISTRAL_API_KEY', label: 'Mistral', engine: 'mistral', site: 'console.mistral.ai' },
  { id: 'OPENROUTER_API_KEY', label: 'OpenRouter', engine: 'openrouter', site: 'openrouter.ai' },
  { id: 'OPENAI_API_KEY', label: 'OpenAI', engine: 'openai', site: 'platform.openai.com', paid: true, note: 'eng tabiiy ovoz' }
];
const ENV0 = {}; KEY_DEFS.forEach((k) => { ENV0[k.id] = process.env[k.id] || ''; });
const SAVED = {};
const boxKey = () => crypto.createHash('sha256').update('qumri-keys|' + (process.env.BOT_TOKEN || '')).digest();
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', boxKey(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function unseal(b64) {
  try { const b = Buffer.from(b64, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', boxKey(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
  catch (e) { return ''; }
}
function applyKeys() {
  KEY_DEFS.forEach((k) => { process.env[k.id] = SAVED[k.id] || ENV0[k.id] || ''; });
  C.anthropicKey = process.env.ANTHROPIC_API_KEY; C.openaiKey = process.env.OPENAI_API_KEY; C.geminiKey = process.env.GEMINI_API_KEY; C.groqKey = process.env.GROQ_API_KEY;
}
function loadKeys() {
  let n = 0;
  KEY_DEFS.forEach((k) => { const v = db.kvGet('key:' + k.id); if (v) { const t = unseal(v); if (t) { SAVED[k.id] = t; n++; } } });
  applyKeys();
  if (n) console.log('Mini App orqali kiritilgan kalitlar: ' + n + ' ta');
}
const mask = (v) => (v ? '••••' + v.slice(-4) : '');
function keyList() {
  return KEY_DEFS.map((k) => ({ id: k.id, label: k.label, site: k.site, paid: !!k.paid, note: k.note || '',
    source: SAVED[k.id] ? 'app' : ENV0[k.id] ? 'env' : '', masked: mask(SAVED[k.id] || ENV0[k.id]),
    resting: !!(resting.get(k.engine) > Date.now()) }));
}
function setKey(id, value) {
  const def = KEY_DEFS.find((k) => k.id === id); if (!def) throw new ApiError('bad_key_id');
  const v = String(value || '').trim();
  if (v && !/^[\x21-\x7e]{10,300}$/.test(v)) throw new ApiError('bad_key_format');
  if (v) { SAVED[id] = v; db.kvSet('key:' + id, seal(v)); } else { delete SAVED[id]; db.kvDel('key:' + id); }
  applyKeys();
  /* forget everything learned about the old key */
  resting.delete(def.engine); delete speed[def.engine]; delete picked[def.engine];
  if (id === 'GROQ_API_KEY') { groqTtsModel = ''; delete freeDown.groq; }
  if (id === 'GEMINI_API_KEY') { geminiTtsModel = ''; delete freeDown.gemini; }
  if (id === 'OPENAI_API_KEY') voiceOffUntil = 0;
  console.log('Kalit yangilandi: ' + def.label + (v ? ' (' + mask(v) + ')' : " (o'chirildi)"));
  return keyList();
}
/* everything at once: every AI, speech-to-text and the live voice */
async function checkAll() {
  const ai = await checkAI();
  const voice = { stt: C.groqKey ? 'groq' : C.openaiKey ? 'openai' : '', tts: '' };
  if (C.openaiKey) voiceOffUntil = 0;
  if (C.openaiKey) { try { const r = await withTimeout('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + C.openaiKey }, body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'shimmer', input: 'Hi!', response_format: 'mp3' }) }, 20000); if (r.ok) voice.tts = 'openai'; else voiceDown(); } catch (e) { voiceDown(); } }
  if (!voice.tts) for (const p of ['groq', 'gemini']) {
    if (!(p === 'groq' ? C.groqKey : C.geminiKey)) continue;
    delete freeDown[p];
    try { const b = p === 'groq' ? await groqSpeak('Hi!', true) : await geminiSpeak('Hi!', true, false); if (b.length > 500) { voice.tts = p; break; } }
    catch (e) { freeDown[p] = Date.now() + 15 * 60000; voice[p + 'Why'] = whyText(e); }
  }
  return { ai, voice, order: order(), keys: keyList() };
}

module.exports = { C, keyList, setKey, loadKeys, checkAll, provider, selfTest, voiceTest, anyVoice, voiceOn, today, isPremium, quota, runAI, tts, stt, ApiError, prompts };
