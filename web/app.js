(() => {
const $ = id => document.getElementById(id);
const q = $('q'), feed = $('feed');
function el(tag, cls, text){ const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(cls, text, fn){ const b = el('button', cls, text); b.type = 'button'; b.onclick = fn; return b; }
const P = window.QumriPrompts;

/* ================= where Qumri runs ================= */
const TG = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) ? window.Telegram.WebApp : null;
const SERVER = !!TG;
const inViewer = !TG && !!(window.claude && window.claude.use);

/* ================= storage (+ server sync inside Telegram) ================= */
const SYNC_KEYS = ['words','days','settings','lastDay','chat','mistakes','flu','tests','story','lesson','lessonDays'];
let syncT = null, syncBase = 0, synced = false;
const LS = {
  get(k, d){ try { const v = localStorage.getItem('qumri_'+k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v){ try { localStorage.setItem('qumri_'+k, JSON.stringify(v)); } catch(e){} if (SERVER && SYNC_KEYS.includes(k)){ clearTimeout(syncT); syncT = setTimeout(pushState, 2500); } }
};
async function api(path, body, raw){
  const headers = { 'X-Init-Data': TG.initData };
  if (raw) headers['content-type'] = raw; else if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined });
  if (!r.ok){ let j = {}; try { j = await r.json(); } catch(e){} const err = new Error(j.error || 'http'); err.code = j.error || (r.status === 429 ? 'rate_limited' : r.status === 401 ? 'auth' : 'http'); throw err; }
  return r;
}
function pushState(){ syncT = null; if (!synced) return; const d = { _base: syncBase }; SYNC_KEYS.forEach(k => d[k] = LS.get(k, null)); api('/api/state', d).catch(() => {}); }

const settings = Object.assign({ level:'B1', goal:10, rate:0.95, voice:'', key:'', oakey:'', readUz:true, handsfree:true, style:'samimiy', topic:'free', corrections:'all', calm:true, lang:'both', gender:'auto' }, LS.get('settings', {}));
if (!P.pick(P.STYLES, settings.style)) settings.style = 'samimiy';
if (!P.pick(P.TOPICS, settings.topic)) settings.topic = 'free';
const styleDef = () => P.pick(P.STYLES, settings.style, P.STYLES.samimiy);
const saveSettings = () => LS.set('settings', settings);
let words = LS.get('words', []), days = LS.get('days', {}), chat = LS.get('chat', []), mistakes = LS.get('mistakes', []), flu = LS.get('flu', {}), tests = LS.get('tests', []);
const applyCalm = () => document.documentElement.classList.toggle('calm', settings.calm !== false);
applyCalm();

/* ================= companion (character) ================= */
const CH = window.QumriChars;
settings.char = Object.assign({ id:'nur', color:'', acc:'none', name:'' }, settings.char || {});
const charDef = () => CH.CHARS[settings.char.id] || CH.CHARS.qumri;
const cname = () => settings.char.name || charDef().name;
const charVoice = () => P.voiceFor(settings.char.id, settings.gender);
function paintChar(){ CH.paint(q, settings.char); $('brand').textContent = cname(); document.title = cname() + ' Speaking'; }
paintChar();

/* ================= Qumri's face ================= */
const EMOS = ['neutral','happy','excited','love','proud','thinking','gentle','surprised','sad','laughing','listening','sleepy'];
let idleT, swapT, busy = false, speaking = false, listening = false, room = 'talk';
/* the light behind the companion takes the colour of its mood */
const MOODC = { happy:'#7FD6FF', excited:'#FFC94A', laughing:'#FFC94A', proud:'#FFD25E', love:'#FF7DB2', thinking:'#9C8CFF', gentle:'#7FE0CF', surprised:'#9FF0FF', sad:'#7F9CC9', sleepy:'#8A94B0', listening:'#5EEAD4', neutral:'#7FD6FF' };
function setEmo(e){
  const cw = q.parentElement; if (cw) cw.style.setProperty('--mood', MOODC[e] || MOODC.happy);
  if (q.dataset.emo === e) return;
  const eyes = q.querySelector('.eyes');
  eyes.classList.add('swap'); clearTimeout(swapT);
  swapT = setTimeout(() => { q.dataset.emo = e; requestAnimationFrame(() => eyes.classList.remove('swap')); }, 110);
}
const HAPTIC = { excited:'success', proud:'success', love:'success', gentle:'warning', sad:'warning' };
function emote(e){
  e = EMOS.includes(e) ? e : 'happy'; setEmo(e);
  if (TG && TG.HapticFeedback && HAPTIC[e]) try { TG.HapticFeedback.notificationOccurred(HAPTIC[e]); } catch(x){}
  if (['excited','proud','love'].includes(e)) feathers(q, e === 'love' ? 8 : 12);
  clearTimeout(idleT); idleT = setTimeout(() => { if (!busy && !speaking && !listening) setEmo('sleepy'); }, 120000);
}
/* eyes wander, follow the pointer, and look at you while you talk */
function lookAt(dx, dy){ const look = q.querySelector('.look'); if (look) look.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`; }
let lastPointer = 0;
document.addEventListener('pointermove', e => {
  const r = q.getBoundingClientRect(); if (!r.width) return;
  const cx = r.left + r.width/2, cy = r.top + r.height*0.42;
  const dx = Math.max(-1, Math.min(1, (e.clientX - cx)/300)), dy = Math.max(-1, Math.min(1, (e.clientY - cy)/300));
  lookAt(dx*6, dy*4); lastPointer = Date.now();
});
setInterval(() => {
  if (Date.now() - lastPointer < 3000) return;
  if (listening) return lookAt(0, 3);
  if (speaking) return lookAt(0, 0);
  if (Math.random() < 0.55) lookAt((Math.random()*2-1)*6, (Math.random()*2-1)*3);
  if (!settings.calm && !busy && q.dataset.emo === 'happy' && Math.random() < 0.18){ q.classList.add('hop'); setTimeout(() => q.classList.remove('hop'), 520); }
}, 2600);
/* little feathers fly out when Qumri is happy with you */
function feathers(from, n){
  if (settings.calm || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = from.getBoundingClientRect(), main = settings.char.color || charDef().color, colors = [main, 'var(--saffron)', 'var(--cheek)', 'var(--teal)'];
  for (let i = 0; i < n; i++){
    const f = el('i','feather');
    f.style.left = (r.left + r.width/2) + 'px'; f.style.top = (r.top + r.height/2) + 'px';
    f.style.background = colors[i % colors.length];
    f.style.setProperty('--dx', (Math.random()*240-120) + 'px'); f.style.setProperty('--dy', (Math.random()*-160-40) + 'px'); f.style.setProperty('--r', (Math.random()*540-270) + 'deg');
    f.style.animationDelay = (Math.random()*0.15) + 's';
    document.body.append(f); setTimeout(() => f.remove(), 1900);
  }
}
q.addEventListener('click', () => { if (busy || speaking || listening) return; const prev = q.dataset.emo; emote('laughing'); feathers(q, 5); setTimeout(() => { if (q.dataset.emo === 'laughing') setEmo(prev === 'sleepy' ? 'happy' : prev); }, 1100); });
function status(cls, text){ $('status').className = 'status ' + (cls||''); $('statusText').textContent = text; }

/* ================= daily goal & streak ================= */
const dkey = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const today = () => dkey(new Date());
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate()+n); return dkey(d); };
let lastAct = 0;
function activity(){
  const now = Date.now();
  if (lastAct && now - lastAct < 180000){ const k = today(); days[k] = (days[k]||0) + (now - lastAct); LS.set('days', days); }
  lastAct = now; renderGoal();
}
const mins = k => Math.floor((days[k]||0)/60000);
function streak(){ let n = 0; const d = new Date(); if (mins(dkey(d)) < 1) d.setDate(d.getDate()-1); while (mins(dkey(d)) >= 1){ n++; d.setDate(d.getDate()-1); } return n; }
function renderGoal(){
  const t = mins(today()), g = +settings.goal;
  $('streakNum').textContent = streak(); $('goalText').textContent = `${Math.min(t,g)}/${g}`;
  $('goalRing').style.setProperty('--p', Math.min(100, Math.round(t/g*100)));
  if (t >= g && !LS.get('goalDone_'+today(), false)){ LS.set('goalDone_'+today(), true); emote('excited'); status('', `Bugungi maqsad bajarildi! ${streak()} kun ketma-ket.`); }
}

/* ================= AI backends ================= */
let sample = null, quota = null;
if (inViewer) window.claude.use('sample').then(s => { sample = s; if (!s) $('keyBox').hidden = false; });
else if (!SERVER) $('keyBox').hidden = false;
async function askClaude(messages, max){
  if (sample){ const { text } = await sample(messages, { cache:false, modelTier:'quick' }); return text; }
  const key = (settings.key||'').trim();
  if (!key){ const e = new Error('no_key'); e.code = 'no_key'; throw e; }
  const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST',
    headers:{ 'content-type':'application/json', 'x-api-key':key, 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true' },
    body: JSON.stringify({ model:'claude-haiku-5-5', max_tokens:max || 600, messages }) });
  if (!r.ok){ const e = new Error('http'); e.code = r.status === 401 ? 'bad_key' : 'http'; throw e; }
  const j = await r.json(); return (j.content||[]).map(c => c.text||'').join('');
}
/* one door for every AI call: inside Telegram only the type and data go to our server */
async function ai(type, payload){
  if (SERVER){ const r = await api('/api/ai', { type, payload }); const j = await r.json(); quota = j.quota || quota; renderQuota(); return j.text || ''; }
  const b = P.build(type, payload); return askClaude(b.messages, b.max);
}
function parseJSON(t, fb){ const m = String(t).match(/\{[\s\S]*\}/); if (m) try { return JSON.parse(m[0]); } catch(e){} return fb; }
function renderQuota(){ if (SERVER && quota && !quota.premium && quota.left <= 5) $('hint').textContent = `Bugun ${quota.left} ta bepul javob qoldi`; }
function errText(e){
  return e.code === 'no_key' ? "Gaplashish uchun Sozlamalarga Anthropic API kalitini kiriting."
    : e.code === 'bad_key' ? "API kaliti noto'g'ri. Sozlamalarda tekshiring."
    : e.code === 'not_granted' ? "Ruxsat berilmadi. Sahifani yangilab, ruxsat bering."
    : e.code === 'rate_limited' ? "Biroz shoshildik. Bir necha soniyadan keyin qayta urinib ko'ring."
    : e.code === 'quota' ? "Bugungi bepul suhbat tugadi. Ertaga yana gaplashamiz!"
    : e.code === 'auth' ? "Mini Appni yopib, qayta oching."
    : "Internet bilan muammo bo'ldi. Qayta urinib ko'ring.";
}

/* ================= voice out ================= */
let voices = [];
function loadVoices(){
  if (!('speechSynthesis' in window)) return;
  voices = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang));
  const pref = v => /(natural|neural|samantha|zira|aria|jenny|libby|sonia|google uk english female|google us english)/i.test(v.name) ? 0 : 1;
  voices.sort((a,b) => pref(a)-pref(b));
  const sel = $('voice'); sel.innerHTML = '';
  voices.forEach(v => { const o = el('option', null, `${v.name} (${v.lang})`); o.value = v.name; sel.append(o); });
  if (!voices.length) sel.append(el('option', null, 'Ingliz ovozi topilmadi'));
  if (settings.voice && voices.some(v => v.name === settings.voice)) sel.value = settings.voice;
}
if ('speechSynthesis' in window){ loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
let serverVoice = true; /* false when the server has no OpenAI key: then the browser voice speaks */
const useAIVoice = () => SERVER ? serverVoice : (!inViewer && (settings.oakey||'').trim());
if (SERVER) $('voiceLabel').hidden = true;

let audioEl = null, speakToken = 0, actx = null;
function setTalking(on){
  speaking = on; q.classList.toggle('talking', on);
  if (on){ status('speaking', cname() + ' gapiryapti…'); $('talk').classList.remove('on'); }
}
function stopSpeaking(){
  speakToken++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (audioEl){ audioEl.pause(); audioEl.onended = audioEl.onerror = null; audioEl = null; }
  q.style.setProperty('--open', 0); q.classList.remove('lipsync'); setTalking(false);
}
const MOOD = { excited:'very excited and bubbly', proud:'proud and cheering', love:'soft and affectionate', gentle:'gentle and patient', sad:'soft and caring', surprised:'surprised and amazed', laughing:'giggling and playful', thinking:'curious and thoughtful' };
const ttsCache = new Map();
async function ttsBlob(text, uz){
  const emo = q.dataset.emo, voice = charVoice(), key = voice + settings.style + (uz?'u':'e') + emo + '|' + text;
  if (ttsCache.has(key)) return ttsCache.get(key);
  let r;
  if (SERVER) r = await api('/api/tts', { text, uz:!!uz, emotion:emo, speed:+settings.rate, voice, style:settings.style });
  else {
    r = await fetch('https://api.openai.com/v1/audio/speech', { method:'POST', headers:{ 'content-type':'application/json', authorization:'Bearer '+settings.oakey.trim() },
      body: JSON.stringify({ model:'gpt-4o-mini-tts', voice, input:text, response_format:'mp3', speed:+settings.rate,
        instructions:(uz ? 'Speak in Uzbek (the text is Uzbek in Latin script), like a caring friend. ' : 'Speak natural, relaxed conversational English like a friend on a phone call. ') + 'You are ' + cname() + ', ' + (P.CHARACTERS[settings.char.id] || P.CHARACTERS.qumri).persona + '. ' + (uz ? '' : 'Speaking style: ' + styleDef().tts + '. ') + 'Mood: ' + (MOOD[emo] || 'cheerful and warm') + '.' }) });
    if (!r.ok) throw new Error('tts');
  }
  const b = await r.blob(); if (ttsCache.size > 60) ttsCache.clear(); ttsCache.set(key, b); return b;
}
/* one audio element for all speech: phones allow it to play once the user has touched the screen */
let player = null, playerAn = null, audioUnlocked = false;
function getPlayer(){ if (!player){ player = new Audio(); player.preload = 'auto'; player.setAttribute('playsinline', ''); } return player; }
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
function unlockAudio(){
  if (audioUnlocked) return; audioUnlocked = true;
  const a = getPlayer(); a.src = SILENT; a.play().catch(() => { audioUnlocked = false; });
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch(e){}
}
['pointerdown','touchend','keydown'].forEach(ev => document.addEventListener(ev, unlockAudio, { capture:true, passive:true }));
function lipSync(audio){
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    if (!playerAn){ const src = actx.createMediaElementSource(audio); playerAn = actx.createAnalyser(); playerAn.fftSize = 512; src.connect(playerAn); playerAn.connect(actx.destination); }
    const an = playerAn;
    const buf = new Uint8Array(an.fftSize); q.classList.add('lipsync');
    const loop = () => {
      if (!audio || audio.paused || audio.ended){ q.style.setProperty('--open', 0); q.classList.remove('lipsync'); return; }
      an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++){ const v = (buf[i]-128)/128; s += v*v; }
      q.style.setProperty('--open', Math.min(1, Math.sqrt(s/buf.length)*6.5).toFixed(2)); requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch(e){}
}
function sayAI(text, uz){
  return ttsBlob(text, uz).then(b => new Promise(res => {
    const url = URL.createObjectURL(b); audioEl = getPlayer(); audioEl.src = url;
    audioEl.onended = audioEl.onerror = () => { URL.revokeObjectURL(url); res(); };
    lipSync(audioEl);
    audioEl.play().catch(() => { URL.revokeObjectURL(url); status('', "Ovozni yoqish uchun ekranga bir marta bosing 🔊"); audioUnlocked = false; res(); });
  }));
}
/* Uzbek has no browser voice almost anywhere; a Turkish voice reads Uzbek Latin text understandably. */
/* browsers don't say whether a voice is a man or a woman: guess from well-known voice names */
const MALE_V = /(\bmale\b|david|daniel|guy|alex\b|fred|george|ryan|mark|james|thomas|christopher|eric|roger|steffan|brian|andrew|tolga|ahmet|tom\b|aaron|arthur|oliver|rishi)/i;
const FEMALE_V = /(female|zira|aria|jenny|libby|sonia|samantha|karen|moira|tessa|susan|hazel|emma|ava|michelle|natasha|emel|seda|yelda|victoria|allison|serena|kate|fiona|catherine)/i;
const isMaleV = v => MALE_V.test(v.name) && !/female/i.test(v.name), isFemaleV = v => FEMALE_V.test(v.name) && !isMaleV(v);
const wantMale = () => settings.gender === 'male' || (settings.gender !== 'female' && !!charDef().male);
function uzVoice(){
  const all = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  const list = all.filter(v => /^uz/i.test(v.lang)).concat(all.filter(v => /^tr/i.test(v.lang)));
  if (settings.gender === 'auto' && !charDef().male) return list[0] || null;
  return list.find(wantMale() ? isMaleV : isFemaleV) || list[0] || null;
}
function enVoice(){
  const chosen = voices.find(v => v.name === $('voice').value);
  if (settings.gender === 'auto' && (settings.voice || !charDef().male)) return chosen;
  return voices.find(wantMale() ? isMaleV : isFemaleV) || chosen;
}
/* if no matching voice exists on the phone, the pitch still makes it sound lower or higher */
const voicePitch = (v, uz) => { const male = wantMale(); if (settings.gender === 'auto') return uz ? 1.05 : (charDef().pitch || 1.1); const ok = v && (male ? isMaleV(v) : isFemaleV(v)); return male ? (ok ? 1 : 0.7) : (ok ? 1.05 : 1.2); };
const hasBrowserVoice = () => ('speechSynthesis' in window) && speechSynthesis.getVoices().length > 0;
let noVoiceShown = false;
function noVoiceNote(){ if (noVoiceShown) return; noVoiceShown = true; addMsg('q', "🔇 Bu telefonda ovoz chiqarib bo'lmadi: serverda jonli ovoz ishlamayapti, Telegram esa telefon ovozini bermayapti. Javoblarni matn sifatida o'qing. Terminalda \"Jonli ovoz\" qatoriga qarang.").classList.add('sys'); }
function sayBrowser(text, rate, uz){
  return new Promise(res => {
    if (!('speechSynthesis' in window) || !text) return res();
    const u = new SpeechSynthesisUtterance(text); const v = uz ? uzVoice() : enVoice();
    if (uz && !v) return setTimeout(res, Math.min(2500, 400 + text.length * 35));
    if (v) u.voice = v; u.lang = v ? v.lang : 'en-US'; u.rate = rate || +settings.rate; u.pitch = voicePitch(v, uz);
    let done = false; const fin = () => { if (!done){ done = true; clearInterval(t); res(); } };
    u.onend = fin; u.onerror = fin; speechSynthesis.speak(u);
    const t = setInterval(() => { if (!speechSynthesis.speaking && !speechSynthesis.pending) fin(); }, 500); /* some browsers forget onend */
  });
}
/* parts: [{text, uz?}] in order; Uzbek parts only with the live AI voice */
async function speakParts(parts, opts){
  opts = opts || {};
  stopSpeaking(); const my = ++speakToken;
  parts = parts.filter(p => p.text && (!p.uz || p.force || settings.readUz) && !(p.opt && !useAIVoice() && !uzVoice()));
  if (!parts.length) return opts.after && opts.after();
  setTalking(true); activity();
  for (const p of parts){
    if (my !== speakToken) return;
    if (useAIVoice()){ try { await sayAI(p.text, p.uz); continue; } catch(e){ if (SERVER && !p.uz && e.code !== 'rate_limited') serverVoice = false; if (p.uz && !uzVoice()) continue; } }
    if (SERVER && !hasBrowserVoice()){ noVoiceNote(); continue; }
    await sayBrowser(p.text, p.rate || opts.rate, p.uz);
    if (p.pause) await sleep(p.pause);
  }
  if (my !== speakToken) return;
  setTalking(false); activity();
  if (opts.after) opts.after();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const speak = (text, rate) => speakParts([{ text }], { rate, after: () => { if (!listening && !busy) status('', room === 'talk' ? 'Navbat sizda' : ''); } });

/* ================= voice in ================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const CAN_REC = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
let micBlocked = SERVER ? !CAN_REC : !SR;
function micOff(reason){
  micBlocked = true; $('talk').disabled = true; $('hint').textContent = reason;
  $('typebar').hidden = false; $('handsfree').hidden = true;
}
let rec = null, live = null, listenOpts = null, emptyRuns = 0;
function liveBubble(text){
  if (listenOpts && listenOpts.silent) return;
  if (!live){ live = addMsg('me', ''); live.querySelector('.bubble').classList.add('live'); }
  live.querySelector('.bubble').textContent = text || '…'; scrollFeed();
}
function endListen(text, conf, dur){
  listening = false; $('talk').classList.remove('on','levels'); activity();
  const o = listenOpts || {}; listenOpts = null;
  if (live){ live.remove(); live = null; }
  text = (text||'').trim();
  if (text){ emptyRuns = 0; o.onDone && o.onDone(text, conf, dur); return; }
  if (o.onEmpty){ o.onEmpty(); return; }
  emptyRuns++; setEmo('happy');
  status('', emptyRuns >= 2 ? "Men shu yerdaman. Tayyor bo'lsangiz, tugmani bosing." : "Eshitmadim. Yana bir bor ayting-chi.");
  if (emptyRuns < 2 && o.retry) setTimeout(() => o.retry(), 500);
}
/* Browser speech recognition (Chrome): stops by itself after a pause. */
function listenWebSpeech(lang){
  rec = new SR(); rec.lang = lang === 'auto' ? 'uz-UZ' : 'en-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
  let finalText = '', interim = '', conf = null;
  rec.onresult = ev => {
    interim = ''; finalText = '';
    for (const r of ev.results){ if (r.isFinal){ finalText += r[0].transcript; if (r[0].confidence) conf = r[0].confidence; } else interim += r[0].transcript; }
    liveBubble((finalText + ' ' + interim).trim());
  };
  rec.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') micOff("Bu oynada mikrofon yopiq. Pastga yozib gaplashing."); };
  const t0 = Date.now();
  rec.onend = () => endListen(finalText || interim, conf, Math.max(0, (Date.now() - t0) / 1000 - 1.2));
  rec.start();
}
/* Telegram: record, detect the end of speech by loudness, our server writes it down. */
let mstream = null, mrec = null;
async function listenRecorder(lang){
  try { mstream = mstream || await navigator.mediaDevices.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:true, autoGainControl:true } }); }
  catch(e){ listening = false; $('talk').classList.remove('on'); listenOpts = null; micOff("Mikrofonga ruxsat berilmadi. Telegram sozlamalaridan ruxsat bering yoki yozib gaplashing."); return; }
  const chunks = [], type = ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  mrec = new MediaRecorder(mstream, type ? { mimeType:type, audioBitsPerSecond:32000 } : undefined);
  actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
  const src = actx.createMediaStreamSource(mstream), an = actx.createAnalyser(); an.fftSize = 1024; src.connect(an);
  const buf = new Uint8Array(an.fftSize), t0 = Date.now(); let floor = 0.01, heard = false, lastVoice = 0;
  $('talk').classList.add('levels');
  const stop = () => { clearInterval(vad); try { src.disconnect(); } catch(e){} if (mrec.state !== 'inactive') mrec.stop(); };
  const vad = setInterval(() => {
    an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++){ const v = (buf[i]-128)/128; s += v*v; }
    const rms = Math.sqrt(s/buf.length), now = Date.now();
    $('talk').style.setProperty('--lvl', Math.min(1, rms*8).toFixed(2));
    if (now - t0 < 350){ floor = Math.max(floor, rms); return; }
    if (rms > Math.max(0.02, floor*2.6)){ heard = true; lastVoice = now; }
    if ((heard && now - lastVoice > 1300) || (!heard && now - t0 > 8000) || now - t0 > 60000) stop();
  }, 60);
  mrec._stop = stop;
  mrec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
  mrec.onstop = async () => {
    const blob = new Blob(chunks, { type: mrec.mimeType || 'audio/webm' });
    if (!heard || blob.size < 1500) return endListen('');
    $('talk').classList.remove('on','levels'); status('thinking', 'Eshitganimni yozyapman…'); setEmo('thinking');
    try { const r = await api('/api/stt?' + new URLSearchParams({ lang: lang === 'auto' ? 'auto' : 'en', name: cname() }), blob, blob.type || 'audio/webm'); const j = await r.json(); endListen(j.text, j.conf, j.dur); }
    catch(e){ endListen(''); status('', errText(e)); }
  };
  mrec.start(500);
}
function startListen(opts){
  if (listening || busy || micBlocked) return false;
  stopSpeaking();
  listenOpts = opts || { onDone: (t, c, d) => send(t, d), retry: () => settings.handsfree && room === 'talk' && startListen() };
  listening = true; $('talk').classList.add('on'); setEmo('listening'); status('listening', 'Eshityapman…'); activity();
  if (TG && TG.HapticFeedback) try { TG.HapticFeedback.impactOccurred('light'); } catch(e){}
  const lang = listenOpts.lang || (settings.lang !== 'en' && room === 'talk' ? 'auto' : undefined);
  try { SERVER ? listenRecorder(lang) : listenWebSpeech(lang); } catch(e){ endListen(''); }
  return true;
}
function stopListen(){
  if (!listening) return;
  if (SERVER){ if (mrec && mrec._stop) mrec._stop(); }
  else if (rec) rec.stop();
}

/* ================= talk room ================= */
let turns = [], topic = settings.topic, lastQ = null;
function scrollFeed(){ feed.scrollTop = feed.scrollHeight; }
function addMsg(who, text){
  const m = el('div', 'msg ' + who); m.append(el('div', 'bubble', text)); feed.append(m);
  $('room-talk').classList.toggle('chatting', feed.children.length > 2);
  scrollFeed(); return m;
}
function qMsg(r){
  const m = addMsg('q', r.reply || '');
  if (r.praise_uz) m.prepend(el('div','praise', r.praise_uz));
  if (r.reply_uz && settings.lang !== 'en') m.querySelector('.bubble').append(el('div','ruz', r.reply_uz));
  const tips = tipsOf(r);
  if (tips.length){
    const t = el('div','tip'); t.append(el('div','k', tips.length > 1 ? `Xatolar tahlili · ${tips.length} ta` : 'Xato tahlili'));
    tips.forEach(x => {
      const row = el('div','trow');
      if (x.said) row.append(el('div','said', x.said));
      const b = el('div','better'); b.append(el('span', null, x.better), btn('hear', 'Eshitish', () => speakParts([{ text:x.better, rate:0.85 }])));
      row.append(b);
      if (x.en) row.append(el('div','ten', x.en));
      if (x.uz) row.append(el('div','tuz', x.uz));
      t.append(row);
    });
    m.append(t);
  }
  if (r.upgrade && r.upgrade.en) m.append(upgradeCard(r.upgrade));
  if (r.explain && (r.explain.en || r.explain.uz)) m.append(explainCard(r.explain));
  (r._added||[]).forEach(w => { const tg = el('div','wordtag'); tg.append(el('span',null,"+ So'z:"), el('b',null,w.w), el('span',null,w.uz)); m.append(tg); });
  const mini = el('div','mini');
  mini.append(btn('chipbtn','Qayta eshitish', () => speakTurn(r, false)), btn('chipbtn','Sekinroq', () => speak(r.reply, 0.75)));
  const ideas = (Array.isArray(r.ideas) ? r.ideas : []).filter(x => typeof x === 'string' && x.trim()).slice(0, 3);
  if (ideas.length){
    const box = el('div','ideas'); box.hidden = true;
    box.append(el('div','k', "Shunday deyishingiz mumkin (bosing, eshiting, takrorlang):"));
    ideas.forEach(t => box.append(btn('idea', t, () => { if (!$('typebar').hidden){ $('input').value = t; autoSize(); $('input').focus(); } speakParts([{ text:t, rate:0.85 }], { after: () => status('', 'Endi o\'zingiz ayting') }); })));
    mini.append(btn('chipbtn','Javob g\'oyasi', e => { box.hidden = !box.hidden; e.target.setAttribute('aria-expanded', !box.hidden); if (!box.hidden) scrollFeed(); }));
    m.append(mini, box);
  } else m.append(mini);
  scrollFeed(); lastQ = r; return m;
}
function tipsOf(r){
  const a = Array.isArray(r.tips) ? r.tips : r.tip ? [r.tip] : [];
  return a.filter(x => x && typeof x.better === 'string' && x.better.trim()).slice(0, 3);
}
/* "say it better": the learner's own idea in fluent English, then they repeat it out loud */
function upgradeCard(u){
  const c = el('div','upgrade'); c.append(el('div','k','Yanada tabiiy aytish'));
  const en = el('div','uen', u.en); c.append(en);
  if (u.uz) c.append(el('div','uuz', u.uz));
  const res = el('div','ures'); res.hidden = true;
  const row = el('div','mini');
  row.append(btn('chipbtn','Eshitish', () => speakParts([{ text:u.en, rate:0.85 }])));
  if (!micBlocked) row.append(btn('chipbtn','Takrorlab ayting', async () => {
    await speakParts([{ text:u.en, rate:0.85, pause:200 }]);
    const t = await new Promise(res2 => { if (!startListen({ silent:true, lang:'en', onDone: x => res2(x), onEmpty: () => res2('') })) res2(''); });
    const sc = Math.round(similar(t, u.en) * 100);
    res.hidden = false; res.className = 'ures ' + (sc >= 75 ? 'ok' : 'no');
    res.textContent = !t ? "Eshitmadim. Yana bir bor bosing." : sc >= 75 ? `Zo'r! ${sc}% mos keldi 👏` : `${sc}% mos. Siz: "${t}". Yana bir bor urinib ko'ring.`;
    if (sc >= 75) emote('proud');
  }));
  c.append(row, res); return c;
}
function explainCard(x){
  const c = el('div','explain'); c.append(el('div','k','Tushuntirish'));
  if (x.en){ const p = el('p','en', x.en); c.append(p); }
  if (x.uz) c.append(el('p','uz', x.uz));
  const ex = (Array.isArray(x.examples) ? x.examples : []).filter(e => e && e.en).slice(0, 4);
  if (ex.length){ const ul = el('ul'); ex.forEach(e => { const li = el('li'); li.append(el('b', null, e.en)); if (e.uz) li.append(el('span', null, e.uz)); li.onclick = () => speakParts([{ text:e.en, rate:0.85 }]); ul.append(li); }); c.append(ul); }
  const row = el('div','mini');
  if (x.en) row.append(btn('chipbtn','Inglizchasini eshitish', () => speakParts([{ text:x.en }])));
  if (x.uz) row.append(btn('chipbtn',"O'zbekchasini eshitish", () => speakParts([{ text:x.uz, uz:true, force:true }])));
  c.append(row); return c;
}
function saveMistakes(tips){
  if (!tips.length) return;
  tips.forEach(x => {
    const key = x.better.trim().toLowerCase(); const old = mistakes.find(m => m.better.toLowerCase() === key);
    if (old){ old.n = (old.n||1) + 1; old.day = today(); return; }
    mistakes.push({ cat:P.CATS[x.cat] ? x.cat : undefined, said:String(x.said||'').slice(0,200), better:x.better.trim().slice(0,200), en:String(x.en||'').slice(0,200), uz:String(x.uz||'').slice(0,300), day:today(), n:1, ok:0 });
  });
  mistakes = mistakes.slice(-200); LS.set('mistakes', mistakes); renderBadge();
}
function speakTurn(r, thenListen){
  /* "Labbay!" is Uzbek: say it with the Uzbek voice, the rest in English */
  const m = String(r.reply || '').match(/^\s*labbay[!,.]?\s*/i);
  const parts = m ? [{ text:'Labbay!', uz:true, force:true, pause:120 }, { text:r.reply.slice(m[0].length) }] : [{ text:r.reply }];
  if (r.reply_uz && settings.lang !== 'en') parts.push({ text:r.reply_uz, uz:true, opt:true, pause:150 });
  const tips = tipsOf(r);
  if (tips[0]){ parts.push({ text:tips[0].better, rate:0.85, pause:150 }); if (tips[0].uz) parts.push({ text:tips[0].uz, uz:true }); }
  if (r.explain){ if (r.explain.en) parts.push({ text:r.explain.en }); if (r.explain.uz) parts.push({ text:r.explain.uz, uz:true, force:true }); }
  speakParts(parts, { after: () => {
    status('', micBlocked ? 'Javob yozing' : settings.handsfree ? 'Gapiring, men tinglayman' : 'Navbat sizda');
    if (thenListen && settings.handsfree && !micBlocked && room === 'talk') setTimeout(() => startListen(), 350);
  }});
}
const rnd = a => a[Math.floor(Math.random() * a.length)];
function greet(){
  const h = new Date().getHours(), s = streak();
  const hi = h < 12 ? 'Good morning!' : h < 18 ? 'Hi there!' : 'Good evening!';
  const missed = LS.get('lastDay', null) && LS.get('lastDay') !== today() && s === 0;
  if (missed) return { emotion:'sad', praise_uz:"Sizni sog'indim!", reply:`${hi} I missed you! What have you been up to?` };
  const praise = s > 1 ? `${s} kun ketma-ket! Zo'r!` : '';
  if (settings.style !== 'samimiy') return { emotion: settings.style === 'jiddiy' || settings.style === 'faylasuf' ? 'thinking' : 'excited', praise_uz: praise, reply: styleDef().hi };
  return { emotion:'excited', praise_uz: praise, reply:`${hi} I'm ${cname()}. Let's just chat, like friends. How are you today?` };
}
/* the learner names their companion; that name is used everywhere and it answers "Labbay!" to it */
function setName(v, announce){
  const n = P.cleanName(v, '');
  if (!n){ status('', "Ism faqat harflardan iborat bo'lsin (1–20 ta)."); return false; }
  settings.char.name = n; LS.set('named', true); applyChar(false);
  if (announce){
    const r = { emotion:'love', reply:`Labbay! I love my new name. From now on, I'm ${n}. Just call my name, and I'll answer.`, praise_uz:`Endi ismim ${n}. "${n}!" deb chaqirsangiz, "Labbay!" deyman.` };
    turns.push({ role:'assistant', content: JSON.stringify({ emotion:r.emotion, reply:r.reply }) }); saveChat();
    qMsg(r); emote('love'); speakTurn(r, true);
  }
  return true;
}
function nameCard(){
  const m = el('div','msg q namecard'), c = el('div','explain');
  c.append(el('div','k','Hamrohingizga ism bering'), el('p', null, "Menga o'zingiz yoqtirgan ismni qo'ying. Keyin ismimni aytib chaqirsangiz, \"Labbay!\" deb javob beraman."));
  const inp = el('input'); inp.maxLength = 20; inp.placeholder = 'Masalan: Aziza, Sardor, Nilufar'; inp.autocomplete = 'off'; inp.setAttribute('aria-label', 'Hamroh ismi');
  const row = el('div','mini');
  const ok = btn('btn primary', 'Saqlash', () => { if (setName(inp.value, true)) m.remove(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); });
  row.append(ok, btn('chipbtn', 'Keyinroq', () => { LS.set('named', true); m.remove(); }));
  c.append(inp, row); m.append(c); feed.append(m); scrollFeed();
}
function startTalk(newChat){
  feed.innerHTML = ''; turns = [];
  if (!newChat && chat.length){
    chat.slice(-12).forEach(t => { turns.push(t); if (t.role === 'user') addMsg('me', t.content); else { const r = parseJSON(t.content, { reply:t.content }); addMsg('q', r.reply); lastQ = r; } });
    setEmo('happy'); status('', 'Davom etamiz! Tugmani bosing.'); renderTargets(); return;
  }
  const g = greet(); turns.push({ role:'assistant', content: JSON.stringify({ emotion:g.emotion, reply:g.reply }) }); saveChat();
  qMsg(g); emote(g.emotion); status('', micBlocked ? 'Javob yozing' : 'Tugmani bosing va javob bering'); renderTargets();
  if (!settings.char.name && !LS.get('named', false)) nameCard();
}
function saveChat(){ chat = turns.slice(-30); LS.set('chat', chat); }
const QUICK = ['free','standup','problem','site','engjob','airport','hotel','taxi','colleague','present','supplier','day','directions','wouldyou'];
function pickTopic(k){
  if (!P.pick(P.TOPICS, k)) return;
  const t = P.TOPICS[k];
  topic = k; settings.topic = k; saveSettings(); renderTopics(); stopListen(); stopSpeaking();
  $('topicSheet').classList.remove('open');
  const r = { emotion: t.game || t.rp ? 'excited' : 'happy', reply: rnd(t.open), praise_uz: t.game ? t.d + '.' : t.rp ? "Rol o'yini: hayotdagidek gaplashamiz." : '' };
  turns.push({ role:'assistant', content: JSON.stringify({ emotion:r.emotion, reply:r.reply }) }); saveChat();
  qMsg(r); emote(r.emotion); speakTurn(r, true);
}
function renderTopics(){
  const box = $('topics'); box.innerHTML = '';
  const all = btn('topic all', 'Barcha mavzular · ' + Object.keys(P.TOPICS).length, openTopics);
  const dice = btn('topic', '🎲 Tasodifiy', () => { const ks = Object.keys(P.TOPICS).filter(k => k !== topic && k !== 'free'); pickTopic(rnd(ks)); });
  box.append(all, dice);
  [topic].concat(QUICK.filter(k => k !== topic)).forEach(k => {
    const t = P.TOPICS[k]; const b = btn('topic', t.ic + ' ' + t.uz, () => pickTopic(k));
    b.setAttribute('aria-pressed', topic === k); box.append(b);
  });
}
function openTopics(){
  const box = $('topicCats'); box.innerHTML = '';
  Object.entries(P.TOPIC_CATS).forEach(([c, name]) => {
    const sec = el('div','sec'); sec.append(el('h3', null, name));
    const grid = el('div','tgrid');
    Object.entries(P.TOPICS).filter(([, t]) => t.cat === c).forEach(([k, t]) => {
      const b = el('button','tcard'); b.type = 'button'; b.setAttribute('aria-pressed', topic === k);
      b.append(el('span','ti', t.ic), el('b', null, t.uz));
      if (t.d || t.rp) b.append(el('small', null, t.d || "Rol o'yini"));
      b.onclick = () => pickTopic(k); grid.append(b);
    });
    sec.append(grid); box.append(sec);
  });
  $('topicSheet').classList.add('open');
}
/* today's target words for the conversation: due words first, then the ones still being learned (not used yet today) */
function targetWords(n){
  const t = today(), list = words.filter(w => w && w.w && (w.box||0) <= 3 && w.usedDay !== t && w.src !== 'pattern' && w.w.length <= 30);
  const d = list.filter(w => (w.due||'') <= t).sort((a,b) => ((a.used||0) - (b.used||0)) || ((a.box||0) - (b.box||0)));
  const rest = list.filter(w => (w.due||'') > t && (w.box||0) >= 1).sort((a,b) => (a.box||0) - (b.box||0));
  return d.concat(rest).slice(0, n || 5);
}
let tgtNow = [];
function learningWords(){ tgtNow = targetWords(5); return tgtNow.map(w => w.w); }
const wordIn = (text, w) => new RegExp('(^|[^a-z])' + w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '([^a-z]|$)', 'i').test(text);
/* the AI says which target words were used correctly; a used word counts as a successful review (once a day) */
function usedLearning(text, aiList){
  const names = Array.isArray(aiList) ? aiList.map(x => String(x||'').toLowerCase().trim()) : null, t = today();
  const hit = tgtNow.filter(w => wordIn(text, w.w) && (!names || names.includes(w.w.toLowerCase())) && w.usedDay !== t);
  hit.forEach(w => { w.used = (w.used||0) + 1; w.usedDay = t; grade(w, true); });
  if (hit.length){ LS.set('words', words); renderBadge(); }
  return hit;
}
function renderTargets(){
  const box = $('targets'); if (!box) return;
  const list = targetWords(5), t = today(), usedToday = words.filter(w => w.usedDay === t).slice(-3);
  box.innerHTML = ''; box.hidden = !list.length && !usedToday.length; if (box.hidden) return;
  box.append(el('span', 'tl', '🎯 Bugun ishlating:'));
  usedToday.forEach(w => box.append(el('span', 'tw done', '✓ ' + w.w)));
  list.forEach(w => { const b = btn('tw', w.w, () => { status('', w.w + ' — ' + w.uz); speakParts([{ text:w.w }]); }); box.append(b); });
}
async function send(text, dur){
  text = (text||'').trim(); if (!text || busy) return;
  if (dur){ const ft = P.fluTurn(text, dur); if (ft){ flu = P.fluAdd(flu, today(), ft); LS.set('flu', flu); } }
  busy = true; $('input').value = ''; autoSize(); stopSpeaking();
  /* just the name ("Aziza!", "hey Aziza"): answer at once, no AI call */
  if (P.calledBy(text, cname()) === 'only'){
    addMsg('me', text); turns.push({ role:'user', content:text });
    const r = { emotion:'happy', reply:"Labbay! Yes, I'm here. I'm listening." };
    turns.push({ role:'assistant', content: JSON.stringify(r) }); saveChat(); activity();
    busy = false; qMsg(r); emote('happy'); lookAt(0, 0); speakTurn(r, true); return;
  }
  addMsg('me', text); setEmo('thinking'); status('thinking', cname() + " o'ylayapti…"); $('talk').classList.add('busy');
  turns.push({ role:'user', content:text }); activity();
  try {
    const raw = await ai('chat', { topic, style:settings.style, corrections:settings.corrections, lang:settings.lang, about:settings.about || '', weak:P.weakOf(mistakes).map(x => x.cat), level:settings.level, turns:turns.slice(-20), learning:learningWords(), character:settings.char.id, name:cname() });
    if (!String(raw).trim()) throw Object.assign(new Error('empty'), { code:'empty' });
    const r = parseJSON(raw, { emotion:'happy', reply:raw.trim(), tip:null });
    if (!r.reply) r.reply = "Sorry, can you say that again?";
    const keep = { emotion:r.emotion, reply:r.reply }; if (r.memo && P.TOPICS[topic].game) keep.memo = String(r.memo).slice(0, 300);
    turns.push({ role:'assistant', content: JSON.stringify(keep) }); saveChat();
    LS.set('lastDay', today());
    const used = usedLearning(text, r.used_words);
    if (used.length){ r.praise_uz = (r.praise_uz ? r.praise_uz + ' ' : '') + `🎯 Bugungi so'zni to'g'ri ishlatdingiz: ${used.map(w => w.w).join(', ')}! Yodlandi deb belgiladim.`; feathers($('targets'), 8); }
    renderTargets(); lessonTalkTick();
    r._added = addWords(r.new_words, 'chat'); saveMistakes(tipsOf(r));
    busy = false; $('talk').classList.remove('busy');
    qMsg(r); emote(used.length ? 'proud' : r.emotion || 'happy'); speakTurn(r, true);
  } catch(e){
    turns.pop(); busy = false; $('talk').classList.remove('busy');
    emote('sad'); status('', errText(e)); addMsg('q', '⚠️ ' + errText(e)).classList.add('sys');
    if (e.code === 'no_key' || e.code === 'bad_key') openSheet();
    if (e.code === 'quota' && SERVER) offerPremium();
  }
}
function offerPremium(){
  const m = addMsg('q', "Premium bilan cheklovsiz gaplashamiz.");
  m.append(btn('btn primary', 'Premium olish', async () => {
    try { const r = await api('/api/invoice', {}); const { link } = await r.json(); TG.openInvoice(link, st => { if (st === 'paid'){ emote('love'); status('', 'Rahmat! Premium yoqildi.'); } }); }
    catch(e){ status('', "To'lov oynasini ochib bo'lmadi."); }
  }));
}
function autoSize(){ const t = $('input'); t.style.height = 'auto'; t.style.height = Math.min(100, t.scrollHeight) + 'px'; }
$('send').onclick = () => send($('input').value);
$('input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send($('input').value); } });
$('input').addEventListener('input', autoSize);
$('kbBtn').onclick = () => { $('typebar').hidden = !$('typebar').hidden; if (!$('typebar').hidden) $('input').focus(); };
$('replayBtn').onclick = () => lastQ && speakTurn(lastQ, false);
$('talk').onclick = () => {
  if (busy) return;
  if (listening) return stopListen();
  if (speaking) stopSpeaking();
  emptyRuns = 0; startListen();
};
$('handsfree').setAttribute('aria-checked', settings.handsfree);
$('handsfree').onclick = () => { settings.handsfree = !settings.handsfree; saveSettings(); $('handsfree').setAttribute('aria-checked', settings.handsfree); };
document.addEventListener('keydown', e => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (e.code === 'Space' && !e.repeat && !['TEXTAREA','INPUT','SELECT','BUTTON'].includes(tag) && room === 'talk'){ e.preventDefault(); $('talk').click(); }
});
if (micBlocked) micOff(SERVER ? "Bu Telegram versiyasida mikrofon yo'q. Yozib gaplashing." : "Bu yerda ovoz tanish yo'q. Pastga yozib gaplashing.");

/* ================= words: spaced repetition ================= */
const STEPS = [0, 1, 2, 4, 7, 15, 30];   /* days until the next review, by box */
const BOXNAME = ['yangi','1-bosqich','2-bosqich','3-bosqich','4-bosqich','5-bosqich','yodlandi'];
const PACKS = {
  daily:  { uz:'Har kuni', items:"wake up|uyg'onmoq|I wake up at seven.;busy|band|I'm busy today.;tired|charchagan|I'm so tired!;in a hurry|shoshilib|Sorry, I'm in a hurry.;usually|odatda|I usually walk to work.;weekend|dam olish kunlari|What did you do at the weekend?;neighbour|qo'shni|My neighbour is very kind.;chores|uy ishlari|I do the chores on Sunday.;take a nap|bir oz uxlab olmoq|I take a nap after lunch.;on my way|yo'ldaman|I'm on my way!" },
  feel:   { uz:"His-tuyg'ular", items:"excited|hayajonlangan|I'm excited about the trip.;worried|xavotirda|Don't be worried.;proud|faxrlanmoq|I'm proud of you.;bored|zerikkan|I'm bored at home.;nervous|hayajonda, asabiy|I feel nervous before exams.;grateful|minnatdor|I'm grateful for your help.;upset|xafa|She was upset yesterday.;relaxed|xotirjam|I feel relaxed by the sea.;confused|chalkashgan|I'm a bit confused.;lonely|yolg'iz (his)|Sometimes I feel lonely." },
  food:   { uz:'Ovqat', items:"delicious|juda mazali|This plov is delicious!;spicy|achchiq|I don't like spicy food.;recipe|retsept|Can you share the recipe?;order|buyurtma bermoq|Can I order now?;the bill|hisob (to'lov)|Can we have the bill, please?;dessert|shirinlik|What's for dessert?;starving|juda och|I'm starving!;fresh|yangi, toza|The bread is fresh.;leftovers|qolgan ovqat|We ate the leftovers.;homemade|uyda tayyorlangan|I love homemade bread." },
  travel: { uz:'Sayohat', items:"trip|sayohat|We had a great trip.;luggage|yuk, chamadon|My luggage is heavy.;delay|kechikish|There's a delay.;abroad|chet elda|I want to study abroad.;sightseeing|diqqatga sazovor joylarni ko'rish|We went sightseeing.;souvenir|esdalik sovg'a|I bought a souvenir.;view|manzara|What a beautiful view!;book a room|xona band qilmoq|I booked a room.;journey|safar|The journey was long.;get lost|adashib qolmoq|We got lost in the city." },
  talk:   { uz:'Suhbat iboralari', items:"How's it going?|Ishlar qalay?|Hey! How's it going?;No way!|Bo'lishi mumkin emas!|No way! Really?;I guess so|Shunday bo'lsa kerak|I guess so.;It depends|Vaziyatga bog'liq|It depends on the weather.;To be honest|Rostini aytsam|To be honest, I'm tired.;Sounds good|Yaxshi fikr|Sounds good to me!;What do you mean?|Nima demoqchisiz?|Sorry, what do you mean?;By the way|Aytgancha|By the way, I saw Ali.;That makes sense|Tushunarli|Oh, that makes sense.;Never mind|Mayli, hechqisi yo'q|Never mind, it's okay." },
  work:   { uz:"Ish va o'qish", items:"deadline|oxirgi muddat|The deadline is Friday.;colleague|hamkasb|My colleague helped me.;salary|maosh|The salary is good.;improve|yaxshilamoq|I want to improve my English.;skill|ko'nikma|Speaking is an important skill.;goal|maqsad|My goal is to speak fluently.;schedule|jadval|My schedule is full.;experience|tajriba|I have two years of experience.;achieve|erishmoq|You can achieve it!;give up|taslim bo'lmoq|Don't give up!" }
};
Object.entries(window.QumriPacks || {}).forEach(([k, p]) => { if (!PACKS[k]) PACKS[k] = p; });
/* ===== 3000-word course (by frequency, 6 levels) and sentence patterns ===== */
const CORE = (() => {
  const c = window.QumriCore || {};
  const list = c.words ? c.words.split('~').map((s, i) => { const [w, uz, ex] = s.split('|'); return { w, uz, ex, i }; }) : [];
  return { list, levels: c.levels || [], patterns: c.patterns || [] };
})();
(CORE.patterns || []).forEach((g, i) => { PACKS['pat' + i] = { uz: g.uz, list: g.list, pat: true }; });
const CORE_LV = ["1-bosqich · eng zarur", '2-bosqich', '3-bosqich', '4-bosqich', '5-bosqich', '6-bosqich'];
const levelOf = i => { let l = 0; while (l < CORE.levels.length && i >= CORE.levels[l]) l++; return l; };
const coreN = () => Math.max(0, Math.min(30, settings.coreN == null ? 10 : +settings.coreN));
const wordSet = () => new Set(words.map(x => String(x.w).toLowerCase()));
/* add today's new course words (once a day), but don't pile up unseen ones */
function coreDaily(force){
  if (!CORE.list.length || (!force && (!coreN() || settings.coreDay === today()))) return 0;
  const waiting = words.filter(w => w.src === 'core' && !w.box && !w.seen).length;
  const want = force ? (coreN() || 10) : Math.max(0, Math.min(coreN(), coreN() * 2 - waiting));
  const have = wordSet(); let n = 0;
  for (const x of CORE.list){
    if (n >= want) break;
    if (have.has(x.w.toLowerCase())) continue;
    words.push({ w:x.w, uz:x.uz, ex:x.ex, box:0, due:today(), src:'core' }); n++;
  }
  if (!force){ settings.coreDay = today(); saveSettings(); }
  if (n){ LS.set('words', words); queue = []; }
  return n;
}
const packItems = p => p.list || p.items.split(';').map(s => { const [w, uz, ex] = s.split('|'); return { w, uz, ex }; });
const hasWord = w => words.some(x => x.w.toLowerCase() === String(w).toLowerCase().trim());
function addWords(list, src){
  const added = [];
  (Array.isArray(list) ? list : []).slice(0,3).forEach(w => {
    if (!w || !w.w) return; const key = String(w.w).toLowerCase().trim();
    if (key.length < 2 || key.length > 60 || hasWord(key)) return;
    const item = { w:String(w.w).trim(), uz:String(w.uz||'').trim(), ex:String(w.ex||'').trim(), box:0, due:today(), src:src||'' };
    words.push(item); added.push(item);
  });
  if (added.length){ LS.set('words', words); renderBadge(); }
  return added;
}
const due = () => words.filter(w => w.due <= today() && w.box < STEPS.length - 1);
function grade(w, ok){
  /* ok: true (bilaman), false (eslay olmadim), 'hard' (qiyin: same step, sooner), 'known' (already knew it) */
  if (ok === 'known'){ w.box = 5; w.due = addDays(30); }
  else if (ok === 'hard'){ w.box = Math.max(1, w.box); w.due = addDays(Math.max(1, Math.floor(STEPS[w.box] / 2))); }
  else if (ok){ w.box = Math.min(STEPS.length - 1, w.box + 1); w.due = addDays(STEPS[w.box]); }
  else { w.box = Math.min(w.box, 1); w.due = today(); }
  w.seen = (w.seen||0) + 1; w.t = Date.now(); LS.set('words', words); activity();
}
let wmode = 'cards', queue = [], cur = null, sessionOk = 0;
function buildQueue(){ queue = due().sort((a,b) => (b.box - a.box) || 0).slice(0, 25); }
function renderPractice(){
  const box = $('practice'); box.innerHTML = '';
  if (wmode === 'mistakes'){ $('wSub').textContent = `${mistakes.length} ta xato · ${mistakes.filter(m => (m.ok||0) >= 2).length} tasi o'zlashtirildi`; return renderMistakes(box); }
  if (wmode !== 'voice') coreDaily();
  $('wSub').textContent = `${due().length} ta takrorlash · ${words.filter(w => w.box >= 4).length} ta yodlangan`;
  if (!words.length){
    const d = el('div','done'); d.append(el('div','big',"Keling, so'z yig'amiz!"), el('div','note',"Pastdan to'plam tanlang yoki hamrohingiz bilan gaplashing: suhbatdagi yangi so'zlar shu yerga o'zi tushadi.")); box.append(d); return;
  }
  if (wmode === 'voice') return renderVoice(box);
  if (!queue.length) buildQueue();
  cur = queue[0];
  if (!cur){
    const d = el('div','done'); d.append(el('div','big', sessionOk ? `Barakalla! ${sessionOk} ta so'z takrorlandi` : "Bugungi takrorlash tugadi!"), el('div','note', "Ertaga yana eslataman. Hozir gaplashib, shu so'zlarni ishlatib ko'ring!"));
    d.append(btn('btn primary',"Gaplashishga o'tish", () => setRoom('talk'))); box.append(d);
    if (sessionOk){ setTimeout(() => feathers(d, 14), 100); sessionOk = 0; }
    return;
  }
  if (wmode === 'voice') return renderVoice(box);
  if (wmode === 'quiz' && words.length >= 4) return renderQuiz(box);
  if (wmode === 'write' && cur.src !== 'pattern') return renderWrite(box);
  renderCard(box);
}
function renderCard(box){
  let flipped = false;
  const deck = el('div','deck'), card = el('div','card'); card.tabIndex = 0; card.setAttribute('role','button'); card.setAttribute('aria-label','Kartochkani aylantirish');
  const front = el('div','face'), back = el('div','face back');
  front.append(el('div','box', BOXNAME[cur.box] || ''), el('div','big', cur.w));
  if (cur.sound) front.append(el('div','sound', '[' + cur.sound + ']'));
  front.append(el('div','hint',"Bosing va tarjimasini ko'ring"));
  back.append(el('div','big', cur.w), el('div','uz', cur.uz));
  if (cur.ex) back.append(el('div','ex', cur.ex));
  if (cur.trick) back.append(el('div','trick', cur.trick));
  card.append(front, back); deck.append(card); box.append(deck);
  const rate = el('div','rate'); rate.hidden = true;
  const flip = () => { flipped = !flipped; card.classList.toggle('flip', flipped); rate.hidden = !flipped; if (flipped && cur.ex) speak(cur.ex, 0.85); };
  card.onclick = flip; card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); flip(); } };
  const tools = el('div','tools');
  tools.append(btn('tool','Tinglash', () => speak(cur.w, 0.8)));
  if (!cur.trick) tools.append(btn('tool','Yodlash hiylasi', () => getTrick(cur)));
  if (!micBlocked) tools.append(btn('tool',"Aytib ko'rish", () => sayIt(cur)));
  box.append(tools);
  rate.append(btn('no','Eslay olmadim', () => next(card, false)), btn('hard','Qiyin', () => next(card, 'hard')), btn('yes','Bilaman', () => next(card, true)));
  box.append(rate);
  if (!cur.box && !cur.seen){ const k = btn('knew', "Bu so'zni oldindan bilaman, o'tkazib yuborish", () => next(card, 'known')); box.append(k); }
  setTimeout(() => speak(cur.w, 0.85), 250);
}
function next(card, ok){
  grade(cur, ok); queue.shift(); if (!ok) queue.push(cur); else sessionOk++;
  if (ok && TG && TG.HapticFeedback) try { TG.HapticFeedback.notificationOccurred('success'); } catch(e){}
  if (card){ card.classList.add(ok ? 'out-r' : 'out-l'); setTimeout(renderPractice, 300); } else renderPractice();
  renderBadge(); renderWordList(); renderCourse();
}
function renderQuiz(box){
  const reverse = Math.random() < 0.4, others = words.filter(w => w !== cur).sort(() => Math.random() - 0.5).slice(0, 3);
  const opts = others.concat([cur]).sort(() => Math.random() - 0.5);
  const qz = el('div','quiz');
  qz.append(el('div','box', reverse ? 'Inglizchasini toping' : "Ma'nosini toping"), el('div','qword', reverse ? cur.uz : cur.w));
  if (!reverse) setTimeout(() => speak(cur.w, 0.85), 250);
  let answered = false;
  opts.forEach(o => {
    const b = btn('opt', reverse ? o.w : o.uz, () => {
      if (answered) return; answered = true;
      const ok = o === cur; b.classList.add(ok ? 'right' : 'wrong');
      if (!ok) [...qz.querySelectorAll('.opt')].forEach(x => { if (x.textContent === (reverse ? cur.w : cur.uz)) x.classList.add('right'); });
      if (ok) feathers(b, 6);
      speak(cur.w + (cur.ex ? '. ' + cur.ex : ''), 0.9);
      setTimeout(() => next(null, ok), ok ? 1000 : 1800);
    });
    qz.append(b);
  });
  box.append(qz);
}
async function getTrick(w){
  status('thinking', cname() + " hiyla o'ylayapti…"); setEmo('thinking');
  try {
    const t = parseJSON(await ai('mnemonic', { w:w.w, uz:w.uz }), null);
    if (t && t.trick){ w.trick = t.trick; if (t.sound) w.sound = t.sound; if (!w.ex && t.ex) w.ex = t.ex; LS.set('words', words); emote('excited'); status('', 'Mana, endi oson eslab qolasiz!'); renderPractice(); }
  } catch(e){ status('', errText(e)); setEmo('sad'); }
}
const norm = s => ' ' + String(s).toLowerCase().replace(/[^a-z' ]+/g,' ').replace(/\s+/g,' ').trim() + ' ';
function sayIt(w){
  startListen({ silent:true, onDone: (t) => {
    if (norm(t).includes(norm(w.w))){ emote('excited'); status('', "Zo'r talaffuz! Aniq eshitdim."); }
    else { emote('gentle'); status('', `"${t}" deb eshitdim. Sekin tinglab, yana urinib ko'ring.`); speak(w.w, 0.7); }
  }});
}
/* "Yozish": see the Uzbek meaning (and the example with a gap), type the English. Active recall sticks best. */
const escRe = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const plain = t => String(t).toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();
function near(a, b){
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length){ if (a[i] === b[j]){ i++; j++; continue; } if (++d > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return d + (a.length - i) + (b.length - j) <= 1;
}
function renderWrite(box){
  const w = cur, wr = el('div','quiz write');
  wr.append(el('div','box', w.box ? BOXNAME[w.box] + ' · inglizchasini yozing' : 'Inglizchasini yozing'), el('div','qword uzq', w.uz));
  const re = new RegExp('\\b' + escRe(w.w) + "[a-z']*", 'i');
  if (w.ex && re.test(w.ex)) wr.append(el('div','cloze', w.ex.replace(re, '_____')));
  const inp = el('input','winput'); inp.type = 'text'; inp.autocomplete = 'off'; inp.setAttribute('autocapitalize','off'); inp.spellcheck = false; inp.placeholder = 'Inglizcha…';
  const fb = el('div','wfb'); let shown = 0, done = false;
  const hint = btn('tool','Yordam (1 harf)', () => { shown = Math.min(w.w.length, shown + 1); inp.value = w.w.slice(0, shown); inp.focus(); });
  const go = btn('btn primary','Tekshirish', check);
  function check(){
    if (done){ return next(null, done.res); }
    const a = plain(inp.value), b = plain(w.w);
    if (!a){ inp.focus(); return; }
    const ok = a === b, close = !ok && b.length > 3 && near(a, b);
    const res = ok ? (shown ? 'hard' : true) : close ? 'hard' : false;
    done = { res };
    inp.disabled = true; hint.hidden = true;
    fb.className = 'wfb ' + (ok ? 'good' : close ? 'close' : 'bad');
    fb.textContent = ok ? (shown ? "To'g'ri (yordam bilan)." : "To'g'ri! Barakalla.") : close ? `Deyarli! To'g'risi: ${w.w}` : `To'g'risi: ${w.w}`;
    if (ok) feathers(fb, 6);
    if (w.ex) wr.append(el('div','ex', w.ex));
    speak(w.w + (w.ex ? '. ' + w.ex : ''), 0.85);
    go.textContent = 'Keyingisi';
  }
  inp.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); check(); } };
  const row = el('div','wrow2'); row.append(hint, go);
  wr.append(inp, row, fb); box.append(wr);
  setTimeout(() => { try { inp.focus(); } catch(e){} }, 200);
}

/* 3000-word course card: progress by level, words per day, quick "I already know these" check */
function renderCourse(){
  const box = $('course'); if (!box) return; box.innerHTML = '';
  if (!CORE.list.length){ box.hidden = true; return; }
  const map = new Map(words.map(w => [String(w.w).toLowerCase(), w]));
  const lv = CORE_LV.map(() => ({ total:0, added:0, learned:0 }));
  CORE.list.forEach(x => { const l = lv[levelOf(x.i)]; l.total++; const w = map.get(x.w.toLowerCase()); if (w){ l.added++; if (w.box >= 4) l.learned++; } });
  const added = lv.reduce((a, l) => a + l.added, 0), learned = lv.reduce((a, l) => a + l.learned, 0);
  const head = el('div','chead'); head.append(el('b', null, `${learned} ta yodlangan · ${added} / ${CORE.list.length} boshlangan`), el('span', null, "Eng ko'p ishlatiladigan so'zlar, chastota bo'yicha"));
  box.append(head);
  const bars = el('div','clv');
  lv.forEach((l, i) => {
    const r = el('div','clrow'); const bar = el('div','cbar'); const a = el('i','a'), b = el('i','b');
    a.style.width = (l.added / l.total * 100).toFixed(1) + '%'; b.style.width = (l.learned / l.total * 100).toFixed(1) + '%';
    bar.append(a, b); r.append(el('span', null, CORE_LV[i]), bar, el('small', null, `${l.learned}/${l.total}`)); bars.append(r);
  });
  box.append(bars);
  const per = el('div','cper'); per.append(el('span', null, "Kuniga yangi so'z:"));
  const seg = el('div','seg');
  [0, 5, 10, 15, 20].forEach(n => { const b = btn('', n ? String(n) : "To'xtat", () => { settings.coreN = n; saveSettings(); renderCourse(); }); b.setAttribute('aria-pressed', coreN() === n); seg.append(b); });
  per.append(seg); box.append(per);
  const acts = el('div','cacts');
  acts.append(btn('btn', `+${coreN() || 10} ta so'z hozir`, () => { const n = coreDaily(true); emote(n ? 'excited' : 'gentle'); status('', n ? `${n} ta yangi so'z qo'shildi. Kartochkadan boshlang!` : "Hamma so'zlar qo'shib bo'lingan!"); renderWordsRoom(); }));
  acts.append(btn('btn', "Bilganlarimni belgilash", () => renderKnown(box)));
  box.append(acts);
}
/* show the next 40 words; tap the ones you already know, they skip straight to "yodlangan" */
function renderKnown(box){
  const have = wordSet(), next40 = CORE.list.filter(x => !have.has(x.w.toLowerCase())).slice(0, 40), pick = new Set();
  const p = el('div','known');
  p.append(el('p','note',"Biladigan so'zlaringizni bosing. Ular yodlanganlar qatoriga o'tadi va bir oydan keyin bir marta tekshiriladi. Qolganlari navbat bilan o'rgatiladi."));
  const chips = el('div','chips');
  next40.forEach(x => { const c = btn('chip', x.w, () => { pick.has(x) ? pick.delete(x) : pick.add(x); c.classList.toggle('on', pick.has(x)); }); c.title = x.uz; chips.append(c); });
  p.append(chips);
  const row = el('div','cacts');
  row.append(btn('btn primary', 'Saqlash', () => {
    pick.forEach(x => words.push({ w:x.w, uz:x.uz, ex:x.ex, box:5, due:addDays(30), src:'core', seen:1 }));
    if (pick.size){ LS.set('words', words); emote('proud'); status('', `${pick.size} ta so'z "bilaman" deb belgilandi.`); }
    renderWordsRoom();
  }), btn('btn', 'Bekor qilish', () => renderCourse()));
  p.append(row); box.append(p);
}
function renderPacks(){
  const box0 = $('packs'), boxP = $('patPacks'); box0.innerHTML = ''; if (boxP) boxP.innerHTML = '';
  Object.values(PACKS).forEach(p => {
    const box = p.pat && boxP ? boxP : box0;
    const items = packItems(p), have = items.filter(i => hasWord(i.w)).length, full = have === items.length;
    const b = btn('pack' + (full ? ' added' : ''), '', () => {
      if (full) return;
      /* 8 new words a day, so a big pack doesn't land all at once */
      let n = 0; items.forEach(i => { if (!hasWord(i.w)) words.push(Object.assign({ w:i.w, uz:i.uz, ex:i.ex, box:0, due:addDays(Math.floor(n++ / 8)), src:p.pat ? 'pattern' : 'pack' }, i.trick ? { trick:i.trick } : {})); });
      LS.set('words', words); queue = []; renderWordsRoom(); emote('excited'); feathers(b, 8);
    });
    b.append(el('b', null, p.uz), el('span', null, full ? "Qo'shilgan" : `${items.length} ta ${p.pat ? 'qolip' : "so'z"}${have ? `, ${have} tasi bor` : ''}`));
    box.append(b);
  });
}
function renderWordList(){
  const box = $('wordList'); box.innerHTML = '';
  if (!words.length){ box.append(el('p','empty',"Hali so'z yo'q.")); return; }
  words.slice().reverse().slice(0, 80).forEach(w => {
    const r = el('div','wrow'); const left = el('div'); left.append(el('b', null, w.w), el('small', null, ' — ' + w.uz));
    const lv = el('div','lv'); lv.title = BOXNAME[w.box]; for (let i = 1; i <= 5; i++) lv.append(el('i', w.box >= i ? 'on' : ''));
    r.append(left, lv); box.append(r);
  });
}
function renderBadge(){ const n = due().length; $('dueBadge').hidden = !n; $('dueBadge').textContent = n; }
function renderWordsRoom(){ renderPractice(); renderCourse(); renderPacks(); renderWordList(); renderBadge(); }
document.querySelectorAll('[data-wm]').forEach(b => b.onclick = () => { stopDrill(); wmode = b.dataset.wm; document.querySelectorAll('[data-wm]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderPractice(); });

/* ================= words by voice =================
   "Tinglab yodlash": a little audio lesson, hands-free: word, meaning in Uzbek, example, word again.
   "Gapirib yodlash": you repeat new words aloud; for words you know, you hear the meaning and say the English word. */
let drill = null;
function drillList(){
  const d = due().sort((a,b) => a.box - b.box);
  const learning = words.filter(w => !d.includes(w) && w.box < 4).sort((a,b) => (a.seen||0) - (b.seen||0));
  return d.concat(learning).slice(0, 15);
}
function stopDrill(){ if (!drill) return; drill.stop = true; drill = null; stopSpeaking(); stopListen(); const c = document.querySelector('.vcard'); if (c) c.classList.remove('playing'); }
function renderVoice(box){
  const list = drillList();
  const p = el('div','vpanel'), card = el('div','vcard');
  const bars = el('div','bars'); for (let i = 0; i < 5; i++) bars.append(el('i'));
  const step = el('div','step', list.length ? `${list.length} ta so'z tayyor` : "Hamma so'zlar yodlangan!");
  const big = el('div','big', list[0] ? list[0].w : '🎉'), uz = el('div','uz', list[0] ? list[0].uz : ''), ex = el('div','ex', list[0] ? list[0].ex : '');
  card.append(bars, step, big, uz, ex); p.append(card);
  const bl = el('button','vbtn listen'); bl.append(el('span',null,'Tinglab yodlash'), el('small',null,"Yo'lda, quloqchinda"));
  const bs = el('button','vbtn speak'); bs.append(el('span',null,'Gapirib yodlash'), el('small',null, micBlocked ? 'Mikrofon kerak' : 'Aytib, eslab qolish'));
  bl.disabled = bs.disabled = !list.length; if (micBlocked) bs.disabled = true;
  const stopB = btn('btn','To\'xtatish', () => { stopDrill(); renderPractice(); }); stopB.hidden = true;
  const btns = el('div','vbtns'); btns.append(bl, bs); p.append(btns, stopB);
  if (micBlocked) p.append(el('p','note',"Gapirib yodlash uchun mikrofon kerak: Telegram versiyasida yoki faylni Chrome'da oching. Tinglab yodlash hamma joyda ishlaydi."));
  box.append(p);
  const ui = { card, step, big, uz, ex, show(w, hideEn, label){ step.textContent = label; big.textContent = w.w; uz.textContent = w.uz; ex.textContent = w.ex || ''; big.classList.toggle('hide', !!hideEn); ex.classList.toggle('hide', !!hideEn); } };
  bl.onclick = () => { btns.hidden = true; stopB.hidden = false; runListen(list, ui); };
  bs.onclick = () => { btns.hidden = true; stopB.hidden = false; runSpeak(list, ui); };
}
const listenOnce = () => new Promise(res => { if (!startListen({ silent:true, onDone: t => res(t), onEmpty: () => res('') })) res(''); });
async function runListen(list, ui){
  stopDrill(); const me = drill = {}; ui.card.classList.add('playing'); setEmo('happy');
  for (let round = 0; round < 2 && !me.stop; round++){
    for (let i = 0; i < list.length && !me.stop; i++){
      const w = list[i]; ui.show(w, false, `${i+1} / ${list.length}${round ? ' · takror' : ''}`);
      await speakParts([{ text:w.w, rate:0.75, pause:500 }, { text:w.uz, uz:true, force:true, pause:400 }, { text:w.ex || w.w, rate:0.85, pause:500 }, { text:w.w, rate:0.75 }]);
      if (me.stop) return;
      w.heard = (w.heard||0) + 1; LS.set('words', words); activity(); await sleep(900);
    }
  }
  if (!me.stop){ ui.card.classList.remove('playing'); ui.step.textContent = 'Tugadi! Endi gapirib yodlab ko\'ring'; emote('proud'); drill = null; }
}
async function runSpeak(list, ui){
  stopDrill(); const me = drill = {}; ui.card.classList.add('playing'); let okCount = 0;
  for (let i = 0; i < list.length && !me.stop; i++){
    const w = list[i], fresh = w.box === 0;
    if (fresh){
      ui.show(w, false, `${i+1} / ${list.length} · Takrorlang`);
      await speakParts([{ text:w.uz, uz:true, force:true, pause:300 }, { text:'Say it with me: ' + w.w, rate:0.8 }]); if (me.stop) return;
      let t = await listenOnce(); if (me.stop) return;
      let ok = norm(t).includes(norm(w.w));
      if (!ok){ setEmo('gentle'); await speakParts([{ text:'Once more, slowly: ' + w.w, rate:0.7 }]); if (me.stop) return; t = await listenOnce(); if (me.stop) return; ok = norm(t).includes(norm(w.w)); }
      if (ok){ okCount++; emote('excited'); await speakParts([{ text: ['Perfect!','Great job!','Yes, exactly!','Lovely!'][i % 4] + ' ' + (w.ex || ''), rate:0.9 }]); }
      else { setEmo('gentle'); await speakParts([{ text:"No problem, we'll practise it again soon.", rate:0.9 }]); }
      grade(w, ok);
    } else {
      ui.show(w, true, `${i+1} / ${list.length} · Inglizchasi qanday?`);
      await speakParts([{ text:w.uz, uz:true, force:true, pause:200 }, { text:'How do you say it in English?', rate:0.9 }]); if (me.stop) return;
      const t = await listenOnce(); if (me.stop) return;
      const ok = norm(t).includes(norm(w.w));
      ui.show(w, false, ok ? "To'g'ri!" : "Mana bunday:");
      if (ok){ okCount++; emote('proud'); await speakParts([{ text:'Yes! ' + w.w + '. ' + (w.ex || ''), rate:0.9 }]); }
      else { setEmo('gentle'); await speakParts([{ text:'It\'s ' + w.w + '. ' + w.w + '.', rate:0.75 }]); }
      grade(w, ok);
    }
    renderBadge(); await sleep(400);
  }
  if (!me.stop){ ui.card.classList.remove('playing'); ui.step.textContent = `Tugadi! ${okCount} / ${list.length} to'g'ri`; if (okCount) feathers(ui.card, 14); drill = null; renderWordList(); }
}

/* ================= my mistakes =================
   Every mistake from the chats lands here with its explanation. "Gapirib mashq": you hear the Uzbek
   explanation, say the correct sentence, and it is checked. Two correct answers = learned. */
const words_of = t => norm(t).split(' ').filter(Boolean);
function similar(a, b){ const A = words_of(a), B = words_of(b); if (!B.length) return 0; let hit = 0; B.forEach(w => { if (A.includes(w)) hit++; }); return hit / Math.max(B.length, A.length * 0.8); }
function lastDays(n){ const out = [], d = new Date(); for (let i = 0; i < n; i++){ out.push(dkey(d)); d.setDate(d.getDate() - 1); } return out; }
function growthCard(){
  const c = el('div','growth'); c.append(el('div','k','Mening o\'sishim'));
  const w7 = P.wpm(flu, lastDays(7)), w14 = P.wpm(flu, lastDays(14).slice(7)), td = flu[today()];
  const row = el('div','gstats');
  const stat = (big, small) => { const s = el('div','gs'); s.append(el('b', null, big), el('span', null, small)); row.append(s); };
  stat(w7 ? String(w7) : '—', "so'z/daqiqa" + (w7 && w14 ? (w7 > w14 ? ` ⬆️ +${w7 - w14}` : '') : ''));
  stat(td ? String(td.w) : '0', "bugun aytilgan so'z");
  stat(String(mistakes.filter(m => (m.ok||0) >= 2).length), "o'zlashtirilgan xato");
  c.append(row);
  if (td && td.f >= 3) c.append(el('p','note', `Bugun ${td.f} marta "um/eee" dedingiz. To'xtab qolsangiz, "Let me think..." yoki "Well..." deb ko'ring.`));
  const weak = P.weakOf(mistakes).slice(0, 4);
  if (weak.length){
    const max = weak[0].n; const wl = el('div','weak'); wl.append(el('div','wk', 'Zaif tomonlar (hamroh suhbatda shularni ko\'proq mashq qildiradi)'));
    weak.forEach(x => { const r = el('div','wrow2'); const bar = el('i'); bar.style.width = Math.round(x.n / max * 100) + '%'; const tr = el('span','bar'); tr.append(bar); r.append(el('span','wl', x.label), tr, el('b', null, String(x.n))); wl.append(r); });
    c.append(wl);
  } else if (!w7) c.append(el('p','note', "Ovoz bilan gaplashganingiz sari bu yerda tezligingiz va zaif tomonlaringiz ko'rinadi."));
  return c;
}
function renderMistakes(box){
  const p = el('div','mpanel');
  if (!mistakes.length){
    const d = el('div','done'); d.append(el('div','big','Hozircha xato yo\'q'), el('div','note',"Gaplashganingizda qilgan xatolaringiz tushuntirishi bilan shu yerga yig'iladi. Keyin ularni ovoz chiqarib mashq qilasiz."));
    d.append(btn('btn primary',"Gaplashishga o'tish", () => setRoom('talk'))); box.append(d); return;
  }
  p.append(growthCard());
  const todo = mistakes.filter(m => (m.ok||0) < 2).slice(-10).reverse();
  const run = btn('btn primary', todo.length ? `Gapirib mashq qilish · ${todo.length} ta` : "Hammasi o'zlashtirilgan!", () => runMistakes(todo, p));
  run.disabled = !todo.length || micBlocked;
  p.append(run);
  if (micBlocked) p.append(el('p','note',"Gapirib mashq qilish uchun mikrofon kerak (Telegram yoki Chrome)."));
  const live = el('div','mlive'); live.hidden = true; p.append(live);
  const list = el('div','mlist');
  mistakes.slice().reverse().slice(0, 60).forEach(m => {
    const it = el('div','mitem' + ((m.ok||0) >= 2 ? ' learned' : ''));
    if (m.said) it.append(el('div','said', m.said));
    const b = el('div','better'); b.append(el('span', null, m.better), btn('hear','Eshitish', () => speakParts([{ text:m.better, rate:0.85 }]))); it.append(b);
    if (m.en) it.append(el('div','ten', m.en));
    if (m.uz) it.append(el('div','tuz', m.uz));
    const meta = el('div','mmeta'); meta.append(el('span', null, (m.n > 1 ? `${m.n} marta takrorlangan · ` : '') + ((m.ok||0) >= 2 ? "o'zlashtirildi" : `${m.ok||0}/2 to'g'ri`)));
    meta.append(btn('chipbtn',"O'chirish", () => { mistakes = mistakes.filter(x => x !== m); LS.set('mistakes', mistakes); renderPractice(); }));
    it.append(meta); list.append(it);
  });
  p.append(list); box.append(p);
}
async function runMistakes(list, panel){
  stopDrill(); const me = drill = {}; const live = panel.querySelector('.mlive'); live.hidden = false; panel.querySelector('.btn.primary').hidden = true;
  const stopB = btn('btn','To\'xtatish', () => { stopDrill(); renderPractice(); }); panel.insertBefore(stopB, live);
  let good = 0;
  for (let i = 0; i < list.length && !me.stop; i++){
    const m = list[i]; live.innerHTML = '';
    live.append(el('div','step', `${i+1} / ${list.length} · To'g'ri shaklini ayting`));
    if (m.said) live.append(el('div','said', m.said));
    if (m.uz) live.append(el('div','tuz', m.uz));
    const ans = el('div','better'); ans.textContent = '…'; live.append(ans);
    await speakParts([{ text:m.uz || 'Fix this sentence.', uz:true, force:true, pause:200 }, { text:'Say it correctly.', rate:0.9 }]); if (me.stop) return;
    let t = await listenOnce(); if (me.stop) return;
    let ok = similar(t, m.better) >= 0.75;
    if (!ok){
      ans.textContent = m.better; setEmo('gentle');
      await speakParts([{ text:m.better, rate:0.75, pause:200 }, { text:'Again, please.', rate:0.9 }]); if (me.stop) return;
      t = await listenOnce(); if (me.stop) return; ok = similar(t, m.better) >= 0.75;
    }
    ans.textContent = m.better; live.append(el('div', ok ? 'res ok' : 'res', ok ? "To'g'ri! " + (t ? '“' + t + '”' : '') : 'Siz: “' + (t || '…') + '”'));
    if (ok){ good++; m.ok = (m.ok||0) + 1; emote('proud'); await speakParts([{ text:'Perfect!', pause:300 }]); }
    else { m.ok = 0; setEmo('gentle'); await sleep(900); }
    LS.set('mistakes', mistakes); activity(); await sleep(400);
  }
  if (!me.stop){ drill = null; renderPractice(); status('', `Xatolar mashqi: ${good} / ${list.length} to'g'ri`); }
}

/* ================= companion picker ================= */
function openChar(){ LS.set('charSeen', true); renderCharSheet(); $('charSheet').classList.add('open'); }
function applyChar(newFriend){
  paintChar(); saveSettings(); CH.paint($('avatarSvg'), settings.char, true);
  if (newFriend){ stopListen(); stopSpeaking(); startTalk(true); } else setEmo('excited');
  feathers(q, 6);
}
function renderCharSheet(){
  const pick = $('charPick'); pick.innerHTML = '';
  Object.entries(CH.CHARS).forEach(([id, c]) => {
    const b = el('button','cp'); b.type = 'button'; b.setAttribute('aria-pressed', settings.char.id === id);
    const sv = document.createElementNS('http://www.w3.org/2000/svg','svg'); sv.setAttribute('viewBox','-10 0 260 240');
    CH.paint(sv, { id, acc: settings.char.id === id ? settings.char.acc : 'none', color: settings.char.id === id ? settings.char.color : '' }, true);
    b.append(sv, el('span', null, c.name), el('small', null, c.uz));
    b.onclick = () => { if (settings.char.id === id) return; settings.char = { id, color:'', acc:settings.char.acc, name:settings.char.name }; applyChar(true); renderCharSheet(); };
    pick.append(b);
  });
  const sw = $('swatches'); sw.innerHTML = '';
  const curColor = settings.char.color || charDef().color;
  [charDef().color].concat(CH.COLORS.filter(c => c !== charDef().color)).forEach(c => {
    const b = el('button','sw'); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', c); b.setAttribute('aria-pressed', c === curColor);
    b.onclick = () => { settings.char.color = c; applyChar(); renderCharSheet(); }; sw.append(b);
  });
  const ac = $('accs'); ac.innerHTML = '';
  Object.entries(CH.ACCS).forEach(([k, a]) => {
    const b = btn('acc-b', a.uz, () => { settings.char.acc = k; applyChar(); renderCharSheet(); }); b.setAttribute('aria-pressed', (settings.char.acc || 'none') === k); ac.append(b);
  });
  $('charName').value = settings.char.name || ''; $('charName').placeholder = charDef().name;
  renderStyles();
}
function renderStyles(){
  const box = $('styles'); box.innerHTML = '';
  Object.entries(P.STYLES).forEach(([k, st]) => {
    const b = el('button','stc'); b.type = 'button'; b.setAttribute('aria-pressed', settings.style === k);
    b.append(el('span','ti', st.ic), el('b', null, st.uz), el('small', null, st.d));
    b.onclick = () => applyStyle(k); box.append(b);
  });
}
const STYLE_EMO = { jiddiy:'thinking', faylasuf:'thinking', romantik:'love', gamxor:'gentle', hazilkash:'laughing', uyatchan:'gentle', ustoz:'thinking', ishbilarmon:'neutral' };
function applyStyle(k){
  if (!P.pick(P.STYLES, k) || settings.style === k) return;
  settings.style = k; saveSettings(); renderStyles();
  if (busy) return;
  stopListen(); stopSpeaking();
  const r = { emotion: STYLE_EMO[k] || 'excited', reply: P.STYLES[k].hi, praise_uz: P.STYLES[k].ic + ' ' + P.STYLES[k].uz + ' uslub yoqildi' };
  turns.push({ role:'assistant', content: JSON.stringify({ emotion:r.emotion, reply:r.reply }) }); saveChat();
  qMsg(r); emote(r.emotion); speakParts([{ text:r.reply }]);
}
$('charName').addEventListener('change', e => { setName(e.target.value, false); e.target.value = settings.char.name; });
$('openChar').onclick = openChar;
$('closeChar').onclick = () => $('charSheet').classList.remove('open');
$('hearChar').onclick = () => speakParts([{ text: settings.style === 'samimiy' ? `Hi! I'm ${cname()}. Let's practise English together!` : styleDef().hi }]);
CH.paint($('avatarSvg'), settings.char, true);

/* ================= rooms, settings ================= */
function setRoom(r){
  room = r; stopListen(); stopDrill();
  document.querySelectorAll('.nav button').forEach(b => b.setAttribute('aria-selected', b.dataset.room === r));
  $('room-talk').hidden = r !== 'talk'; $('room-words').hidden = r !== 'words'; $('room-drill').hidden = r !== 'drill';
  if (r === 'drill'){ stopSpeaking(); renderDrill(); return; }
  if (r === 'words'){ stopSpeaking(); queue = []; renderWordsRoom(); }
  else { status('', micBlocked ? 'Javob yozing' : 'Tugmani bosing va gapiring'); renderTargets(); }
}
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => setRoom(b.dataset.room));
function openSheet(){ renderDays(); renderTestCard(); $('sheet').classList.add('open'); }
$('openSettings').onclick = openSheet; $('streakPill').onclick = openSheet;
$('closeSheet').onclick = () => $('sheet').classList.remove('open');
function renderDays(){
  const box = $('days'); box.innerHTML = '';
  for (let i = 13; i >= 0; i--){ const k = addDays(-i), m = mins(k); const c = el('i', (m >= +settings.goal ? 'l2' : m >= 1 ? 'l1' : '') + (i === 0 ? ' today' : '')); c.title = `${k}: ${m} daqiqa`; box.append(c); }
  const total = Math.floor(Object.values(days).reduce((a,b) => a+b, 0)/60000);
  $('statLine').textContent = `${streak()} kun ketma-ket · bugun ${mins(today())} daqiqa · jami ${total} daqiqa · ${words.filter(w => w.box >= 4).length} ta so'z yodlangan`;
}
$('level').value = settings.level; $('goal').value = String(settings.goal); $('rate').value = String(settings.rate);
$('corrections').value = settings.corrections; $('calm').checked = settings.calm === false;
$('ansLang').value = settings.lang; $('gender').value = settings.gender; $('about').value = settings.about || '';
$('about').onchange = e => { settings.about = e.target.value.trim().slice(0, 200); saveSettings(); };
$('ansLang').onchange = e => { settings.lang = e.target.value === 'en' ? 'en' : 'both'; saveSettings(); };
$('gender').onchange = e => { settings.gender = ['female','male'].includes(e.target.value) ? e.target.value : 'auto'; ttsCache.clear(); saveSettings(); speakParts([{ text: settings.gender === 'male' ? "Hi! This is how I sound now." : settings.gender === 'female' ? "Hi! This is my new voice." : "Hi! This is my own voice." }]); };
$('corrections').onchange = e => { settings.corrections = e.target.value === 'main' ? 'main' : 'all'; saveSettings(); };
$('calm').onchange = e => { settings.calm = !e.target.checked; saveSettings(); applyCalm(); };
$('apikey').value = settings.key; $('oakey').value = settings.oakey; $('readUz').checked = settings.readUz;
$('level').onchange = e => { settings.level = e.target.value; saveSettings(); };
$('goal').onchange = e => { settings.goal = +e.target.value; saveSettings(); renderGoal(); renderDays(); };
$('rate').onchange = e => { settings.rate = +e.target.value; saveSettings(); };
$('voice').onchange = e => { settings.voice = e.target.value; saveSettings(); };
$('apikey').onchange = e => { settings.key = e.target.value.trim(); saveSettings(); };
$('oakey').onchange = e => { settings.oakey = e.target.value.trim(); saveSettings(); };
$('readUz').onchange = e => { settings.readUz = e.target.checked; saveSettings(); };
$('newChat').onclick = () => { $('sheet').classList.remove('open'); stopListen(); stopSpeaking(); topic = 'free'; settings.topic = 'free'; saveSettings(); renderTopics(); startTalk(true); };
let armed = false;
$('resetAll').onclick = e => {
  if (!armed){ armed = true; e.target.textContent = "Ha, hammasini o'chir"; setTimeout(() => { armed = false; e.target.textContent = "Barcha natijalarni o'chirish"; }, 4000); return; }
  words = []; days = {}; chat = []; LS.set('words', []); LS.set('chat', []); LS.set('lastDay', null); LS.set('days', {});
  armed = false; e.target.textContent = "Barcha natijalarni o'chirish"; renderGoal(); renderDays(); renderWordsRoom(); startTalk(true);
};

/* reminder hours (Telegram): the bot writes first, with a question to answer by voice */
const REMIND_HOURS = [8, 9, 12, 15, 18, 20, 22];
let remindHours = [];
function renderRemind(h){
  remindHours = h; $('remindBox').hidden = false; const box = $('remindHours'); box.innerHTML = '';
  REMIND_HOURS.forEach(x => { const b = btn('acc-b', String(x).padStart(2,'0') + ':00', () => {
    const next = remindHours.includes(x) ? remindHours.filter(y => y !== x) : remindHours.concat(x).sort((a,b) => a-b);
    api('/api/remind', { hours:next }).then(r => r.json()).then(j => renderRemind(j.hours || next)).catch(e => status('', errText(e)));
  }); b.setAttribute('aria-pressed', remindHours.includes(x)); box.append(b); });
}

/* ================= Telegram Mini App ================= */
function applyTgTheme(){
  document.documentElement.setAttribute('data-theme', TG.colorScheme === 'dark' ? 'dark' : 'light');
  const c = TG.colorScheme === 'dark' ? '#0E2142' : '#DDF1F7';
  try { TG.setHeaderColor(c); TG.setBackgroundColor(c); TG.setBottomBarColor && TG.setBottomBarColor(TG.colorScheme === 'dark' ? '#081530' : '#F4F9FC'); } catch(e){}
}
async function initTelegram(){
  TG.ready(); TG.expand(); try { TG.disableVerticalSwipes && TG.disableVerticalSwipes(); } catch(e){}
  applyTgTheme(); TG.onEvent('themeChanged', applyTgTheme);
  $('keyBox').hidden = true;
  const back = TG.BackButton;
  const SHEETS = ['testSheet','askSheet','topicSheet','charSheet','sheet'];
  const sync = () => (SHEETS.some(id => $(id).classList.contains('open')) || room !== 'talk') ? back.show() : back.hide();
  ['topicSheet','askSheet','testSheet'].forEach(id => new MutationObserver(sync).observe($(id), { attributes:true, attributeFilter:['class'] }));
  new MutationObserver(sync).observe($('charSheet'), { attributes:true, attributeFilter:['class'] });
  new MutationObserver(sync).observe($('sheet'), { attributes:true, attributeFilter:['class'] });
  document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', sync));
  back.onClick(() => { const open = SHEETS.find(id => $(id).classList.contains('open')); if (open) $(open).classList.remove('open'); else setRoom('talk'); sync(); });
  try {
    const r = await api('/api/me'); const j = await r.json(); quota = j.quota; renderQuota(); renderRemind(j.remind || []); serverVoice = j.voice !== false; syncBase = +j.now || Date.now(); synced = true; if (j.admin) initAdmin();
    const s = j.state || {};
    if (s.flu) flu = s.flu; if (Array.isArray(s.tests)) tests = s.tests; if (s.story) story = s.story; if (s.lesson) lesson = s.lesson; if (s.mistakes) mistakes = s.mistakes; if (s.words) words = s.words; if (s.days) days = s.days; if (s.chat) chat = s.chat; if (s.settings){ Object.assign(settings, s.settings); applyCalm(); $('corrections').value = settings.corrections; $('ansLang').value = settings.lang || 'both'; $('about').value = settings.about || ''; $('gender').value = settings.gender || 'auto'; $('calm').checked = settings.calm === false; settings.char = Object.assign({ id:'nur', color:'', acc:'none', name:'' }, settings.char || {}); if (!P.pick(P.STYLES, settings.style)) settings.style = 'samimiy'; if (!P.pick(P.TOPICS, settings.topic)) settings.topic = 'free'; topic = settings.topic; paintChar(); CH.paint($('avatarSvg'), settings.char, true); }
    SYNC_KEYS.forEach(k => { if (s[k] != null) try { localStorage.setItem('qumri_'+k, JSON.stringify(s[k])); } catch(e){} });
    $('level').value = settings.level; $('goal').value = String(settings.goal); $('rate').value = String(settings.rate);
    renderGoal(); renderBadge(); renderTopics(); startTalk(false); setTimeout(testNudge, 1200);
    const start = new URLSearchParams(location.search).get('room') || (TG.initDataUnsafe && TG.initDataUnsafe.start_param);
    if (start === 'words' || start === 'drill'){ setRoom(start); sync(); }
  } catch(e){ status('', errText(e)); }
  window.addEventListener('pagehide', () => { if (syncT){ clearTimeout(syncT); pushState(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && syncT){ clearTimeout(syncT); pushState(); } });
}

/* ================= ask a question (Uzbek or English), answer in both ================= */
function openAsk(){ stopListen(); stopSpeaking(); $('askSheet').classList.add('open'); setTimeout(() => $('askInput').focus(), 250); }
async function askQ(text){
  text = (text || '').trim(); if (!text || busy) return;
  $('askSheet').classList.remove('open'); $('askInput').value = '';
  if (room !== 'talk') setRoom('talk');
  busy = true; stopSpeaking();
  const mine = addMsg('me', text); mine.prepend(el('div','qlabel','Savol'));
  setEmo('thinking'); status('thinking', cname() + " javob tayyorlayapti…"); activity();
  try {
    const r = parseJSON(await ai('ask', { q:text, level:settings.level }), null);
    if (!r || !(r.en || r.uz)) throw new Error('bad');
    const m = el('div','msg q'); const card = explainCard(r); m.append(card);
    const tips = tipsOf(r);
    if (tips.length){ const t = el('div','tip'); t.append(el('div','k','Savolingizdagi xato')); tips.forEach(x => { const row = el('div','trow'); if (x.said) row.append(el('div','said', x.said)); row.append(el('div','better', x.better)); if (x.uz) row.append(el('div','tuz', x.uz)); t.append(row); }); m.append(t); saveMistakes(tips); }
    const added = addWords(r.words, 'ask');
    if (added.length){ added.forEach(w => { const tg = el('div','wordtag'); tg.append(el('span',null,"+ So'z:"), el('b',null,w.w), el('span',null,w.uz)); m.append(tg); }); }
    if (r.say_it){
      const pr = el('div','sayit'); pr.append(el('div','k','Ovoz chiqarib ayting'), el('b', null, r.say_it));
      const res = el('div','res');
      pr.append(btn('btn primary','Aytib ko\'rish', async () => {
        if (micBlocked) return status('', 'Mikrofon kerak');
        await speakParts([{ text:r.say_it, rate:0.85 }]); const t = await listenOnce();
        const ok = similar(t, r.say_it) >= 0.75; res.textContent = ok ? "Zo'r, to'g'ri aytdingiz!" : 'Siz: “' + (t || '…') + '”. Yana urinib ko\'ring.'; res.className = 'res' + (ok ? ' ok' : ''); emote(ok ? 'proud' : 'gentle');
      }), res);
      m.append(pr);
    }
    feed.append(m); $('room-talk').classList.add('chatting'); scrollFeed();
    turns.push({ role:'user', content:text }, { role:'assistant', content: JSON.stringify({ emotion:'happy', reply:(r.en || '').slice(0, 600) }) }); saveChat();
    busy = false; emote('happy'); status('', 'Yana savol bering yoki gaplashishni davom eting');
    speakParts([{ text:r.en || '' }, { text:r.uz || '', uz:true, force:true }]);
  } catch(e){ busy = false; emote('sad'); status('', e.code ? errText(e) : "Javob chiqmadi. Qayta urinib ko'ring."); }
}
$('askBtn').onclick = openAsk;
$('closeAsk').onclick = () => $('askSheet').classList.remove('open');
$('askSend').onclick = () => askQ($('askInput').value);
$('askInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); askQ($('askInput').value); } });
$('askMic').onclick = () => {
  if (micBlocked) return status('', 'Bu yerda mikrofon ishlamaydi, savolni yozing.');
  if (listening) return stopListen();
  $('askMic').classList.add('on');
  startListen({ lang:'auto', silent:true, onDone: t => { $('askMic').classList.remove('on'); $('askInput').value = t; askQ(t); }, onEmpty: () => { $('askMic').classList.remove('on'); status('', "Eshitmadim, yana bir bor ayting yoki yozing."); } });
};

/* ================= chat recap ================= */
async function recap(){
  if (busy) return;
  const n = turns.filter(t => t.role === 'user').length;
  if (n < 2){ status('', "Xulosa uchun avval biroz gaplashing (kamida 2 ta javob)."); emote('gentle'); return; }
  busy = true; stopListen(); stopSpeaking(); setEmo('thinking'); status('thinking', cname() + " suhbatni tahlil qilyapti…");
  try {
    const r = parseJSON(await ai('recap', { level:settings.level, turns:turns.slice(-30) }), null);
    if (!r) throw new Error('bad');
    const c = el('div','recap');
    const stars = Math.max(1, Math.min(5, Math.round(+r.stars || 3)));
    c.append(el('div','k', 'Suhbat xulosasi'), el('div','stars', '★'.repeat(stars) + '☆'.repeat(5 - stars)));
    if (r.summary_uz) c.append(el('p', null, r.summary_uz));
    const list = (title, items, fn) => { items = (Array.isArray(items) ? items : []).slice(0, 3).filter(Boolean); if (!items.length) return; c.append(el('div','rh', title)); const ul = el('ul'); items.forEach(x => ul.append(fn(x))); c.append(ul); };
    list("Zo'r chiqdi", r.good, x => el('li','good', String(x)));
    list("Shunday desangiz yanada yaxshi", r.fix, x => { const li = el('li'); if (x.said) li.append(el('s', null, x.said), document.createTextNode(' → ')); li.append(el('b', null, x.better || '')); if (x.uz) li.append(el('div','tuz', x.uz)); return li; });
    saveMistakes((Array.isArray(r.fix) ? r.fix : []).filter(x => x && x.better).map(x => ({ said:x.said, better:String(x.better), uz:x.uz })));
    const added = addWords(r.words, 'recap');
    list("Keyingi safar uchun so'zlar", r.words, x => { const li = el('li'); li.append(el('b', null, x.w || ''), document.createTextNode(' — ' + (x.uz || ''))); return li; });
    if (added.length) c.append(el('div','note', `${added.length} ta so'z "So'zlar" bo'limiga qo'shildi.`));
    if (r.next_uz) c.append(el('div','next', r.next_uz));
    const m = el('div','msg q'); m.append(c); feed.append(m); scrollFeed();
    busy = false; emote(stars >= 4 ? 'proud' : 'happy'); if (stars >= 4) feathers(c, 10);
    status('', 'Davom etamizmi? Tugmani bosing.');
    speakParts([{ text: r.summary_uz || '', uz:true }, { text: r.next_uz || '', uz:true }]);
  } catch(e){ busy = false; emote('sad'); status('', e.code ? errText(e) : "Xulosa chiqmadi. Qayta urinib ko'ring."); }
}
$('recapBtn').onclick = recap;
$('closeTopics').onclick = () => $('topicSheet').classList.remove('open');

/* ================= Mashq: daily lesson, quick translation, shadowing, listening ================= */
const PAT_ITEMS = (CORE.patterns || []).flatMap(g => g.list.filter(x => x.ex && x.trick).map(x => ({ en:x.ex, uz:x.trick })));
let bank = LS.get('drillBank', []);
const shuffle = a => a.map(x => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
/* sentences for translation: AI-made ones (with today's words) first, then the pattern bank; recently used ones wait */
function pickPairs(n){
  const recent = new Set(LS.get('drillRecent', []));
  const pool = bank.concat(PAT_ITEMS).filter(x => x && x.en && x.uz);
  const fresh = pool.filter(x => !recent.has(x.en)), use = (fresh.length >= n ? fresh : pool);
  const out = shuffle(use.slice(0, 60)).slice(0, n);
  LS.set('drillRecent', [...recent].concat(out.map(x => x.en)).slice(-150));
  return out;
}
let refillAt = 0;
async function refillBank(){
  if (Date.now() - refillAt < 10 * 60000) return; refillAt = Date.now();
  if (bank.filter(x => !LS.get('drillRecent', []).includes(x.en)).length >= 12) return;
  try {
    const r = parseJSON(await ai('sentences', { level:settings.level, about:settings.about || '', words:targetWords(8).map(w => w.w) }), null);
    const items = (r && Array.isArray(r.items) ? r.items : []).filter(x => x && x.en && x.uz && String(x.en).length < 140).map(x => ({ en:String(x.en).trim(), uz:String(x.uz).trim() }));
    if (items.length){ bank = items.concat(bank).slice(0, 200); LS.set('drillBank', bank); }
  } catch(e){ /* the pattern bank is enough */ }
}
/* shadowing sentences: examples of today's words first, then patterns */
function shadowItems(n){
  const ex = targetWords(8).filter(w => w.ex && w.ex.split(' ').length >= 3).map(w => ({ en:w.ex, uz:w.w + ' — ' + w.uz }));
  return ex.concat(shuffle(PAT_ITEMS.slice())).slice(0, n);
}
function markWords(box, res){
  const line = el('div', 'dmark');
  res.words.forEach(x => line.append(el('span', x.ok ? 'ok' : 'miss', x.w), document.createTextNode(' ')));
  box.append(line);
}
/* one spoken try: mic (or typing when there is no mic) -> callback with the text */
function sayBox(box, onText, label){
  const row = el('div', 'drow');
  const mic = btn('btn primary', '🎙 ' + (label || 'Ayting'), () => {
    if (listening){ stopListen(); return; }
    stopSpeaking(); mic.classList.add('on'); mic.textContent = '⏹ Tugatish';
    const ok = startListen({ lang:'en', silent:true, onDone: t => { mic.classList.remove('on'); mic.textContent = '🎙 Yana'; onText(t); }, onEmpty: () => { mic.classList.remove('on'); mic.textContent = '🎙 ' + (label || 'Ayting'); dnote(box, "Eshitmadim. Yana bosing yoki yozing."); } });
    if (!ok){ mic.classList.remove('on'); mic.textContent = '🎙 ' + (label || 'Ayting'); }
  });
  const inp = el('input', 'winput'); inp.placeholder = 'yoki yozing…'; inp.autocomplete = 'off'; inp.setAttribute('autocapitalize', 'off');
  inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()){ onText(inp.value.trim()); inp.value = ''; } };
  if (!micBlocked) row.append(mic);
  row.append(inp);
  box.append(row);
  return row;
}
function dnote(box, t){ let n = box.querySelector('.dnote'); if (!n){ n = el('div', 'dnote'); box.append(n); } n.textContent = t; }
function drillDone(box, title, ok, n, onDone, again){
  box.innerHTML = '';
  const c = el('div', 'dcard done');
  c.append(el('div', 'dbig', ok + '/' + n), el('div', null, title + (ok === n ? ' · ajoyib! 🔥' : ok >= n / 2 ? ' · yaxshi 👍' : " · ertaga yana mashq qilamiz 💪")));
  const row = el('div', 'drow');
  if (onDone) row.append(btn('btn primary', 'Davom etish →', onDone));
  else { if (again) row.append(btn('btn primary', 'Yana', again)); row.append(btn('btn', 'Orqaga', renderDrill)); }
  c.append(row); box.append(c);
  if (ok === n) feathers(c, 10);
}
/* ---- quick translation: Uzbek sentence, say it in English within 5 seconds ---- */
function runTranslate(box, n, onDone){
  const items = pickPairs(n); let i = 0, ok = 0;
  refillBank();
  const step = () => {
    if (i >= items.length) return drillDone(box, 'Tez tarjima', ok, items.length, onDone, () => runTranslate(box, n));
    const it = items[i]; box.innerHTML = '';
    const c = el('div', 'dcard');
    c.append(el('div', 'dstep', `⚡ Tez tarjima · ${i + 1}/${items.length}`), el('div', 'duz', it.uz));
    const bar = el('div', 'dtimer'); bar.append(el('i')); c.append(bar);
    let answered = false;
    const check = t => {
      if (answered) return; answered = true;
      const r = P.compareSpoken(it.en, t); const good = r.score >= 75; if (good) ok++;
      c.querySelectorAll('.drow').forEach(x => x.remove());
      c.append(el('div', 'dsaid', '🗣 ' + t), el('div', good ? 'dres good' : 'dres bad', (good ? "✅ To'g'ri! " : '🔁 ') + r.score + '%'));
      markWords(c, r);
      speakParts([{ text: it.en, rate: 0.95 }]);
      const row = el('div', 'drow'); row.append(btn('btn', '🔊', () => speakParts([{ text: it.en }])), btn('btn primary', i + 1 < items.length ? 'Keyingisi →' : 'Natija', () => { i++; step(); })); c.append(row);
    };
    sayBox(c, check, 'Inglizcha ayting');
    const giveUp = btn('tool', "Bilmayman, ko'rsat", () => check(''));
    c.append(giveUp);
    box.append(c);
    requestAnimationFrame(() => bar.classList.add('run'));
  };
  step();
}
/* ---- shadowing: listen to a sentence, repeat it right away ---- */
function runShadow(box, items, onDone){
  let i = 0, ok = 0;
  const step = () => {
    if (i >= items.length) return drillDone(box, 'Soya mashqi', ok, items.length, onDone, () => runShadow(box, shadowItems(items.length)));
    const it = items[i]; box.innerHTML = '';
    const c = el('div', 'dcard');
    let hide = LS.get('shadowHide', false);
    const txt = el('div', 'den' + (hide ? ' blur' : ''), it.en);
    c.append(el('div', 'dstep', `🦜 Soya mashqi · ${i + 1}/${items.length} · eshiting va xuddi shunday takrorlang`), txt, el('div', 'tquz', it.uz || ''));
    const play = r => speakParts([{ text: it.en, rate: r }]);
    const tools = el('div', 'drow');
    tools.append(btn('btn', '🔊 Eshitish', () => play(settings.rate)), btn('btn', '🐢 Sekin', () => play(0.7)), btn('tool', hide ? "Matnni ko'rsat" : 'Matnsiz (qiyinroq)', e => { hide = !hide; LS.set('shadowHide', hide); txt.classList.toggle('blur', hide); e.target.textContent = hide ? "Matnni ko'rsat" : 'Matnsiz (qiyinroq)'; }));
    c.append(tools);
    let tries = 0;
    sayBox(c, t => {
      tries++; const r = P.compareSpoken(it.en, t);
      c.querySelectorAll('.dmark,.dres,.dsaid,.dnext').forEach(x => x.remove());
      c.append(el('div', 'dsaid', '🗣 ' + t), el('div', r.score >= 85 ? 'dres good' : 'dres bad', (r.score >= 85 ? '✅ Zo\'r! ' : 'Yana bir marta: ') + r.score + '%'));
      markWords(c, r); txt.classList.remove('blur');
      if (r.score >= 85 || tries >= 3){ if (r.score >= 85) ok++; const nx = btn('btn primary dnext', i + 1 < items.length ? 'Keyingisi →' : 'Natija', () => { i++; step(); }); c.append(nx); }
      else play(0.8);
    }, 'Takrorlash');
    box.append(c); play(settings.rate);
  };
  step();
}
/* ---- word step of the lesson: quick 4-option check of due words ---- */
function runWordCheck(box, n, onDone){
  const list = shuffle(due().filter(w => w.uz && w.src !== 'pattern')).slice(0, n);
  if (!list.length) return onDone && onDone();
  let i = 0, ok = 0;
  const pool = words.concat(CORE.list).filter(x => x && x.uz);
  const step = () => {
    if (i >= list.length) return drillDone(box, "So'z takrorlash", ok, list.length, onDone);
    const w = list[i]; box.innerHTML = '';
    const c = el('div', 'dcard quiz');
    c.append(el('div', 'dstep', `📚 So'zlar · ${i + 1}/${list.length}`), el('div', 'qword', w.w));
    setTimeout(() => speakParts([{ text: w.w, rate: 0.85 }]), 200);
    const opts = new Set([w.uz]); for (let k = 0; k < 40 && opts.size < 4; k++) opts.add(pool[Math.floor(Math.random() * pool.length)].uz);
    let done = false;
    shuffle([...opts]).forEach(u => { const b = btn('opt', u, () => {
      if (done) return; done = true; const good = u === w.uz; if (good) ok++;
      b.classList.add(good ? 'right' : 'wrong'); if (!good) c.querySelectorAll('.opt').forEach(x => { if (x.textContent === w.uz) x.classList.add('right'); });
      grade(w, good); speakParts([{ text: w.w + (w.ex ? '. ' + w.ex : ''), rate: 0.9 }]);
      setTimeout(() => { i++; step(); }, good ? 900 : 1700);
    }); c.append(b); });
    box.append(c);
  };
  step();
}
/* ---- listening: a one-minute story (the same one the bot sends in the morning) ---- */
let story = LS.get('story', null);
async function getStory(fresh){
  if (!fresh && story && story.day === today() && story.en) return story;
  const r = parseJSON(await ai('story', { level:settings.level, about:settings.about || '', words:targetWords(5).map(w => w.w), seed: Math.floor(Math.random() * 100) }), null);
  if (!r || !r.en) throw new Error('bad');
  story = { day:today(), title:String(r.title || 'Story').slice(0, 80), en:String(r.en).slice(0, 1500), uz:String(r.uz || '').slice(0, 2000), questions:(Array.isArray(r.questions) ? r.questions : []).slice(0, 3).filter(q => q && q.q).map(q => ({ q:String(q.q).slice(0, 200), uz:String(q.uz || '').slice(0, 200) })), words:(Array.isArray(r.words) ? r.words : []).slice(0, 3) };
  LS.set('story', story); return story;
}
async function runListen(box, onDone, fresh){
  box.innerHTML = ''; const c = el('div', 'dcard'); c.append(el('div', 'dstep', '🎧 Hikoya tayyorlanmoqda…')); box.append(c);
  let s;
  try { s = await getStory(fresh); } catch(e){ c.innerHTML = ''; c.append(el('div', 'dres bad', e.code ? errText(e) : "Hikoya chiqmadi. Qayta urinib ko'ring."), btn('btn primary', 'Qayta', () => runListen(box, onDone, fresh))); return; }
  c.innerHTML = '';
  c.append(el('div', 'dstep', '🎧 Tinglash · avval matnsiz tinglang'), el('div', 'dtitle', s.title));
  const play = r => speakParts([{ text: s.en, rate: r }]);
  const tools = el('div', 'drow'); tools.append(btn('btn primary', '▶ Tinglash', () => play(settings.rate)), btn('btn', '🐢 Sekin', () => play(0.75)), btn('btn', '⏹', stopSpeaking));
  const txt = el('div', 'dstory'); txt.hidden = true; txt.append(el('p', null, s.en), el('p', 'tquz', s.uz));
  const show = btn('tool', "Matnni ko'rsatish", () => { txt.hidden = !txt.hidden; show.textContent = txt.hidden ? "Matnni ko'rsatish" : 'Matnni yashirish'; });
  c.append(tools, show, txt);
  if (s.questions.length){
    c.append(el('div', 'rh', 'Savollar (ovoz bilan javob bering)'));
    const ul = el('ol', 'dqs'); s.questions.forEach(q => { const li = el('li'); li.append(el('b', null, q.q), el('div', 'tquz', q.uz)); ul.append(li); }); c.append(ul);
    c.append(btn('btn primary', "🗣 Suhbatda javob berish", () => {
      const q1 = s.questions[0];
      turns.push({ role:'assistant', content: JSON.stringify({ emotion:'happy', reply: q1.q, story: s.en.slice(0, 1100), note: 'Ask the other story questions one by one after this: ' + s.questions.slice(1).map(x => x.q).join(' | ') }) }); saveChat();
      setRoom('talk'); qMsg({ emotion:'happy', reply:q1.q, reply_uz:q1.uz, praise_uz:'🎧 «' + s.title + '» hikoyasi bo\'yicha savol' }); speakTurn({ reply:q1.q }, true);
      lessonMark('listen');
    }));
  }
  const added = addWords(s.words, 'story'); if (added.length) c.append(el('div', 'note', `${added.length} ta yangi so'z daftaringizga qo'shildi.`));
  if (onDone) c.append(btn('btn', 'Davom etish →', onDone));
  play(settings.rate);
}
/* ---- the daily 10-minute lesson ---- */
const LESSON = [
  { id:'words', ic:'📚', t:"So'zlar", d:'2 daq' },
  { id:'shadow', ic:'🦜', t:'Soya mashqi', d:'2 daq' },
  { id:'translate', ic:'⚡', t:'Tez tarjima', d:'2 daq' },
  { id:'talk', ic:'🗣', t:'Suhbat (3 ta javob)', d:'3 daq' },
  { id:'mistakes', ic:'🔁', t:'Xatolarim', d:'1 daq' }
];
let lesson = LS.get('lesson', null);
function lessonNow(){ if (!lesson || lesson.day !== today()) lesson = { day:today(), done:[], talk:0 }; return lesson; }
function lessonMark(id){ const l = lessonNow(); if (!l.done.includes(id)){ l.done.push(id); LS.set('lesson', l); lessonStreakTick(); } }
function lessonFull(l){ return LESSON.every(s => l.done.includes(s.id)); }
function lessonStreakTick(){
  const l = lessonNow(); if (!lessonFull(l)) return;
  const hist = LS.get('lessonDays', []); if (!hist.includes(l.day)){ hist.push(l.day); LS.set('lessonDays', hist.slice(-400)); }
}
function lessonStreak(){ const h = new Set(LS.get('lessonDays', [])); let n = 0, d = 0; if (!h.has(addDays(0))) d = -1; while (h.has(addDays(d))){ n++; d--; } return n; }
/* counted from the talk room: 3 replies in a day = the talk step */
function lessonTalkTick(){ const l = lessonNow(); l.talk = (l.talk || 0) + 1; LS.set('lesson', l); if (l.talk >= 3 && !l.done.includes('talk')){ lessonMark('talk'); addMsg('q', "✅ Bugungi darsning suhbat qismi bajarildi! «Mashq» bo'limida davom eting.").classList.add('sys'); } }
function runLesson(box){
  const l = lessonNow(), next = LESSON.find(s => !l.done.includes(s.id));
  const go = () => runLesson(box);
  if (!next){ renderDrill(); return; }
  const fin = () => { lessonMark(next.id); go(); };
  if (next.id === 'words'){ if (!due().length){ lessonMark('words'); return go(); } return runWordCheck(box, 6, fin); }
  if (next.id === 'shadow') return runShadow(box, shadowItems(3), fin);
  if (next.id === 'translate') return runTranslate(box, 3, fin);
  if (next.id === 'talk'){
    box.innerHTML = ''; const c = el('div', 'dcard');
    const tw = targetWords(3).map(w => w.w);
    c.append(el('div', 'dstep', '🗣 Suhbat · 3 ta javob bering'), el('p', null, "Hamroh bilan 3 marta gaplashing." + (tw.length ? ' Shu so\'zlarni ishlatishga harakat qiling: ' + tw.join(', ') + '.' : '')));
    const row = el('div', 'drow'); row.append(btn('btn primary', 'Suhbatga o\'tish', () => setRoom('talk')), btn('tool', "O'tkazib yuborish", fin)); c.append(row); box.append(c); return;
  }
  if (next.id === 'mistakes'){
    const ms = mistakes.filter(m => (m.ok || 0) < 2 && m.better && m.better.split(' ').length >= 2).slice(-2).map(m => ({ en:m.better, uz:(m.said ? '❌ ' + m.said + ' · ' : '') + (m.uz || ''), m }));
    if (!ms.length){ lessonMark('mistakes'); return go(); }
    return runShadow(box, ms, () => { ms.forEach(x => { x.m.ok = (x.m.ok || 0) + 1; }); LS.set('mistakes', mistakes); fin(); });
  }
}
function renderDrill(){
  if (room !== 'drill') return;
  const box = $('drill'); box.innerHTML = ''; stopSpeaking();
  const l = lessonNow(), full = lessonFull(l), st = lessonStreak();
  $('dSub').textContent = st ? `🔥 ${st} kun ketma-ket dars` : "Har kuni 10 daqiqa: eng tez yo'l";
  const c = el('div', 'dcard lesson');
  c.append(el('div', 'dtitle', '📅 Bugungi dars · 10 daqiqa'));
  const steps = el('div', 'lsteps');
  LESSON.forEach(s => { const x = el('div', 'lstep' + (l.done.includes(s.id) ? ' on' : '')); x.append(el('span', null, l.done.includes(s.id) ? '✓' : s.ic), el('small', null, s.t)); steps.append(x); });
  c.append(steps);
  c.append(full ? el('div', 'dres good', "✅ Bugungi dars tugadi! Ertaga yana. Xohlasangiz pastdagi mashqlarni qiling.") : btn('btn primary big', l.done.length ? 'Davom ettirish' : 'Boshlash', () => runLesson(box)));
  box.append(c);
  const cards = [
    ['⚡', 'Tez tarjima', "O'zbekcha gapni 5 soniyada inglizcha ayting. Gapni tarjima qilmasdan, to'g'ridan-to'g'ri aytishga o'rgatadi.", () => runTranslate(box, 8)],
    ['🦜', 'Soya mashqi', 'Eshiting va darhol takrorlang. Talaffuz va ravonlik uchun eng tez usul.', () => runShadow(box, shadowItems(6))],
    ['🎧', 'Tinglash', "1 daqiqalik hikoya va 2 ta savol. Bot ham har kuni ertalab yuboradi.", () => runListen(box)]
  ];
  cards.forEach(([ic, t, d, fn]) => { const b = btn('dpick', '', fn); b.append(el('span', 'dic', ic), el('b', null, t), el('small', null, d)); box.append(b); });
  refillBank();
}

/* ================= monthly speaking test ================= */
const TEST_SETS = [
  [["Tell me about yourself: your work, your city and what you do in your free time.", "O'zingiz haqingizda gapiring: ishingiz, shahringiz, bo'sh vaqtingiz."],
   ["What did you do last weekend? Tell me the whole story.", "O'tgan dam olish kunlari nima qildingiz? Batafsil gapiring."],
   ["Describe a technical problem you solved at work. What did you do step by step?", "Ishda hal qilgan texnik muammoingizni tasvirlang. Qadam-baqadam nima qildingiz?"],
   ["What are your plans for the next five years, and why?", "Keyingi besh yilga rejalaringiz qanday va nega?"],
   ["You are at the airport and your bag is lost. Talk to the airline staff.", "Aeroportdasiz, sumkangiz yo'qoldi. Aviakompaniya xodimi bilan gaplashing."]],
  [["Introduce yourself to a new foreign colleague.", "Yangi xorijlik hamkasbingizga o'zingizni tanishtiring."],
   ["Tell me about the best trip you have ever had.", "Eng yaxshi sayohatingiz haqida gapirib bering."],
   ["Explain your job to someone who knows nothing about engineering.", "Ishingizni muhandislikdan bexabar odamga tushuntiring."],
   ["Is it better to work in a big company or a small one? Give your reasons.", "Katta kompaniyada ishlash yaxshimi yoki kichigidami? Sabablarini ayting."],
   ["You booked a hotel room but they say there is no booking. What do you say?", "Mehmonxonada xona band qilgansiz, ular bron yo'q deyishyapti. Nima deysiz?"]],
  [["What does a normal working day look like for you?", "Oddiy ish kuningiz qanday o'tadi?"],
   ["Tell me about a mistake you made and what you learned from it.", "Qilgan bir xatoingiz va undan nima o'rganganingiz haqida gapiring."],
   ["Describe a project you are proud of. What was your role?", "Faxrlanadigan loyihangizni tasvirlang. Sizning rolingiz nima edi?"],
   ["How will technology change our lives in the next ten years?", "Texnologiya keyingi o'n yilda hayotimizni qanday o'zgartiradi?"],
   ["You need to ask your manager for a day off next week. Ask politely.", "Keyingi haftaga rahbaringizdan bir kunlik javob so'rashingiz kerak. Xushmuomala so'rang."]]
];
let T = null; /* running test: { set, i, answers:[{q,a,sec}] } */
const monthAgo = () => addDays(-30);
const testDue = () => !tests.length || tests[tests.length - 1].day < monthAgo();
function renderTestCard(){
  const box = $('testCard'); if (!box) return; box.innerHTML = '';
  const last = tests[tests.length - 1], prev = tests[tests.length - 2];
  if (last){
    const r = el('div', 'tres');
    r.append(el('div', 'tlv', last.level), el('div', null, `${last.day} · ${last.score}/100` + (last.wpm ? ` · ${last.wpm} so'z/daqiqa` : '')));
    if (prev){ const d = last.score - prev.score; r.append(el('div', d >= 0 ? 'good' : 'bad', (d >= 0 ? '⬆️ +' : '⬇️ ') + d + ` (o'tgan safar ${prev.level}, ${prev.score})`)); }
    box.append(r);
    if (tests.length > 1){ const h = el('div', 'thist'); tests.slice(-6).forEach(x => { const c = el('i'); c.style.height = Math.max(6, x.score * 0.5) + 'px'; c.title = x.day + ': ' + x.level + ' ' + x.score; h.append(c); }); box.append(h); }
  }
  box.append(el('p', 'note', testDue() ? "5 ta savolga ovoz bilan javob berasiz (har biriga 1 daqiqacha). Darajangiz (A1–C2), ballar va shu oy nimaga e'tibor berish kerakligi chiqadi. Har oy takrorlab, o'sishingizni ko'rasiz." : `Keyingi test: ${addDaysFrom(last.day, 30)} dan keyin. Hozir ham topshirishingiz mumkin.`));
  box.append(btn('btn primary', testDue() ? 'Testni boshlash' : 'Yana topshirish', startTest));
}
function addDaysFrom(day, n){ const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
function startTest(){
  $('sheet').classList.remove('open'); stopListen(); stopSpeaking();
  T = { set: TEST_SETS[(new Date().getMonth()) % TEST_SETS.length], i: 0, answers: [] };
  $('testSheet').classList.add('open'); testStep();
}
function testStep(){
  const box = $('testBody'); box.innerHTML = '';
  const [en, uz] = T.set[T.i];
  T.cur = T.answers[T.i] || { q: en, a: '', sec: 0 };
  box.append(el('div', 'tstep', `Savol ${T.i + 1}/${T.set.length}`), el('div', 'tq', en), el('div', 'tquz', uz));
  const ans = el('textarea'); ans.rows = 4; ans.maxLength = 1500; ans.placeholder = "Mikrofonni bosib gapiring (yoki yozing). To'xtab qolsangiz, yana bosing: davomi qo'shiladi."; ans.value = T.cur.a;
  ans.oninput = () => { T.cur.a = ans.value; };
  const mic = btn('btn primary', '🎙 Javob berish', () => {
    if (listening){ stopListen(); return; }
    mic.classList.add('on'); mic.textContent = '⏹ Tugatish';
    const ok = startListen({ lang:'en', silent:true,
      onDone: (t, c, d) => { mic.classList.remove('on'); mic.textContent = '🎙 Davom ettirish'; T.cur.a = (T.cur.a ? T.cur.a + ' ' : '') + t; T.cur.sec += +d || Math.max(2, t.split(/\s+/).length / 2); ans.value = T.cur.a; },
      onEmpty: () => { mic.classList.remove('on'); mic.textContent = '🎙 Javob berish'; status('', "Eshitmadim, yana bosing."); } });
    if (!ok){ mic.classList.remove('on'); mic.textContent = '🎙 Javob berish'; }
  });
  const row = el('div', 'trow2');
  row.append(btn('btn', '🔊', () => speakParts([{ text: en }])), mic, btn('btn', T.i + 1 < T.set.length ? 'Keyingisi →' : 'Baholash ✓', () => {
    T.cur.a = ans.value.trim();
    if (T.cur.a.split(/\s+/).filter(Boolean).length < 3){ status('', "Kamida bir-ikki gap ayting."); ans.focus(); return; }
    if (!T.cur.sec) T.cur.sec = Math.max(5, T.cur.a.split(/\s+/).length / 1.6);
    T.answers[T.i] = T.cur; T.i++;
    if (T.i < T.set.length) testStep(); else gradeTest();
  }));
  box.append(ans, row);
  speakParts([{ text: en }]);
}
async function gradeTest(){
  const box = $('testBody'); box.innerHTML = ''; box.append(el('div', 'tstep', 'Baholanmoqda… (20 soniyagacha)'));
  const nw = T.answers.reduce((a, x) => a + x.a.split(/\s+/).filter(Boolean).length, 0), secs = T.answers.reduce((a, x) => a + (x.sec || 0), 0);
  const wpm = secs >= 20 ? Math.round(nw / (secs / 60)) : 0;
  try {
    const r = parseJSON(await ai('test', { level: settings.level, answers: T.answers }), null);
    if (!r || !r.level) throw new Error('bad');
    const n = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
    const res = { day: today(), at: Date.now(), level: String(r.level).toUpperCase().slice(0, 2), score: n(r.score, 0, 100), f: n(r.fluency, 0, 10), g: n(r.grammar, 0, 10), v: n(r.vocab, 0, 10), c: n(r.coherence, 0, 10), wpm, words: nw };
    const prev = tests[tests.length - 1];
    tests = tests.concat([res]).slice(-24); LS.set('tests', tests);
    saveMistakes((Array.isArray(r.fix) ? r.fix : []).filter(x => x && x.better).map(x => ({ said:x.said, better:String(x.better), uz:x.uz })));
    box.innerHTML = '';
    const c = el('div', 'recap');
    c.append(el('div', 'k', 'Gapirish testi natijasi'), el('div', 'tbig', res.level + ' · ' + res.score + '/100'));
    if (prev) c.append(el('div', res.score >= prev.score ? 'good' : 'bad', (res.score >= prev.score ? '⬆️ +' : '⬇️ ') + (res.score - prev.score) + ` ball (${prev.day}: ${prev.level}, ${prev.score})`));
    const bars = el('div', 'tbars');
    [['Ravonlik', res.f], ['Grammatika', res.g], ["So'z boyligi", res.v], ['Bog\'lanish', res.c]].forEach(([k, v]) => { const b = el('div', 'tbar'); b.append(el('span', null, k), el('i'), el('b', null, v + '/10')); b.querySelector('i').style.setProperty('--w', v * 10 + '%'); bars.append(b); });
    c.append(bars);
    if (wpm) c.append(el('div', 'note', `Gapirish tezligi: ${wpm} so'z/daqiqa · jami ${nw} so'z`));
    if (r.summary_uz) c.append(el('p', null, r.summary_uz));
    const list = (title, items, fn) => { items = (Array.isArray(items) ? items : []).slice(0, 4).filter(Boolean); if (!items.length) return; c.append(el('div','rh', title)); const ul = el('ul'); items.forEach(x => ul.append(fn(x))); c.append(ul); };
    list("Kuchli tomonlar", r.strengths, x => el('li', 'good', String(x)));
    list("Shu oy ustida ishlang", r.improve, x => el('li', null, String(x)));
    list("Xatolar (daftarga qo'shildi)", r.fix, x => { const li = el('li'); if (x.said) li.append(el('s', null, x.said), document.createTextNode(' → ')); li.append(el('b', null, x.better || '')); if (x.uz) li.append(el('div','tuz', x.uz)); return li; });
    if (r.next_uz) c.append(el('div', 'next', '🗓 ' + r.next_uz));
    box.append(c, btn('btn primary', 'Yopish', () => $('testSheet').classList.remove('open')));
    emote(prev && res.score > prev.score ? 'proud' : 'happy'); if (prev && res.score > prev.score) feathers(c, 12);
    speakParts([{ text: r.summary_uz || '', uz:true }]);
    T = null;
  } catch(e){
    box.innerHTML = ''; box.append(el('p', 'bad', e.code ? errText(e) : "Baholab bo'lmadi. Javoblaringiz saqlangan, qayta urinib ko'ring."), btn('btn primary', 'Qayta baholash', gradeTest));
  }
}
$('closeTest').onclick = () => { stopListen(); $('testSheet').classList.remove('open'); };
/* once a month, a gentle note in the chat */
function testNudge(){
  if (!testDue() || Object.keys(days).length < 3 || LS.get('testNudge', '') === today()) return;
  LS.set('testNudge', today());
  const m = addMsg('q', "📈 Oylik gapirish testi vaqti keldi! 5 ta savol, 5 daqiqa. Darajangizni va o'tgan oyga nisbatan o'sishingizni ko'rsataman.");
  m.append(btn('btn primary', 'Testni boshlash', startTest));
}

/* ================= start ================= */
renderTopics(); renderGoal(); renderBadge(); startTalk(false); if (!TG) setTimeout(testNudge, 1500);
if (inViewer) $('viewerNote').hidden = false;
if (TG) initTelegram();
/* ================= owner panel: AI keys (server checks ADMIN_IDS again) ================= */
const KWHY = { bad_key_format: "Kalit ko'rinishi noto'g'ri (bo'sh joy yoki o'zbekcha harf bo'lmasin)", bad_key_id: "Noma'lum kalit", forbidden: "Ruxsat yo'q", rate_limited: "Juda tez bosildi, bir daqiqadan keyin urinib ko'ring" };
const escH = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let lastCheck = {};
function renderKeys(keys){
  const box = $('keyRows'); box.innerHTML = '';
  keys.forEach((k) => {
    const c = lastCheck[k.label];
    const st = !k.masked ? '' : c ? c.status : k.resting ? 'rest' : '';
    const row = document.createElement('div'); row.className = 'krow';
    row.innerHTML = '<div class="kh"><span class="kdot ' + (st === 'ok' ? 'ok' : st === 'fail' ? 'fail' : st === 'rest' ? 'rest' : '') + '"></span>' + escH(k.label)
      + ' <small>' + (k.masked ? escH(k.masked) + (k.source === 'app' ? ' · ilovada kiritilgan' : ' · server sozlamasidan') : "kalit yo'q") + (k.paid ? ' · pullik' : ' · bepul') + '</small></div>'
      + (k.note ? '<div class="note">' + escH(k.note) + '</div>' : '')
      + (c && c.status === 'fail' ? '<div class="note" style="color:var(--rose)">' + escH(c.why || 'ishlamadi') + '</div>' : '')
      + '<div class="kin"><input type="password" autocomplete="off" placeholder="Yangi kalit (' + escH(k.site) + ')"><button class="btn" data-a="save">Saqlash</button>'
      + (k.source === 'app' ? '<button class="btn" data-a="del">O\'chirish</button>' : '') + '</div>';
    const inp = row.querySelector('input');
    row.querySelectorAll('button').forEach((b) => b.onclick = async () => {
      const value = b.dataset.a === 'del' ? '' : inp.value.trim();
      if (b.dataset.a === 'save' && !value) { inp.focus(); return; }
      if (b.dataset.a === 'del' && !confirm(k.label + " kalitini o'chiraymi? Server sozlamasidagi kalit (bo'lsa) qayta ishlaydi.")) return;
      b.disabled = true;
      try { const r = await api('/api/admin/keys', { id: k.id, value }); const j = await r.json(); inp.value = ''; delete lastCheck[k.label]; renderKeys(j.keys); $('checkOut').hidden = false; $('checkOut').innerHTML = '<span class="good">✓ ' + escH(k.label) + (value ? ' kaliti saqlandi. Ishlashini bilish uchun "Hammasini tekshirish" ni bosing.' : " kaliti o'chirildi.") + '</span>'; }
      catch (e) { alert(KWHY[e.code] || ('Xato: ' + e.code)); }
      finally { b.disabled = false; }
    });
    box.appendChild(row);
  });
}
async function initAdmin(){
  $('adminBox').hidden = false;
  try { const r = await api('/api/admin/keys'); renderKeys((await r.json()).keys); } catch (e) { $('keyRows').textContent = 'Kalitlarni olib bo\'lmadi: ' + e.code; }
  $('checkAll').onclick = async () => {
    const b = $('checkAll'), out = $('checkOut'); b.disabled = true; b.textContent = 'Tekshirilmoqda… (30 soniyagacha)'; out.hidden = true;
    try {
      const j = await (await api('/api/admin/check', {})).json();
      lastCheck = {}; (j.ai || []).forEach((a) => { lastCheck[a.label] = a; });
      const lines = (j.ai || []).filter((a) => a.status !== 'nokey').map((a) => a.status === 'ok'
        ? '<div class="good">✓ ' + escH(a.label) + ' — ' + escH(a.sec) + ' s' + (a.model ? ' · ' + escH(a.model) : '') + '</div>'
        : '<div class="bad">✗ ' + escH(a.label) + ' — ' + escH(a.why || 'ishlamadi') + '</div>');
      if (!lines.length) lines.push('<div class="bad">Hech qanday AI kaliti yo\'q. Kamida bittasini kiriting (Groq bepul).</div>');
      const v = j.voice || {};
      lines.push(v.stt ? '<div class="good">✓ Ovozni matnga aylantirish: ' + escH(v.stt) + '</div>' : '<div class="bad">✗ Ovozni tanish uchun Groq yoki OpenAI kaliti kerak</div>');
      lines.push(v.tts ? '<div class="good">✓ Jonli ovoz: ' + escH(v.tts) + '</div>' : '<div class="bad">✗ Jonli ovoz ishlamadi' + (v.groqWhy ? ' · Groq: ' + escH(v.groqWhy) : '') + (v.geminiWhy ? ' · Gemini: ' + escH(v.geminiWhy) : '') + '</div>');
      if ((j.order || []).length) lines.push('<div class="note">Navbat (eng tezi birinchi): ' + j.order.map(escH).join(' → ') + '</div>');
      out.innerHTML = lines.join(''); out.hidden = false;
      renderKeys(j.keys || []);
      serverVoice = !!v.tts;
    } catch (e) { out.innerHTML = '<div class="bad">' + escH(KWHY[e.code] || ('Tekshirib bo\'lmadi: ' + e.code)) + '</div>'; out.hidden = false; }
    finally { b.disabled = false; b.textContent = 'Hammasini tekshirish'; }
  };
}

})();
