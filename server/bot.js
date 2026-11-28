'use strict';
/* Telegram bot: only the essentials. Everything else lives in the Mini App. */
const db = require('./db');
const S = require('./services');
const L = require('./learn');

const TOKEN = process.env.BOT_TOKEN || '';
const API = 'https://api.telegram.org/bot' + TOKEN + '/';
const PREMIUM_STARS = +process.env.PREMIUM_STARS || 150;
const PREMIUM_DAYS = +process.env.PREMIUM_DAYS || 30;
const ADMINS = String(process.env.ADMIN_IDS || '').split(',').map((s) => +s.trim()).filter(Boolean);
let appUrl = '';

/* one quiet retry when the network drops for a moment (seen as "fetch failed" in the reminder logs) */
async function tg(method, body, again) {
  let r;
  try {
    r = await fetch(API + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(method === 'getUpdates' ? 45000 : 20000) });
  } catch (e) {
    if (again || method === 'getUpdates') throw e;
    await new Promise((ok) => setTimeout(ok, 2000));
    return tg(method, body, true);
  }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(method + ': ' + (j.description || r.status));
  return j.result;
}
const PRON = require('./pron');
/* how the word reads in Uzbek letters, shown after it: "deadline [dedlayn]" */
const rd = (w) => { const r = PRON.text(w); return r && r.toLowerCase() !== String(w).toLowerCase() ? ` <i>[${esc(r.toLowerCase())}]</i>` : ''; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/* without PUBLIC_URL (testing on your own computer) there is no Mini App yet: drop its buttons instead of failing */
function noAppButtons(extra) {
  const kb = extra && extra.reply_markup && extra.reply_markup.inline_keyboard;
  if (appUrl || !kb) return extra;
  const rows = kb.map((r) => r.filter((b) => !b.web_app)).filter((r) => r.length);
  const out = Object.assign({}, extra); if (rows.length) out.reply_markup = { inline_keyboard: rows }; else delete out.reply_markup;
  return out;
}
/* Telegram refuses messages over 4096 characters: cut long ones and drop the formatting so no tag is left half open */
const fit = (t) => (t.length <= 4000 ? t : t.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').slice(0, 3990) + '…');
const say = (chat, text, extra) => tg('sendMessage', Object.assign({ chat_id: chat, text: fit(String(text)), parse_mode: String(text).length <= 4000 ? 'HTML' : undefined, link_preview_options: { is_disabled: true } }, noAppButtons(extra) || {}));
/* voice messages (multipart) */
const sendVoiceFile = (chatId, ogg, name, caption) => { const fd = new FormData(); fd.append('chat_id', String(chatId)); if (caption) fd.append('caption', caption); fd.append('voice', new Blob([ogg], { type: 'audio/ogg' }), name || 'q.ogg'); return fetch(API + 'sendVoice', { method: 'POST', body: fd, signal: AbortSignal.timeout(30000) }); };
/* per-user flood guard: a few messages a minute is plenty for a person */
const flood = new Map();
function tooFast(id, perMin) {
  const now = Date.now(), b = flood.get(id) || { n: 0, at: now };
  if (now - b.at > 60000) { b.n = 0; b.at = now; }
  b.n++; flood.set(id, b);
  if (flood.size > 5000) for (const [k, v] of flood) if (now - v.at > 60000) flood.delete(k);
  return b.n > perMin;
}
const appBtn = (text, mode) => ({ text, web_app: { url: appUrl + (mode ? '/?mode=' + mode : '/') } });
const appBtn2 = (text, room) => ({ text, web_app: { url: appUrl + '/?room=' + room } });
const appKeyboard = () => ({ inline_keyboard: [[appBtn('🗣 Gaplashish')], [appBtn2("📚 So'z yodlash", 'words')]] });
/* the name the learner gave their companion (empty until they choose one) */
const nameOf = (st) => S.prompts.cleanName(st && st.settings && st.settings.char && st.settings.char.name, '');

const EMO = { happy: '😊', excited: '🤩', love: '🥰', proud: '😎', thinking: '🤔', gentle: '🤗', surprised: '😮', sad: '🥺', laughing: '😂' };

/* ---------- progress helpers (same data the Mini App stores) ---------- */
function minutes(state, day) { return Math.floor(((state.days || {})[day] || 0) / 60000); }
function dayKey(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(d); }
function lastDays(n, from) { const out = [], d = from ? new Date(from) : new Date(); for (let i = 0; i < n; i++) { out.push(dayKey(d)); d.setDate(d.getDate() - 1); } return out; }
/* weekly report: last 7 days against the 7 before */
function weekReport(st) {
  const now = lastDays(7), prev = lastDays(14).slice(7);
  const mins = (ds) => Math.round(ds.reduce((a, d) => a + ((st.days || {})[d] || 0), 0) / 60000);
  const active = now.filter((d) => ((st.days || {})[d] || 0) >= 60000).length;
  const mis = (st.mistakes || []), newM = mis.filter((m) => now.includes(m.day)).length, learned = mis.filter((m) => (m.ok || 0) >= 2).length;
  const w1 = S.prompts.wpm(st.flu, now), w0 = S.prompts.wpm(st.flu, prev);
  const weak = S.prompts.weakOf(mis).slice(0, 2);
  const m1 = mins(now), m0 = mins(prev);
  let t = `📅 <b>Haftalik hisobot</b>\n\n⏱ Gaplashdingiz: <b>${m1} daqiqa</b>${m0 ? ` (o'tgan hafta ${m0})` : ''}\n📆 Faol kunlar: <b>${active}/7</b>\n🔥 Ketma-ket: ${streak(st)} kun`;
  if (w1) t += `\n🗣 Gapirish tezligi: <b>${w1} so'z/daqiqa</b>${w0 ? (w1 > w0 ? ` ⬆️ (+${w1 - w0})` : w1 < w0 ? ` (o'tgan hafta ${w0})` : '') : ''}`;
  t += `\n📝 Yangi xatolar: ${newM} ta, o'zlashtirilgan: ${learned} ta`;
  if (weak.length) t += `\n🎯 Shu hafta e'tibor bering: <b>${weak.map((x) => esc(x.label)).join(', ')}</b>`;
  t += '\n\n' + (active >= 5 ? "Zo'r hafta! Shu sur'atda davom eting 💪" : active >= 2 ? "Yaxshi boshlanish. Keyingi hafta har kuni 10 daqiqadan gaplashib ko'ramiz?" : "Bu hafta kam gaplashdik. Ertaga atigi 5 daqiqadan boshlaymiz, kelishdikmi?");
  return t;
}
async function cmdReport(msg, user) { await say(msg.chat.id, weekReport(db.getState(user.id)), { reply_markup: appKeyboard() }); }
function streak(state) {
  let n = 0; const d = new Date();
  if (minutes(state, dayKey(d)) < 1) d.setDate(d.getDate() - 1);
  while (minutes(state, dayKey(d)) >= 1) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* ---------- commands ---------- */
async function cmdStart(msg, user) {
  await say(msg.chat.id,
    (nameOf(db.getState(user.id)) ? `Salom, ${esc(user.first_name || "do'stim")}! Men <b>${esc(nameOf(db.getState(user.id)))}</b>man.` : `Salom, ${esc(user.first_name || "do'stim")}! Men sizning ingliz tili hamrohingizman. Menga ism bering: <code>/name Aziza</code>`) + `

Keling, inglizcha xuddi do'stlardek bemalol gaplashamiz. Xato qilsangiz, o'zbekcha tushuntiraman, savol bersangiz, ikki tilda javob beraman.

Pastdagi tugmani bosing yoki shu yerga ovozli xabar yuboring.`,
    { reply_markup: appKeyboard() });
}
const dueWords = (st) => (st.words || []).filter((w) => (w.due || '') <= S.today());
async function cmdStats(msg, user) {
  const st = db.getState(user.id), q = S.quota(user), t = S.today();
  const total = Math.floor(Object.values(st.days || {}).reduce((a, b) => a + b, 0) / 60000);
  const goal = (st.settings && st.settings.goal) || 10, w = st.words || [];
  const weak = S.prompts.weakOf(st.mistakes).slice(0, 3), sp = S.prompts.wpm(st.flu, lastDays(7));
  const extra = (sp ? `\n🗣 Gapirish tezligi: <b>${sp} so'z/daqiqa</b> (7 kun)` : '') + (weak.length ? `\n🎯 Zaif tomonlar: ${weak.map((x) => esc(x.label) + ' (' + x.n + ')').join(', ')}` : '');
  await say(msg.chat.id,
    `📊 <b>Natijalaringiz</b>\n\n🔥 Ketma-ket: <b>${streak(st)} kun</b>\n⏱ Bugun: <b>${minutes(st, t)}/${goal} daqiqa</b>\n🕰 Jami: ${total} daqiqa\n📚 So'zlar: ${w.length} ta, yodlangan: ${w.filter((x) => (x.box || 0) >= 4).length} ta\n🔁 Bugun takrorlash: ${dueWords(st).length} ta${extra}\n\n${q.premium ? '⭐ Premium faol' : `Bugun ${q.left} ta bepul javob qoldi`}`,
    { reply_markup: appKeyboard() });
}
async function cmdWords(msg, user) {
  const st = db.getState(user.id), d = dueWords(st).slice(0, 7);
  if (!(st.words || []).length) return say(msg.chat.id, "Daftaringiz hali bo'sh. Mini Appda tayyor to'plam tanlang yoki men bilan gaplashing.", { reply_markup: appKeyboard() });
  if (!d.length) return say(msg.chat.id, "🎉 Bugungi takrorlash tugagan! Ertaga yana eslataman.");
  /* the same words as a short audio lesson: listen on the way to work */
  sendWordAudio(msg.chat.id, user, d.slice(0, 6)).catch(() => {});
  await say(msg.chat.id, "🔁 <b>Bugun takrorlash kerak:</b>\n\n" + d.map((x) => `• <b>${esc(x.w)}</b>${rd(x.w)} — <tg-spoiler>${esc(x.uz)}</tg-spoiler>`).join('\n') + "\n\nTarjimasini ko'rish uchun bosing. Tugmali test yoki to'liq mashq:", { reply_markup: { inline_keyboard: [[{ text: '🧠 Test (5 ta savol)', callback_data: 'rv:new:0' }], [appBtn2("📚 Kartochkalarni ochish", 'words')]] } });
}
async function cmdPremium(msg, user) {
  if (S.isPremium(user)) return say(msg.chat.id, `⭐ Premium faol: ${esc(user.premium_until)} gacha (UTC).`);
  await tg('sendInvoice', invoiceBody(user.id, msg.chat.id));
}
function invoiceBody(userId, chatId) {
  const b = {
    title: 'Premium', description: `${PREMIUM_DAYS} kun: cheklovsiz suhbat, jonli AI ovoz va yodlash hiylalari.`,
    payload: 'prem:' + userId, currency: 'XTR', prices: [{ label: `${PREMIUM_DAYS} kun`, amount: PREMIUM_STARS }]
  };
  if (chatId) b.chat_id = chatId;
  return b;
}
async function invoiceLink(userId) { return tg('createInvoiceLink', invoiceBody(userId)); }
const hh = (h) => String(h).padStart(2, '0') + ':00';
const remindKb = (hours) => ({ inline_keyboard: [
  db.HOURS.slice(0, 4).map((h) => ({ text: (hours.includes(h) ? '✅ ' : '') + hh(h), callback_data: 'rh:' + h })),
  db.HOURS.slice(4).map((h) => ({ text: (hours.includes(h) ? '✅ ' : '') + hh(h), callback_data: 'rh:' + h })),
  [{ text: hours.length ? "🔕 Hammasini o'chirish" : '🔔 09:00, 15:00, 20:00', callback_data: hours.length ? 'rh:off' : 'rh:def' }]] });
const remindText = (hours) => hours.length
  ? `🔔 <b>Eslatmalar:</b> ${hours.map(hh).join(', ')} (Toshkent vaqti)\n\nNavbat bilan eslataman: 1-soat <b>tinglash</b> (1 daqiqalik hikoya va savollar), 2-soat <b>gapirish mashqi</b> (savol, ovozli javob), 3-soat <b>so'z yodlash</b> (tugmali test). Siz faol bo'lsangiz, bezovta qilmayman.\n\nSoatlarni bosib yoqing yoki o'chiring:`
  : "🔕 Eslatmalar o'chiq. Soat tanlang:";
async function cmdRemind(msg, user) {
  const h = db.hours(user);
  await say(msg.chat.id, remindText(h), { reply_markup: remindKb(h) });
}
/* ---------- 🚀 Tez gapirish: the 300 ready-made phrases (same list as the Mini App) ---------- */
const SPEAK = (() => { try { return require('../web/speak.js'); } catch (e) { console.error('speak.js not loaded:', e.message); return { days: [] }; } })();
const spDone = (st) => (st.speak && Array.isArray(st.speak.done) ? st.speak.done : []);
const spCur = (st) => { const d = spDone(st); for (let i = 0; i < SPEAK.days.length; i++) if (!d.includes(i)) return i; return 0; };
/* the day the companion should nudge in the bot chat (only once the learner has started) */
const spChat = (st) => (spDone(st).length || (st.speak && st.speak.started) ? spCur(st) : undefined);
const spName = (user) => (/^[A-Za-z' -]{2,20}$/.test((user && user.first_name) || '') ? user.first_name : 'Alex');
function speakText(d, user, st) {
  const day = SPEAK.days[d]; if (!day) return '';
  const lines = day.list.map((x, i) => { const [en, uz] = x.split('|').map((t) => t.replace('{name}', spName(user))); return `${i + 1}. <b>${esc(en)}</b>\n   🔤 <i>${esc(PRON.text(en))}</i>\n   <tg-spoiler>${esc(uz)}</tg-spoiler>`; });
  return `🚀 <b>Tez gapirish · ${d + 1}-kun: ${esc(day.t)}</b> ${day.ic}\n${spDone(st).length}/${SPEAK.days.length} kun o'tildi\n\n` + lines.join('\n') + "\n\nHar birini ovoz chiqarib 3 marta ayting. Mini Appda: tinglash, takrorlash, tez tarjima va rolli suhbat.";
}
function speakKb(d) {
  const nav = [];
  if (d > 0) nav.push({ text: '◀ ' + d + '-kun', callback_data: 'sp:' + (d - 1) });
  if (d < SPEAK.days.length - 1) nav.push({ text: (d + 2) + '-kun ▶', callback_data: 'sp:' + (d + 1) });
  return { inline_keyboard: [[appBtn2('🚀 Mashq va rolli suhbat', 'speak')], nav] };
}
async function cmdSpeak(msg, user) {
  const st = db.getState(user.id), d = spCur(st);
  await say(msg.chat.id, speakText(d, user, st), { reply_markup: speakKb(d) });
}
async function onCallback(cq) {
  if (!cq.from || cq.from.is_bot) return;
  const user = db.touchUser(cq.from); if (user.banned) return;
  if (tooFast('c' + user.id, 40)) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Sekinroq 🙂' }).catch(() => {});
  const tm = String(cq.data || '').match(/^tt:(show|next)$/);
  if (tm && cq.message) return onTranslateCb(cq, user, tm[1]);
  const spm = String(cq.data || '').match(/^sp:(\d{1,2})$/);
  if (spm && cq.message) {
    const d = Math.min(SPEAK.days.length - 1, +spm[1]), st = db.getState(user.id);
    await tg('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
    return tg('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: speakText(d, user, st), parse_mode: 'HTML', reply_markup: speakKb(d) }).catch(() => {});
  }
  const rm = String(cq.data || '').match(/^rv:([a-z0-9]{1,8}):(\d|x)$/);
  if (rm && cq.message) return onReview(cq, user, rm[1], rm[2]);
  const sm = String(cq.data || '').match(/^set:(lang|gender):(both|en|auto|female|male)$/);
  if (sm && cq.message) {
    const st = db.getState(user.id); st.settings = st.settings || {};
    if (sm[1] === 'lang' && ['both', 'en'].includes(sm[2])) st.settings.lang = sm[2];
    if (sm[1] === 'gender' && ['auto', 'female', 'male'].includes(sm[2])) st.settings.gender = sm[2];
    db.putState(user.id, st);
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Saqlandi' }).catch(() => {});
    return tg('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: setText(), parse_mode: 'HTML', reply_markup: setKb(st.settings) }).catch(() => {});
  }
  const m = String(cq.data || '').match(/^rh:(\d{1,2}|off|def)$/);
  if (!m || !cq.message) return tg('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {});
  let h = db.hours(user);
  if (m[1] === 'off') h = []; else if (m[1] === 'def') h = [9, 15, 20];
  else { const x = +m[1]; h = h.includes(x) ? h.filter((y) => y !== x) : h.concat(x); }
  h = db.setHours(user.id, h);
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: h.length ? 'Saqlandi' : "O'chirildi" }).catch(() => {});
  await tg('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: remindText(h), parse_mode: 'HTML', reply_markup: remindKb(h) }).catch(() => {});
}
async function cmdName(msg, user, arg) {
  const st = db.getState(user.id), cur = nameOf(st);
  const n = S.prompts.cleanName(arg, '');
  if (!n) return say(msg.chat.id, (cur ? `Hozirgi ismim: <b>${esc(cur)}</b>.\n\n` : '') + "Menga ism bering, masalan: <code>/name Aziza</code>\nFaqat harflar, 20 tagacha.");
  st.settings = st.settings || {}; st.settings.char = Object.assign({ id: 'nur', color: '', acc: 'none' }, st.settings.char || {}, { name: n });
  db.putState(user.id, st);
  await say(msg.chat.id, `🥰 Labbay! Endi ismim <b>${esc(n)}</b>. "${esc(n)}!" deb yozsangiz yoki aytsangiz, "Labbay!" deb javob beraman.`);
}
/* language of the answers and the companion's voice */
const setText = () => "⚙️ <b>Sozlamalar</b>\n\n<b>Javob tili:</b> ikki tilda bo'lsa, har bir inglizcha javob ostida o'zbekchasi ham yoziladi.\n<b>Ovoz:</b> hamroh ayol yoki erkak ovozida gapiradi (jonli ovoz va Mini App).";
function setKb(s) {
  s = s || {}; const lang = s.lang === 'en' ? 'en' : 'both', g = ['female', 'male'].includes(s.gender) ? s.gender : 'auto';
  const b = (on, text, data) => ({ text: (on ? '✅ ' : '') + text, callback_data: data });
  return { inline_keyboard: [
    [b(lang === 'both', '🇬🇧+🇺🇿 Ikki tilda', 'set:lang:both'), b(lang === 'en', '🇬🇧 Faqat inglizcha', 'set:lang:en')],
    [b(g === 'female', '👩 Ayol', 'set:gender:female'), b(g === 'male', '👨 Erkak', 'set:gender:male'), b(g === 'auto', '✨ Hamrohniki', 'set:gender:auto')]] };
}
async function cmdAbout(msg, user, arg) {
  const st = db.getState(user.id); st.settings = st.settings || {};
  const t = String(arg || '').trim().slice(0, 200);
  if (!t) return say(msg.chat.id, (st.settings.about ? `Hozir bilganim: <i>${esc(st.settings.about)}</i>\n\n` : '') + "O'zingiz haqingizda yozing, men suhbatni shunga moslayman. Masalan:\n<code>/about Muhandisman, ingliz tili ish va sayohat uchun kerak</code>");
  st.settings.about = t; db.putState(user.id, st);
  await say(msg.chat.id, "👍 Tushundim! Endi suhbatlarimiz ishingiz va sayohatlaringiz haqida bo'ladi.");
}
async function cmdSettings(msg, user) { await say(msg.chat.id, setText(), { reply_markup: setKb(db.getState(user.id).settings) }); }
async function cmdHelp(msg) {
  await say(msg.chat.id, "/start — boshlash\n/ibora — 🚀 tez gapirish: bugungi 10 ta eng kerakli ibora\n/stats — natijalarim\n/words — bugun takrorlanadigan so'zlar\n/review — so'z yodlash (tugmali test, 5 ta savol)\n/dars — bugungi 10 daqiqalik dars\n/audio — o'rgangan so'zlaringizdan 2-3 daqiqalik dialog yoki hikoya\n/ertak — ertak va qo'shiqlar (darajangizga mos)\n/tarjima — tez tarjima mashqi\n/tinglash — 1 daqiqalik hikoya va savollar\n/premium — Premium (Telegram Stars)\n/remind — eslatma soatlari (bot o'zi savol yuboradi)\n/name — hamrohga ism berish\n/settings — javob tili (ikki tilda) va ovoz (ayol/erkak)\n/about — o'zingiz haqingizda (masalan: muhandisman), suhbat shunga moslashadi\n/report — haftalik hisobot (har yakshanba 20:00 da o'zim ham yuboraman)\n\nBotga ovozli yoki matnli xabar yuborsangiz ham, javob beraman. Ismimni yozsangiz yoki aytsangiz, \"Labbay!\" deyman.", { reply_markup: appKeyboard() });
}
async function cmdAdmin(msg, user, arg) {
  if (!ADMINS.includes(user.id)) return;
  const [sub, id] = String(arg || '').split(/\s+/);
  if (sub === 'ban' && +id) { db.setBanned(+id, true); return say(msg.chat.id, 'ban: ' + (+id)); }
  if (sub === 'unban' && +id) { db.setBanned(+id, false); return say(msg.chat.id, 'unban: ' + (+id)); }
  const s = db.stats(S.today());
  await say(msg.chat.id, `Foydalanuvchilar: ${s.users}\nBugun faol: ${s.activeToday}\nPremium: ${s.premium}`);
}

async function sendWordAudio(chatId, user, list) {
  if (!list.length) return;
  const script = list.map((w) => `${w.w}. ... ${w.uz}. ... ${w.ex || w.w}. ... ${w.w}.`).join('\n\n');
  const ogg = await S.tts(user, script, 'mixed', 'happy', 0.9, 'opus');
  await sendVoiceFile(chatId, ogg, 'words.ogg', "🎧 Ovozli takrorlash: tinglang va ovoz chiqarib qaytaring");
}

/* ---------- quick chat in the bot (voice or text) ---------- */
async function quickChat(msg, user, text, dur) {
  const st = db.getState(user.id);
  const myName = nameOf(st);
  if (myName && S.prompts.calledBy(text, myName) === 'only') {
    st.botTurns = (st.botTurns || []).concat([{ role: 'user', content: text }, { role: 'assistant', content: JSON.stringify({ emotion: 'happy', reply: "Labbay! Yes, I'm here. I'm listening." }) }]).slice(-10);
    db.putState(user.id, st);
    await say(msg.chat.id, "😊 <b>Labbay!</b> Yes, I'm here. I'm listening.\n<i>Eshitaman, gapiring.</i>");
    if (msg.voice) S.tts(user, 'Labbay! Eshitaman, gapiring.', true, 'happy', 1, 'opus', S.prompts.voiceFor((st.settings && st.settings.char && st.settings.char.id) || 'nur', st.settings && st.settings.gender))
      .then((ogg) => sendVoiceFile(msg.chat.id, ogg, 'labbay.ogg')).catch(() => {});
    return;
  }
  const turns = (st.botTurns || []).slice(-10);
  turns.push({ role: 'user', content: text });
  await tg('sendChatAction', { chat_id: msg.chat.id, action: 'typing' }).catch(() => {});
  let r;
  const tgt = L.targets(st.words, 5);
  try {
    const ch = (st.settings && st.settings.char) || {};
    const out = await S.runAI(user, 'chat', { character: ch.id, name: ch.name, style: st.settings && st.settings.style, corrections: st.settings && st.settings.corrections, lang: st.settings && st.settings.lang, about: st.settings && st.settings.about, weak: S.prompts.weakOf(st.mistakes).map((x) => x.cat), topic: 'free', level: (st.settings && st.settings.level) || 'B1', turns, learning: tgt.map((w) => w.w), speakDay: spChat(st) });
    const m = out.text.match(/\{[\s\S]*\}/);
    try { r = m ? JSON.parse(m[0]) : null; } catch (x) { r = null; }
    if (!r || !r.reply) r = { emotion: 'happy', reply: (r && r.reply) || out.text.replace(/[{}"]/g, '').slice(0, 600) };
  } catch (e) {
    console.error('bot chat:', e.code || '', String(e.message || '').slice(0, 200));
    if (e.code === 'quota') return say(msg.chat.id, "Bugungi bepul javoblar tugadi 🥺 Ertaga yana keling yoki /premium oling.");
    return say(msg.chat.id, 'Hozir javob bera olmadim. Birozdan keyin qayta yuboring.');
  }
  turns.push({ role: 'assistant', content: JSON.stringify({ emotion: r.emotion, reply: r.reply }) });
  /* the AI call takes seconds: the app may have saved meanwhile, so write onto the newest copy */
  const fresh = db.getState(user.id), now = Date.now();
  fresh.botTurns = turns.slice(-10);
  const tips = (Array.isArray(r.tips) ? r.tips : r.tip ? [r.tip] : []).filter((x) => x && x.better).slice(0, 3);
  fresh.mistakes = (fresh.mistakes || []).concat(tips.filter((x) => !(fresh.mistakes || []).some((m) => m.better.toLowerCase() === String(x.better).toLowerCase()))
    .map((x) => ({ cat: S.prompts.CATS[x.cat] ? x.cat : undefined, said: String(x.said || '').slice(0, 200), better: String(x.better).slice(0, 200), en: String(x.en || '').slice(0, 200), uz: String(x.uz || '').slice(0, 300), day: S.today(), n: 1, ok: 0, t: now }))).slice(-200);
  (Array.isArray(r.new_words) ? r.new_words : []).slice(0, 2).forEach((w) => {
    if (w && w.w && !(fresh.words || []).some((x) => x.w.toLowerCase() === String(w.w).toLowerCase())) fresh.words = (fresh.words || []).concat([{ w: String(w.w).slice(0, 60), uz: String(w.uz || '').slice(0, 120), ex: String(w.ex || '').slice(0, 200), box: 0, due: S.today(), src: 'bot', t: now }]);
  });
  /* today's words the learner used correctly count as a successful review */
  const usedNames = L.usedWords(text, tgt, r.used_words).map((w) => w.w.toLowerCase());
  const used = (fresh.words || []).filter((w) => usedNames.includes(String(w.w).toLowerCase()) && w.usedDay !== L.tday());
  used.forEach(L.markUsed);
  if (dur) fresh.flu = S.prompts.fluAdd(fresh.flu, S.today(), S.prompts.fluTurn(text, dur));
  db.putState(user.id, fresh);

  let out = (EMO[r.emotion] || '😊') + ' ';
  if (r.praise_uz) out += esc(r.praise_uz) + '\n\n';
  if (used.length) out += `🎯 Bugungi so'zni to'g'ri ishlatdingiz: <b>${used.map((w) => esc(w.w)).join(', ')}</b> (yodlandi deb belgilandi)\n\n`;
  out += '<b>' + esc(r.reply || '') + '</b>';
  if (r.reply_uz && !(st.settings && st.settings.lang === 'en')) out += '\n🇺🇿 <i>' + esc(r.reply_uz) + '</i>';
  if (tips.length) out += '\n\n📝 <i>Xatolar tahlili:</i>' + tips.map((x) => '\n' + (x.said ? '❌ <s>' + esc(x.said) + '</s>\n' : '') + '✅ <b>' + esc(x.better) + '</b>' + (x.en ? '\n<i>' + esc(x.en) + '</i>' : '') + (x.uz ? '\n' + esc(x.uz) : '')).join('\n');
  if (r.upgrade && r.upgrade.en) out += '\n\n✨ <i>Yanada tabiiy aytish:</i>\n<b>' + esc(r.upgrade.en) + '</b>' + (r.upgrade.uz ? '\n' + esc(r.upgrade.uz) : '');
  if (r.explain && (r.explain.en || r.explain.uz)) {
    out += '\n\n📖 <b>Tushuntirish</b>\n🇬🇧 ' + esc(r.explain.en || '') + '\n🇺🇿 ' + esc(r.explain.uz || '');
    (Array.isArray(r.explain.examples) ? r.explain.examples : []).slice(0, 3).forEach((e) => { if (e && e.en) out += '\n• <b>' + esc(e.en) + '</b>' + (e.uz ? ' — ' + esc(e.uz) : ''); });
  }
  (Array.isArray(r.new_words) ? r.new_words : []).slice(0, 2).forEach((w) => { if (w && w.w) out += `\n📚 +${esc(w.w)} — ${esc(w.uz || '')}`; });
  await say(msg.chat.id, out, { reply_markup: { inline_keyboard: [[appBtn("Mini Appda davom ettirish")]] } });
  if (msg.voice) {
    try {
      const ch = (st.settings && st.settings.char) || {};
      const ogg = await S.tts(user, r.reply || '', false, r.emotion, 1, 'opus', S.prompts.voiceFor(ch.id, st.settings && st.settings.gender), st.settings && st.settings.style);
      await sendVoiceFile(msg.chat.id, ogg, 'qumri.ogg');
    } catch (e) { /* text reply already sent */ }
  }
}
async function handleVoice(msg, user) {
  const v = msg.voice;
  if (v.duration > 90) return say(msg.chat.id, 'Ovozli xabar 90 soniyadan qisqa bo\'lsin, iltimos.');
  if (v.file_size && v.file_size > 3 * 1024 * 1024) return say(msg.chat.id, 'Fayl juda katta.');
  await tg('sendChatAction', { chat_id: msg.chat.id, action: 'typing' }).catch(() => {});
  const f = await tg('getFile', { file_id: v.file_id });
  const r = await fetch('https://api.telegram.org/file/bot' + TOKEN + '/' + f.file_path);
  const buf = Buffer.from(await r.arrayBuffer());
  let t;
  try { t = await S.stt(user, buf, 'audio/ogg', v.duration, 'en', nameOf(db.getState(user.id))); }
  catch (e) { return say(msg.chat.id, e.code === 'quota' ? "Bugungi ovoz limiti tugadi. Yozib yuboring yoki /premium oling." : "Ovozni tushunolmadim. Qayta yuboring."); }
  if (!t.text) return say(msg.chat.id, 'Hech narsa eshitmadim 🤔 Yana bir bor ayting-chi.');
  await say(msg.chat.id, '🎧 <i>' + esc(t.text) + '</i>');
  if (await checkTranslate(msg, user, t.text)) return;
  return quickChat(msg, user, t.text, t.dur || v.duration);
}

/* ---------- word review in the chat: 5 quick questions with buttons ---------- */
const RV_N = 5;
function rvQuestion(st) {
  const rv = st.rv, w = (st.words || []).find((x) => x.w === rv.list[rv.i]);
  if (!w) return null;
  const o = L.options(w, st.words); rv.opts = o.opts; rv.right = o.right;
  const text = `📚 <b>So'z yodlash</b> · ${rv.i + 1}/${rv.list.length}\n\n🔤 <b>${esc(w.w)}</b>${rd(w.w)}\n\nMa'nosi qaysi?`;
  const kb = o.opts.map((u, i) => [{ text: u, callback_data: 'rv:' + rv.id + ':' + i }]);
  kb.push([{ text: '🤷 Bilmayman', callback_data: 'rv:' + rv.id + ':x' }]);
  return { text, reply_markup: { inline_keyboard: kb } };
}
/* starts a new round; returns false when there is nothing to review */
async function startReview(chatId, user, intro, editOf) {
  const st = db.getState(user.id), list = L.reviewList(st.words, RV_N);
  if (!list.length) return false;
  st.rv = { id: Math.random().toString(36).slice(2, 8), list, i: 0, ok: 0 };
  const q = rvQuestion(st); if (!q) return false;
  db.putState(user.id, st);
  const text = (intro ? intro + '\n\n' : '') + q.text;
  if (editOf) await tg('editMessageText', { chat_id: chatId, message_id: editOf, text, parse_mode: 'HTML', reply_markup: q.reply_markup }).catch(() => say(chatId, text, { reply_markup: q.reply_markup }));
  else await say(chatId, text, { reply_markup: q.reply_markup });
  return true;
}
async function cmdReview(msg, user) {
  const ok = await startReview(msg.chat.id, user, '');
  if (!ok) await say(msg.chat.id, (db.getState(user.id).words || []).length ? "🎉 Bugungi takrorlash tugagan! Mini Appda yangi so'zlar oling yoki ertaga davom etamiz." : "Daftaringiz hali bo'sh. Mini Appda \"3000 so'z kursi\" ni oching.", { reply_markup: { inline_keyboard: [[appBtn2("📚 So'zlar", 'words')]] } });
}
async function onReview(cq, user, id, pick) {
  const chatId = cq.message.chat.id, mid = cq.message.message_id;
  if (id === 'new') { await tg('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {}); if (!(await startReview(chatId, user, '', mid))) await tg('editMessageText', { chat_id: chatId, message_id: mid, text: "🎉 Bugun takrorlanadigan so'z qolmadi!", parse_mode: 'HTML' }).catch(() => {}); return; }
  const st = db.getState(user.id), rv = st.rv;
  if (!rv || rv.id !== id || !Array.isArray(rv.opts)) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Bu savol eskirgan. /review' }).catch(() => {});
  const w = (st.words || []).find((x) => x.w === rv.list[rv.i]);
  const ok = pick !== 'x' && +pick === rv.right;
  if (w) L.grade(w, ok);
  if (ok) rv.ok++;
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: ok ? "✅ To'g'ri!" : '❌ ' + String((w && w.uz) || '').slice(0, 150) }).catch(() => {});
  const res = w ? (ok ? '✅ ' : '❌ ') + `<b>${esc(w.w)}</b>${rd(w.w)} — ${esc(w.uz)}` + (w.ex ? `\n<i>${esc(w.ex)}</i>\n🔤 <i>${esc(PRON.text(w.ex))}</i>` : '') : '';
  rv.i++; rv.opts = null;
  let q = null;
  while (rv.i < rv.list.length && !(q = rvQuestion(st))) rv.i++;
  if (q) {
    db.putState(user.id, st);
    return tg('editMessageText', { chat_id: chatId, message_id: mid, text: res + '\n\n' + q.text, parse_mode: 'HTML', reply_markup: q.reply_markup }).catch(() => {});
  }
  const n = rv.list.length, good = rv.ok; delete st.rv; db.putState(user.id, st);
  const left = (st.words || []).filter(L.isDue).length;
  const text = res + `\n\n🏁 <b>Natija: ${good}/${n}</b> ${good === n ? '🔥 Ajoyib!' : good >= n / 2 ? "👍 Yaxshi!" : "💪 Xato qilganlaringizni ertaga yana so'rayman."}` + (left ? `\n📚 Yana ${left} ta so'z kutyapti.` : "\n🎉 Bugungi takrorlash tugadi!");
  const kb = [[...(left ? [{ text: `🔁 Yana ${Math.min(left, RV_N)} ta`, callback_data: 'rv:new:0' }] : []), appBtn2("📚 Mini Appda", 'words')]];
  return tg('editMessageText', { chat_id: chatId, message_id: mid, text, parse_mode: 'HTML', reply_markup: noAppButtons({ reply_markup: { inline_keyboard: kb } }).reply_markup }).catch(() => {});
}

/* ---------- quick translation: an Uzbek sentence, the learner says it in English ---------- */
async function sendTranslate(chatId, user, editOf) {
  const st = db.getState(user.id), p = L.pair(st.ttRecent);
  if (!p) return say(chatId, "Gaplar topilmadi.");
  st.tt = { en: p.en, uz: p.uz, at: Date.now() }; st.ttRecent = (st.ttRecent || []).concat(p.en).slice(-80);
  db.putState(user.id, st);
  const text = `⚡ <b>Tez tarjima</b>\n\n🇺🇿 <b>${esc(p.uz)}</b>\n\nInglizchasini 5 soniyada ayting: ovozli xabar yoki yozib yuboring.`;
  const kb = { inline_keyboard: [[{ text: "👀 Javobni ko'rsatish", callback_data: 'tt:show' }, { text: '⏭ Keyingisi', callback_data: 'tt:next' }]] };
  if (editOf) return tg('editMessageText', { chat_id: chatId, message_id: editOf, text, parse_mode: 'HTML', reply_markup: kb }).catch(() => say(chatId, text, { reply_markup: kb }));
  return say(chatId, text, { reply_markup: kb });
}
/* the learner's answer to a pending translation (true when it was one) */
async function checkTranslate(msg, user, text) {
  const st = db.getState(user.id), tt = st.tt;
  if (!tt || Date.now() - tt.at > 15 * 60000) return false;
  delete st.tt; st.ttStat = st.ttStat || { n: 0, ok: 0 };
  const r = S.prompts.compareSpoken(tt.en, text), good = r.score >= 75;
  st.ttStat.n++; if (good) st.ttStat.ok++;
  db.putState(user.id, st);
  const marks = r.words.map((x) => (x.ok ? esc(x.w) : `<u>${esc(x.w)}</u>`)).join(' ');
  await say(msg.chat.id, `${good ? "✅ <b>To'g'ri!</b>" : '🔁 <b>Deyarli</b>'} ${r.score}%\n\nTo'g'ri javob: <b>${esc(tt.en)}</b>\n${good ? '' : `Tushib qolgan yoki boshqacha aytilgan so'zlar tagiga chizilgan:\n${marks}\n`}\nJami: ${st.ttStat.ok}/${st.ttStat.n} to'g'ri`, { reply_markup: { inline_keyboard: [[{ text: '⚡ Keyingisi', callback_data: 'tt:next' }], [appBtn2('🦜 Soya mashqi (Mini App)', 'drill')]] } });
  return true;
}
async function onTranslateCb(cq, user, act) {
  const chatId = cq.message.chat.id;
  if (act === 'next') { await tg('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => {}); return sendTranslate(chatId, user); }
  const st = db.getState(user.id), tt = st.tt;
  if (!tt) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Yangi gap: /tarjima' }).catch(() => {});
  delete st.tt; db.putState(user.id, st);
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: tt.en.slice(0, 190) }).catch(() => {});
  return say(chatId, `👀 <b>${esc(tt.en)}</b>\n<i>Ovoz chiqarib 2 marta takrorlang.</i>`, { reply_markup: { inline_keyboard: [[{ text: '⚡ Keyingisi', callback_data: 'tt:next' }]] } });
}

/* ---------- morning listening: a one-minute story with two questions ---------- */
async function makeStory(user, st) {
  if (st.story && st.story.day === L.tday() && st.story.en) return st.story;
  const out = await S.runAI(user, 'story', { level: (st.settings && st.settings.level) || 'B1', about: st.settings && st.settings.about, words: L.studied(st.words, 8).map((w) => w.w), seed: Math.floor(Math.random() * 100) });
  const m = out.text.match(/\{[\s\S]*\}/); const r = m ? JSON.parse(m[0]) : null;
  if (!r || !r.en) throw new Error('no story');
  const story = { day: L.tday(), title: String(r.title || 'Story').slice(0, 80), en: String(r.en).slice(0, 1500), uz: String(r.uz || '').slice(0, 2000),
    questions: (Array.isArray(r.questions) ? r.questions : []).slice(0, 3).filter((q) => q && q.q).map((q) => ({ q: String(q.q).slice(0, 200), uz: String(q.uz || '').slice(0, 200) })),
    words: (Array.isArray(r.words) ? r.words : []).slice(0, 3).filter((w) => w && w.w).map((w) => ({ w: String(w.w).slice(0, 60), uz: String(w.uz || '').slice(0, 120), ex: String(w.ex || '').slice(0, 200) })) };
  const fresh = db.getState(user.id); fresh.story = story; db.putState(user.id, fresh);
  return story;
}
async function sendStory(chatId, user, intro) {
  const st = db.getState(user.id);
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const s = await makeStory(user, st);
  const qs = s.questions.map((q, i) => `${i + 1}. <b>${esc(q.q)}</b>\n<tg-spoiler>${esc(q.uz)}</tg-spoiler>`).join('\n');
  const text = (intro ? intro + '\n\n' : '') + `🎧 <b>${esc(s.title)}</b>\n\nAvval matnni ko'rmasdan tinglang (Mini Appda ▶), keyin o'qing:\n<tg-spoiler>${esc(s.en)}</tg-spoiler>\n\n🇺🇿 Tarjimasi:\n<tg-spoiler>${esc(s.uz)}</tg-spoiler>\n\n❓ <b>Savollar</b> (ovozli xabar bilan javob bering):\n${qs}`;
  await say(chatId, text, { reply_markup: { inline_keyboard: [[appBtn2('🎧 Mini Appda tinglash', 'drill')], [appBtn2("🎙 Audio dars: o'rgangan so'zlarimdan dialog (2-3 daq)", 'audio')], [{ text: "🧠 So'z testi (5 ta)", callback_data: 'rv:new:0' }]] } });
  const ch = (st.settings && st.settings.char) || {};
  sendVoiceText(chatId, user, s.en, S.prompts.voiceFor(ch.id, st.settings && st.settings.gender), st.settings && st.settings.style).catch(() => {});
  /* the questions start the bot conversation, so a voice answer is checked with the story in mind */
  const fresh = db.getState(user.id);
  fresh.botTurns = (fresh.botTurns || []).concat([{ role: 'assistant', content: JSON.stringify({ emotion: 'happy', reply: s.questions.map((q) => q.q).join(' '), story: s.en.slice(0, 1100) }) }]).slice(-10);
  db.putState(user.id, fresh);
}
async function cmdStory(msg, user) {
  try { await sendStory(msg.chat.id, user); }
  catch (e) { await say(msg.chat.id, e.code === 'quota' ? "Bugungi bepul AI javoblar tugadi." : "Hikoya tayyorlab bo'lmadi. Birozdan keyin /tinglash ni qayta yuboring."); }
}

/* ---------- payments (Telegram Stars) ---------- */
async function onPreCheckout(pq) {
  const ok = pq.currency === 'XTR' && pq.total_amount === PREMIUM_STARS && pq.invoice_payload === 'prem:' + pq.from.id;
  await tg('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: pq.id, ok: true } : { pre_checkout_query_id: pq.id, ok: false, error_message: "To'lov ma'lumotlari mos kelmadi. Qaytadan urinib ko'ring." });
}
async function onPaid(msg, user) {
  const p = msg.successful_payment;
  if (p.currency !== 'XTR' || p.total_amount !== PREMIUM_STARS || p.invoice_payload !== 'prem:' + user.id) return;
  if (!db.addPayment(p.telegram_payment_charge_id, user.id, p.total_amount)) return; /* already counted */
  const base = S.isPremium(user) ? new Date(user.premium_until + 'Z') : new Date();
  base.setUTCDate(base.getUTCDate() + PREMIUM_DAYS);
  const until = base.toISOString().slice(0, 19).replace('T', ' ');
  db.setPremium(user.id, until);
  await say(msg.chat.id, `⭐ Rahmat! Premium ${esc(until)} gacha (UTC) faol. Rahmat sizga! 🥰`, { reply_markup: appKeyboard() });
}

/* ---------- update router ---------- */
const seen = new Set();
async function handleUpdate(u) {
  if (u.update_id != null) { if (seen.has(u.update_id)) return; seen.add(u.update_id); if (seen.size > 5000) seen.clear(); }
  if (u.pre_checkout_query) return onPreCheckout(u.pre_checkout_query);
  if (u.callback_query) return onCallback(u.callback_query);
  const msg = u.message; if (!msg || !msg.from || msg.from.is_bot) return;
  if (msg.chat.type !== 'private') return; /* the bot only works in private chats */
  const user = db.touchUser(msg.from, msg.chat.id);
  if (user.banned) return;
  if (msg.successful_payment) return onPaid(msg, user);
  if (tooFast('m' + user.id, 20)) return;
  if (msg.voice) return handleVoice(msg, user);
  const text = String(msg.text || '').trim(); if (!text) return;
  const m = text.match(/^\/(\w+)(?:@\w+)?\s*(.*)$/s);
  if (m) {
    const c = m[1].toLowerCase();
    if (c === 'start') return cmdStart(msg, user);
    if (c === 'stats') return cmdStats(msg, user);
    if (c === 'words') return cmdWords(msg, user);
    if (c === 'ibora' || c === 'iboralar' || c === 'phrases' || c === 'speak') return cmdSpeak(msg, user);
    if (c === 'review' || c === 'takror' || c === 'quiz') return cmdReview(msg, user);
    if (c === 'tarjima' || c === 'translate') return sendTranslate(msg.chat.id, user);
    if (c === 'tinglash' || c === 'listen' || c === 'story') return cmdStory(msg, user);
    if (c === 'ertak' || c === 'qoshiq' || c === 'songs' || c === 'tales' || c === 'song' || c === 'tale') return say(msg.chat.id, "🎵 <b>Ertak va qo'shiqlar</b>\nDarajangizga mos (A1–B2) sho'x ertaklar, kuy bilan kuylanadigan qo'shiqlar, mashhur qo'shiqlar ro'yxati va o'rgangan so'zlaringizdan AI yozgan yangi ertak va qo'shiqlar.", { reply_markup: { inline_keyboard: [[appBtn2("🎵 Ertak va qo'shiqlarni ochish", 'fun')]] } });
    if (c === 'audio' || c === 'dialog' || c === 'podcast') return say(msg.chat.id, "🎙 <b>Audio dars</b> · 2-3 daqiqa\nSiz o'rgangan so'zlardan dialog yoki hikoya tuziladi: ikki xil ovoz, gapma-gap tarjima va takrorlab tinglash rejimi.", { reply_markup: { inline_keyboard: [[appBtn2('🎙 Audio darsni ochish', 'audio')]] } });
    if (c === 'dars' || c === 'lesson') return say(msg.chat.id, "📅 <b>Bugungi dars</b> · 10 daqiqa: so'zlar, soya mashqi, tez tarjima, suhbat va xatolaringiz. Hammasi bitta tugmada:", { reply_markup: { inline_keyboard: [[appBtn2('📅 Darsni boshlash', 'drill')]] } });
    if (c === 'premium') return cmdPremium(msg, user);
    if (c === 'remind') return cmdRemind(msg, user);
    if (c === 'name') return cmdName(msg, user, m[2]);
    if (c === 'settings' || c === 'til' || c === 'ovoz') return cmdSettings(msg, user);
    if (c === 'report' || c === 'hisobot') return cmdReport(msg, user);
    if (c === 'about') return cmdAbout(msg, user, m[2]);
    if (c === 'admin') return cmdAdmin(msg, user, m[2]);
    return cmdHelp(msg);
  }
  if (text.length > 1000) return say(msg.chat.id, 'Xabar juda uzun. Qisqaroq yozing.');
  if (await checkTranslate(msg, user, text)) return;
  return quickChat(msg, user, text);
}

/* ---------- reminders: at the hours the learner chose, the bot starts a conversation ---------- */
const DAILY_Q = [
  ['What did you have for breakfast today?', 'Bugun nonushtaga nima yedingiz?'],
  ['What are your plans for today?', 'Bugungi rejalaringiz qanday?'],
  ['What was the best part of your day?', "Kuningizning eng yaxshi qismi nima bo'ldi?"],
  ['What made you smile today?', 'Bugun sizni nima jilmaytirdi?'],
  ['What are you going to do this weekend?', 'Dam olish kunlari nima qilmoqchisiz?'],
  ['Tell me about a person who inspires you.', 'Sizni ilhomlantiradigan inson haqida gapirib bering.'],
  ['What is something new you learned this week?', "Shu hafta qanday yangi narsa o'rgandingiz?"],
  ['If you could travel anywhere tomorrow, where would you go?', "Ertaga istalgan joyga borish mumkin bo'lsa, qayerga borardingiz?"],
  ['What is your favourite way to relax after work?', 'Ishdan keyin dam olishning eng yoqtirgan usulingiz qanday?'],
  ['Describe your city to someone who has never been there.', "Shahringizni u yerda hech bo'lmagan odamga tasvirlab bering."],
  ['What is a goal you want to reach this year?', "Shu yil erishmoqchi bo'lgan maqsadingiz nima?"],
  ['What is the most difficult thing about learning English for you?', "Siz uchun ingliz tilini o'rganishning eng qiyin tomoni nima?"],
  ['What did you do yesterday evening?', 'Kecha kechqurun nima qildingiz?'],
  ['Which film or series would you recommend to me, and why?', 'Menga qaysi kino yoki serialni tavsiya qilasiz va nega?'],
  ['What is a habit you want to change?', "Qaysi odatingizni o'zgartirmoqchisiz?"],
  ['How do you usually spend your Sundays?', "Odatda yakshanbalarni qanday o'tkazasiz?"],
  ['What is your favourite Uzbek dish, and how is it made?', "Sevimli o'zbek taomingiz qaysi va u qanday tayyorlanadi?"],
  ['What job would you love to do in five years?', 'Besh yildan keyin qanday ishda ishlashni xohlardingiz?'],
  ['Tell me about your best friend.', "Eng yaqin do'stingiz haqida gapirib bering."],
  ['What are you working on at the moment? Explain it simply.', "Hozir qanday ish ustida ishlayapsiz? Oddiy qilib tushuntiring."],
  ['What was the most difficult technical problem you have solved?', "Siz hal qilgan eng qiyin texnik muammo qaysi?"],
  ['How would you explain your job to a child?', "Ishingizni bolaga qanday tushuntirgan bo'lardingiz?"],
  ['What tools or software do you use every day at work?', "Ishda har kuni qaysi asbob yoki dasturlardan foydalanasiz?"],
  ['Tell me about a project you are proud of.', "Faxrlanadigan loyihangiz haqida gapirib bering."],
  ['What would you say in a stand-up meeting today?', "Bugun stand-up yig'ilishida nima degan bo'lardingiz?"],
  ['How do you make sure your work is safe and high quality?', "Ishingiz xavfsiz va sifatli bo'lishini qanday ta'minlaysiz?"],
  ['Describe your dream job abroad.', "Chet eldagi orzuingizdagi ishni tasvirlab bering."],
  ['Which country would you like to visit next, and why?', "Keyingi safar qaysi davlatga bormoqchisiz va nega?"],
  ['Imagine your flight is cancelled. What do you say at the airline desk?', "Reysingiz bekor qilindi deylik. Aviakompaniya xodimiga nima deysiz?"],
  ['How do you check in at a hotel? Say it as if I am the receptionist.', "Mehmonxonaga qanday joylashasiz? Men qabulxona xodimi bo'lsam, deb ayting."],
  ['Tell me about the best trip you have ever had.', "Eng yaxshi sayohatingiz haqida gapirib bering."],
  ['Introduce yourself as if you are meeting a foreign colleague.', "Xorijlik hamkasbingiz bilan tanishayotgandek o'zingizni tanishtiring."],
  ['How would you ask a taxi driver to take you to your hotel?', "Taksi haydovchisidan mehmonxonangizga olib borishni qanday so'raysiz?"],
  ['What would you do if you had a free day tomorrow?', "Ertaga bo'sh kuningiz bo'lsa, nima qilardingiz?"],
  ['What is the best advice you have ever received?', 'Hayotingizda olgan eng yaxshi maslahat qaysi?'],
  ['How was your day? Tell me one good thing and one bad thing.', "Kuningiz qanday o'tdi? Bitta yaxshi va bitta yomon narsani ayting."]
];
const tashHour = () => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }).format(new Date());
async function sendVoiceText(chatId, user, text, voice, style) {
  const ogg = await S.tts(user, text, false, 'happy', 0.92, 'opus', voice, style);
  await sendVoiceFile(chatId, ogg, 'q.ogg');
}
/* Each chosen hour is either word time or speaking practice (they alternate: morning words, midday speaking, evening words). */
function remindKind(hours, h, st) {
  const i = Math.max(0, hours.indexOf(h));
  const words = (st.words || []).filter((w) => w && w.uz && w.src !== 'pattern');
  const k = ['listen', 'talk', 'words'][i % 3];
  return k === 'words' && !words.length ? 'talk' : k;
}
async function remindOne(row, hour, day) {
  let st = {}; try { st = JSON.parse(row.json || '{}'); } catch (e) {}
  const hours = String(row.remind_hours || '').split(',').map(Number);
  const kind = remindKind(hours, hour, st);
  const s = streak(st), dw = dueWords(st).length;
  const user = db.getUser(row.id);
  const kb = { inline_keyboard: [[appBtn('🗣 Mini Appda gaplashish')], [appBtn2('📅 Bugungi dars (10 daq)', 'drill')], [{ text: '⚡ Tez tarjima', callback_data: 'tt:next' }]] };
  const fire = s >= 2 ? `🔥 ${s} kunlik seriya! ` : '';
  if (kind === 'listen') {
    try { await sendStory(row.chat_id, user, `☀️ ${fire}<b>Xayrli tong! Tinglash vaqti.</b>` + (dw ? `\n📚 Bugun ${dw} ta so'z ham kutyapti (pastdagi tugma).` : '') + `\n📅 To'liq 10 daqiqalik dars: /dars`); return 'listen'; }
    catch (e) { /* no AI right now: a word round instead */ }
  }
  if (kind === 'words' || kind === 'listen') {
    const tg5 = L.targets(st.words, 3).map((w) => `<b>${esc(w.w)}</b> — <tg-spoiler>${esc(w.uz)}</tg-spoiler>`);
    const intro = `⏰ ${fire}<b>So'z yodlash vaqti!</b>` + (dw ? `\n📚 Bugun ${dw} ta so'z takrorlashni kutyapti.` : '') + (tg5.length ? `\n\n🎯 Bugun suhbatda ishlatib ko'ring:\n${tg5.join('\n')}` : '') + '\n\n2 daqiqalik test, boshladik:';
    if (await startReview(row.chat_id, user, intro)) return 'words';
  }
  const qi = (Number(day.replace(/-/g, '')) + hour + row.id) % DAILY_Q.length, [en, uz] = DAILY_Q[qi];
  const mis = (st.mistakes || []).filter((m) => (m.ok || 0) < 2);
  const one = mis.length ? mis[(qi + hour) % mis.length] : null;
  const tgt = L.targets(st.words, 2);
  let text = `⏰ ${fire}<b>Gapirish mashqi vaqti!</b>\n\n🗣 <b>${esc(en)}</b>\n<tg-spoiler>${esc(uz)}</tg-spoiler>\n\nOvozli xabar bilan inglizcha javob bering. Xatolaringizni o'zbekcha tushuntirib beraman.`;
  if (tgt.length) text += `\n🎯 Javobda shu so'zlarni ishlating: <b>${tgt.map((w) => esc(w.w)).join(', ')}</b>`;
  const sd = SPEAK.days[spCur(st)];
  if (sd) { const ph = sd.list.slice(0, 10).sort(() => Math.random() - 0.5).slice(0, 3).map((x) => x.split('|')[0].replace('{name}', spName(user))); text += `\n🚀 Tayyor iboralar (${esc(sd.t)}): ${ph.map((x) => '<b>' + esc(x) + '</b>').join(' · ')}\nTo'liq ro'yxat: /ibora`; }
  if (one) text += `\n\n🔁 <i>Esingizdami?</i> ${one.said ? '<s>' + esc(one.said) + '</s> → ' : ''}<b>${esc(one.better)}</b>`;
  const lastTest = (st.tests || []).slice(-1)[0];
  if ((!lastTest || lastTest.day < addDaysT(-30)) && Object.keys(st.days || {}).length >= 3) text += "\n\n📈 Oylik gapirish testi vaqti keldi: Mini Appda «Sozlamalar → Gapirish testi».";
  text += '\n\n/remind — eslatma soatlari';
  await say(row.chat_id, text, { reply_markup: kb });
  const ch = (st.settings && st.settings.char) || {};
  sendVoiceText(row.chat_id, user, en, S.prompts.voiceFor(ch.id, st.settings && st.settings.gender), st.settings && st.settings.style).catch(() => {});
  /* the question becomes the start of the bot conversation, so the reply continues it */
  const fresh = db.getState(row.id);
  fresh.botTurns = (fresh.botTurns || []).concat([{ role: 'assistant', content: JSON.stringify({ emotion: 'happy', reply: en }) }]).slice(-10);
  db.putState(row.id, fresh);
  return 'talk';
}
const addDaysT = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
let ticking = false;
async function reminderTick(testHour) {
  if (ticking) return; ticking = true;
  try {
    const hour = testHour == null ? tashHour() : testHour, day = S.today();
    /* the server may have been asleep or restarting at the exact hour: an hour late is still fine */
    const done = new Set();
    for (const h of [hour, hour - 1]) {
      if (!db.HOURS.includes(h)) continue;
      const slot = day + '-' + String(h).padStart(2, '0');
      for (const row of db.remindTargets(h, slot)) {
        db.markReminded(row.id, slot);
        if (done.has(row.id)) continue; done.add(row.id);
        if (h !== hour && String(',' + row.remind_hours + ',').includes(',' + hour + ',')) continue; /* the current hour's reminder comes anyway */
        /* they are practising right now: don't interrupt */
        if (row.last_active && Date.now() - new Date(row.last_active.replace(' ', 'T') + 'Z').getTime() < 30 * 60000) continue;
        try { await remindOne(row, h, day); }
        catch (e) { if (/blocked|deactivated|not found/i.test(e.message)) db.setRemind(row.id, false); else console.error('remind:', String(e.message).slice(0, 120)); }
        await new Promise((r) => setTimeout(r, 60)); /* stay well under Telegram's sending limits */
      }
    }
    await weekly(hour, day);
    if (hour === 8) db.cleanSent(day.slice(0, 8) + '00');
  } finally { ticking = false; }
}
async function weekly(hour, day) {
  /* Sunday 20:00: weekly report to everyone who keeps reminders on */
  const dow = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tashkent', weekday: 'short' }).format(new Date());
  if (dow === 'Sun' && hour === 20) {
    for (const row of db.weeklyTargets(day + '-week')) {
      db.markReminded(row.id, day + '-week');
      let st = {}; try { st = JSON.parse(row.json || '{}'); } catch (e) {}
      if (!Object.keys(st.days || {}).length) continue;
      try { await say(row.chat_id, weekReport(st), { reply_markup: appKeyboard() }); } catch (e) { /* blocked */ }
      await new Promise((r) => setTimeout(r, 60));
    }
  }
}

/* ---------- setup ---------- */
async function setup({ publicUrl, secret, polling }) {
  appUrl = publicUrl;
  await tg('setMyCommands', { commands: [
    { command: 'start', description: 'Boshlash' }, { command: 'stats', description: 'Natijalarim' },
    { command: 'ibora', description: "🚀 Tez gapirish: bugungi 10 ibora" }, { command: 'dars', description: 'Bugungi dars (10 daqiqa)' }, { command: 'audio', description: "Audio dars: o'rgangan so'zlarimdan dialog" }, { command: 'ertak', description: "Ertak va qo'shiqlar" }, { command: 'review', description: "So'z yodlash (tugmali test)" }, { command: 'tarjima', description: 'Tez tarjima mashqi' }, { command: 'tinglash', description: 'Tinglash: hikoya va savollar' }, { command: 'words', description: "Takrorlash uchun so'zlar" }, { command: 'premium', description: 'Premium (Stars)' },
    { command: 'remind', description: 'Eslatma soatlari' }, { command: 'name', description: 'Hamrohga ism berish' }, { command: 'settings', description: 'Javob tili va ovoz (ayol/erkak)' }, { command: 'report', description: 'Haftalik hisobot' }, { command: 'about', description: "O'zim haqimda (suhbat shunga moslashadi)" }, { command: 'help', description: 'Yordam' }] });
  if (appUrl) await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Gaplashish', web_app: { url: appUrl + '/' } } });
  setInterval(() => reminderTick().catch((e) => console.error('remind', e.message)), 5 * 60000).unref();
  setTimeout(() => reminderTick().catch((e) => console.error('remind', e.message)), 20000).unref();
  /* Railway's free plan puts a service to sleep after 10 minutes without outgoing traffic, and a
     sleeping server cannot send reminders. A tiny request every 4 minutes keeps it awake (KEEP_AWAKE=0 turns this off). */
  if (process.env.RAILWAY_ENVIRONMENT && process.env.KEEP_AWAKE !== '0') setInterval(() => tg('getMe', {}).catch(() => {}), 4 * 60000).unref();
  if (polling) {
    await tg('deleteWebhook', {});
    let offset = 0, lastErr = '', lastAt = 0;
    (async function loop() {
      while (!stopped) {
        try {
          const ups = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'pre_checkout_query', 'callback_query'] });
          if (lastErr) { console.log('bot: aloqa tiklandi'); lastErr = ''; }
          for (const u of ups) { offset = u.update_id + 1; handleUpdate(u).catch((e) => console.error('bot', e.message)); }
        } catch (e) {
          const conflict = /409|conflict/i.test(e.message);
          const text = conflict ? "bot: bu bot boshqa joyda ham ishlayapti (masalan Railway yoki boshqa oyna). Bittasini to'xtating." : 'bot: Telegramga ulanib bo\'lmadi: ' + String(e.message || e).slice(0, 120);
          if (text !== lastErr || Date.now() - lastAt > 60000) { console.error(text); lastErr = text; lastAt = Date.now(); }
          await new Promise((r) => setTimeout(r, conflict ? 10000 : 3000));
        }
      }
    })();
    console.log('bot: long polling');
  } else {
    await tg('setWebhook', { url: appUrl + '/tg/webhook', secret_token: secret, allowed_updates: ['message', 'pre_checkout_query', 'callback_query'], drop_pending_updates: false });
    console.log('bot: webhook set');
  }
}

let stopped = false;
module.exports = { handleUpdate, setup, invoiceLink, reminderTick, stop: () => { stopped = true; } };
