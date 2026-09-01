/* =============================================================================
   ОЯТҚЫШ ДЫБЫСТАРЫН ФАЙЛҒА РЕНДЕРЛЕУ

   Android-та хабарлама арнасының (channel) дыбысы файл болуы керек — Web Audio
   генерациясы жарамайды, себебі қосымша жабық тұрғанда JS жүрмейді.
   Сондықтан index.html ішіндегі синтездің ДӘЛ сол алгоритмін OfflineAudioContext
   арқылы 30 секундқа рендерлеп, mp3-ке айналдырамыз.

   Шығысы: android/app/src/main/res/raw/alarm_<id>.mp3

   «random» дауысы үшін бөлек файл жоқ — ол күнге қарай пулдан біреуін таңдайды,
   сондықтан native.js сол күнгі дауыстың арнасын қолданады.
   ============================================================================= */
import { OfflineAudioContext } from 'node-web-audio-api';
import lamejs from '@breezystack/lamejs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'android', 'app', 'src', 'main', 'res', 'raw');

const SR = 44100;          // дискретизация
const DUR = 30;            // секунд — хабарлама дыбысының ұзақтығы
const KBPS = 96;           // mp3 битрейті (моно)

/* index.html ішіндегі ALARM тұрақтылары — өзгерсе, екеуін де жаңарт */
const ALARM = {
  ATTACK: 0.005,
  JIT_F: 0.03,
  JIT_R: 0.05,
  STAGES: [[0, 0.35], [15, 0.6], [40, 0.85], [90, 1]],
  DAWN_FROM: 0.2, DAWN_TO: 0.7, DAWN_SEC: 60,
};
const DAWN_NOTES = [523, 659, 784, 1047];
const VOICES = ['classic', 'siren', 'industrial', 'drip', 'dawn'];

/* Тұрақты нәтиже үшін тұқымдалған кездейсоқтық (Math.random емес):
   бір кодтан әрқашан бірдей файл шығады. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(1);
const jitF = (hz) => hz * (1 + (rnd() * 2 - 1) * ALARM.JIT_F);
const jitR = (ms) => Math.round(ms * (1 + (rnd() * 2 - 1) * ALARM.JIT_R));

/* ---------- index.html-дегі tone() ---------- */
function tone(ctx, o) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const end = o.at + o.dur / 1000;
  osc.type = o.wave;
  osc.frequency.setValueAtTime(o.hz, o.at);
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.linearRampToValueAtTime(o.vol, o.at + ALARM.ATTACK);
  g.gain.setValueAtTime(o.vol, end);
  g.gain.linearRampToValueAtTime(0.0001, end + 0.02);
  osc.connect(g).connect(o.dest);
  osc.start(o.at);
  osc.stop(end + 0.04);
}
function sweep(ctx, dest, lo, hi, t, dur) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(lo, t);
  osc.frequency.linearRampToValueAtTime(hi, t + dur / 2);
  osc.frequency.linearRampToValueAtTime(lo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.3, t + ALARM.ATTACK);
  g.gain.setValueAtTime(0.3, t + dur - 0.03);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dest);
  osc.start(t); osc.stop(t + dur + 0.02);
}
function distortionCurve(amount) {
  const n = 256, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * 2 / n - 1;
    curve[i] = (1 + amount) * x / (1 + amount * Math.abs(x));
  }
  return curve;
}

/* ---------- Бір цикл: келесіге дейінгі мс қайтарады ---------- */
function voiceClassic(ctx, dest, at) {
  const on = jitR(120), off = jitR(80), gap = jitR(300);
  let t = at;
  for (let i = 0; i < 4; i++) {
    tone(ctx, { wave: 'square', hz: jitF(i % 2 ? 3200 : 2800), at: t, dur: on, vol: 0.5, dest });
    t += (on + off) / 1000;
  }
  return (on + off) * 4 + gap;
}
function voiceSiren(ctx, dest, at) {
  const dur = jitR(1400) / 1000;
  const lo = jitF(800), hi = jitF(2400);
  [0, 3].forEach((shift) => sweep(ctx, dest, lo + shift, hi + shift, at, dur));
  return Math.round(dur * 1000);
}
function voiceIndustrial(ctx, dest, at) {
  const on = jitR(90), off = jitR(60);
  let t = at;
  for (let i = 0; i < 6; i++) {
    tone(ctx, { wave: 'square', hz: jitF(440), at: t, dur: on, vol: 0.36, dest });
    tone(ctx, { wave: 'sawtooth', hz: jitF(1760), at: t, dur: on, vol: 0.26, dest });
    t += (on + off) / 1000;
  }
  return (on + off) * 6;
}
/* Тамшының аралығы уақыт өте қысқарады (index.html: dripGap) */
function voiceDrip(ctx, dest, at, elapsed) {
  tone(ctx, { wave: 'triangle', hz: jitF(1200), at, dur: 60, vol: 0.5, dest });
  const k = Math.min(elapsed, 90) / 90;
  const min = Math.round(400 - 200 * k);
  const max = Math.round(900 - 640 * k);
  return min + Math.floor(rnd() * Math.max(1, max - min));
}
function voiceDawn(ctx, dest, at) {
  let t = at;
  DAWN_NOTES.forEach((hz) => {
    tone(ctx, { wave: 'sine', hz: jitF(hz), at: t, dur: 250, vol: 0.5, dest });
    t += 0.25;
  });
  return jitR(1000) + 400;
}
const CYCLE = {
  classic: voiceClassic, siren: voiceSiren, industrial: voiceIndustrial,
  drip: voiceDrip, dawn: voiceDawn,
};

/* ---------- Өңдеу тізбегі (index.html: buildChain) ---------- */
function buildChain(ctx, master, type) {
  if (type === 'classic') {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1500;
    f.connect(master);
    return f;
  }
  if (type === 'industrial') {
    const ws = ctx.createWaveShaper();
    ws.curve = distortionCurve(28); ws.oversample = '2x';
    ws.connect(master);
    return ws;
  }
  if (type === 'dawn') {
    const input = ctx.createGain();
    const delay = ctx.createDelay(0.5);
    const fb = ctx.createGain();
    delay.delayTime.value = 0.18;
    fb.gain.value = 0.3;
    input.connect(master);
    input.connect(delay);
    delay.connect(fb); fb.connect(delay);
    delay.connect(master);
    return input;
  }
  return master;
}
/* Деңгей — index.html: AlarmVoice.level(), peak = 1 */
function level(type, elapsed) {
  if (type === 'dawn') {
    const k = Math.min(elapsed, ALARM.DAWN_SEC) / ALARM.DAWN_SEC;
    return ALARM.DAWN_FROM + (ALARM.DAWN_TO - ALARM.DAWN_FROM) * k;
  }
  let v = ALARM.STAGES[0][1];
  ALARM.STAGES.forEach((s) => { if (elapsed >= s[0]) v = s[1]; });
  return v;
}

async function render(type) {
  rnd = mulberry32(0x0F17DA1 + type.length * 7919);   // әр дауыс — өз тұқымы
  const ctx = new OfflineAudioContext(1, SR * DUR, SR);
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, 0);
  master.connect(ctx.destination);
  const chain = buildChain(ctx, master, type);

  /* Ескерту: мұнда setTargetAtTime қолданбаймыз — node-web-audio-api
     қатарынан келген бірнеше setTarget оқиғасын дұрыс есептемейді
     (мән 1.0-де қалып қояды). linearRamp дәл сол қисықты береді. */
  let at = 0;
  while (at < DUR) {
    master.gain.linearRampToValueAtTime(level(type, at), at + 0.05);
    at += CYCLE[type](ctx, chain, at, at) / 1000;
  }
  const buf = await ctx.startRendering();
  return buf.getChannelData(0);
}

/* Шикі PCM-ді build/pcm ішіне жазамыз. Кодтау мен тексеру — БӨЛЕК процесте
   (tools/encode_alarm_sounds.mjs), себебі node-web-audio-api бір процесте
   startRendering() мен decodeAudioData() қатар шақырылса құлайды (segfault). */
const PCM_DIR = join(ROOT, 'build', 'pcm');
await mkdir(PCM_DIR, { recursive: true });

for (const type of VOICES) {
  const pcm = await render(type);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const file = join(PCM_DIR, type + '.f32');
  await writeFile(file, Buffer.from(new Float32Array(pcm).buffer));   // көшірме: native буфер тікелей жазылмайды
  console.log(('  ' + type).padEnd(16) + (pcm.length / SR).toFixed(1) + ' сек  шың=' +
    peak.toFixed(2));
}
await writeFile(join(PCM_DIR, 'meta.json'),
  JSON.stringify({ sampleRate: SR, duration: DUR, kbps: KBPS, voices: VOICES }, null, 2));
console.log('\nPCM дайын -> ' + relative(ROOT, PCM_DIR) + '  (келесі қадам: encode)');
