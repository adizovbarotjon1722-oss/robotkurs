/* Uzbek-letter readings of English words ("deadline" → "dedlayn"), from the CMU Pronouncing Dictionary
   (tools/make_pron.py builds pron.txt.gz). Loaded on first use, about 10 MB in memory. */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
let map = null;
function load() {
  if (map) return map;
  map = new Map();
  try {
    const txt = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'pron.txt.gz'))).toString('utf8');
    for (const line of txt.split('\n')) { const i = line.indexOf('\t'); if (i > 0) map.set(line.slice(0, i), line.slice(i + 1)); }
  } catch (e) { console.error("o'qilish lug'ati yuklanmadi:", e.code || e.message); }
  return map;
}
const clean = (w) => String(w || '').toLowerCase().replace(/[’`]/g, "'").replace(/^'+|'+$/g, '');
/* one word; "teacher's" and simple plurals fall back to the base word */
function word(w) {
  const m = load(); w = clean(w); if (!w) return '';
  if (m.has(w)) return m.get(w);
  if (w.endsWith("'s") && m.has(w.slice(0, -2))) return m.get(w.slice(0, -2)) + 'z';
  if (/[^s]s$/.test(w) && m.has(w.slice(0, -1))) return m.get(w.slice(0, -1)) + (/[ptkfs]$/.test(m.get(w.slice(0, -1))) ? 's' : 'z');
  return '';
}
/* a whole phrase: unknown words keep their English spelling */
function text(t) {
  t = String(t || '');
  return t.replace(/[A-Za-z][A-Za-z'’]*/g, (x, at) => {
    const r = word(x) || x.toLowerCase();
    return /^\s*$|[.!?]\s*$/.test(t.slice(0, at)) ? r.charAt(0).toUpperCase() + r.slice(1) : r;
  });
}
module.exports = { word, text, size: () => load().size };
