/* =============================================================================
   PCM -> mp3, ШЫҢЫН ТЕКСЕРІП

   render_alarm_sounds.mjs жазған шикі PCM-ді mp3-ке кодтайды және НӘТИЖЕНІ
   кері декодтап тексереді: mp3 кодеры өткір толқындарда шыңды асырып жібереді
   («ringing»), сол себепті телефонда дыбыс кесіліп шығуы мүмкін. Асып кетсе —
   күшейтуді азайтып қайта кодтаймыз.

   Бөлек скрипт, себебі node-web-audio-api бір процесте startRendering() мен
   decodeAudioData() қатар шақырылса құлайды.

   Шығысы: android/app/src/main/res/raw/alarm_<id>.mp3
   ============================================================================= */
import { OfflineAudioContext } from 'node-web-audio-api';
import lamejs from '@breezystack/lamejs';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PCM_DIR = join(ROOT, 'build', 'pcm');
const OUT_DIR = join(ROOT, 'android', 'app', 'src', 'main', 'res', 'raw');

/* Оятқыш — бәрі бірдей қатты естілуі керек. Декодталған шың осыдан аспауы тиіс. */
const TARGET_PEAK = 0.89;
const MAX_PASS = 6;

const meta = JSON.parse(await readFile(join(PCM_DIR, 'meta.json'), 'utf8'));
const { sampleRate: SR, kbps: KBPS, voices } = meta;

function encode(pcm, gain) {
  const i16 = new Int16Array(pcm.length);
  let clipped = 0;
  for (let i = 0; i < pcm.length; i++) {
    let v = pcm[i] * gain;
    if (v > 1 || v < -1) { clipped++; v = v > 0 ? 1 : -1; }
    i16[i] = v < 0 ? v * 0x8000 : v * 0x7FFF;
  }
  const enc = new lamejs.Mp3Encoder(1, SR, KBPS);
  const out = [];
  const BLOCK = 1152;
  for (let i = 0; i < i16.length; i += BLOCK) {
    const chunk = enc.encodeBuffer(i16.subarray(i, i + BLOCK));
    if (chunk.length) out.push(Buffer.from(chunk));
  }
  const tail = enc.flush();
  if (tail.length) out.push(Buffer.from(tail));
  return { mp3: Buffer.concat(out), clipped };
}

async function realPeak(mp3, ctx) {
  const ab = mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.length);
  const d = (await ctx.decodeAudioData(ab)).getChannelData(0);
  let p = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; }
  return p;
}

await mkdir(OUT_DIR, { recursive: true });
const ctx = new OfflineAudioContext(1, 128, SR);       // тек decodeAudioData үшін
let bad = 0;

for (const type of voices) {
  const buf = await readFile(join(PCM_DIR, type + '.f32'));
  const pcm = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  let raw = 0;
  for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > raw) raw = a; }

  let gain = raw > 0 ? TARGET_PEAK / raw : 1;
  let res = null, pass = 0;
  while (pass++ < MAX_PASS) {
    res = encode(pcm, gain);
    res.peak = await realPeak(res.mp3, ctx);
    if (res.peak <= TARGET_PEAK * 1.02) break;
    gain *= TARGET_PEAK / res.peak;                    // асып кетті — түзетеміз
  }
  const name = 'alarm_' + type + '.mp3';
  await writeFile(join(OUT_DIR, name), res.mp3);
  const over = res.peak > 1;
  if (over) bad++;
  console.log(name.padEnd(22) + String(Math.round(res.mp3.length / 1024)).padStart(4) + ' КБ' +
    '  x' + gain.toFixed(2) + '  mp3 шыңы=' + res.peak.toFixed(2) +
    '  (' + pass + ' өту)' + (res.clipped ? '  ! кесілген=' + res.clipped : '') +
    (over ? '  !! 1.0-ден асты' : ''));
}

await rm(PCM_DIR, { recursive: true, force: true });   // уақытша PCM керек емес
console.log('\n' + voices.length + ' файл -> ' + relative(ROOT, OUT_DIR) +
  (bad ? '\nЕСКЕРТУ: ' + bad + ' файлдың шыңы 1.0-ден асады — дыбыс кесілуі мүмкін.' : ''));
