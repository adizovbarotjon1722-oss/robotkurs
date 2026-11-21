'use strict';
/* Word review on the server side (bot quiz, words used in the bot chat).
   Same spaced-repetition steps as the Mini App (web/app.js STEPS). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STEPS = [0, 1, 2, 4, 7, 15, 30];
const tday = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(d || new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return tday(d); };

/* the 3000-word course, used for wrong answers in the quiz (the browser file is reused as is) */
let CORE = [];
try {
  const box = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'core3000.js'), 'utf8'), box, { timeout: 2000 });
  CORE = String(box.window.QumriCore.words || '').split('~').map((r) => { const [w, uz] = r.split('|'); return { w, uz }; }).filter((x) => x.w && x.uz);
} catch (e) { console.error('core3000 not loaded:', e.message); }

function grade(w, ok) {
  w.box = Math.max(0, Math.min(STEPS.length - 1, +w.box || 0));
  if (ok) { w.box = Math.min(STEPS.length - 1, w.box + 1); w.due = addDays(STEPS[w.box]); }
  else { w.box = Math.min(w.box, 1); w.due = tday(); }
  w.seen = (w.seen || 0) + 1; w.t = Date.now();
  return w;
}
const isDue = (w) => (w.due || '') <= tday() && (w.box || 0) < STEPS.length - 1;

/* words for today's conversation: due first, then the ones still being learned; skip those already used today */
function targets(words, n) {
  const t = tday(), list = (words || []).filter((w) => w && w.w && (w.box || 0) <= 3 && w.usedDay !== t && w.src !== 'pattern' && w.w.length <= 30);
  const due = list.filter((w) => (w.due || '') <= t).sort((a, b) => (a.used || 0) - (b.used || 0) || (a.box || 0) - (b.box || 0));
  const rest = list.filter((w) => (w.due || '') > t && (w.box || 0) >= 1).sort((a, b) => (a.box || 0) - (b.box || 0));
  return due.concat(rest).slice(0, n || 5);
}
const esc = (s) => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const said = (text, w) => new RegExp('(^|[^a-z])' + esc(w) + '([^a-z]|$)', 'i').test(String(text || ''));
/* the AI says which target words the learner used correctly; without that list, a plain match counts */
function usedWords(text, tg, aiList) {
  const names = Array.isArray(aiList) ? aiList.map((x) => String(x || '').toLowerCase().trim()) : null;
  return tg.filter((w) => said(text, w.w) && (!names || names.includes(w.w.toLowerCase())));
}
function markUsed(w) { w.used = (w.used || 0) + 1; w.usedDay = tday(); grade(w, true); }

/* quiz: 4 meanings, one right, others from the learner's words or the course */
function options(word, words) {
  const right = String(word.uz || '').split(/[;,]/)[0].trim();
  const pool = (words || []).concat(CORE).filter((x) => x && x.uz && x.w.toLowerCase() !== word.w.toLowerCase());
  const out = new Set([right]);
  for (let i = 0; i < 60 && out.size < 4 && pool.length; i++) { const u = String(pool[Math.floor(Math.random() * pool.length)].uz).split(/[;,]/)[0].trim(); if (u && u.length <= 40) out.add(u); }
  const opts = [...out].sort(() => Math.random() - 0.5);
  return { opts, right: opts.indexOf(right) };
}
function reviewList(words, n) {
  const ws = (words || []).filter((w) => w && w.w && w.uz && w.src !== 'pattern');
  const due = ws.filter(isDue).sort((a, b) => (b.box || 0) - (a.box || 0));
  const more = due.length >= n ? [] : ws.filter((w) => !isDue(w) && (w.box || 0) >= 1 && (w.box || 0) <= 3).sort((a, b) => (a.box || 0) - (b.box || 0));
  return due.concat(more).slice(0, n).map((w) => w.w);
}

module.exports = { STEPS, grade, isDue, targets, usedWords, markUsed, options, reviewList, tday, coreSize: () => CORE.length };
