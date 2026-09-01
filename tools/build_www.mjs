/* Статикалық файлдарды www/ ішіне көшіру.
   Bundler жоқ — Capacitor webDir ретінде түбір папканы қабылдамайды
   (node_modules мен android/ бірге көшіп кетер еді), сондықтан таза көшірме. */
import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'www');

/* WebView-ге керек нәрсенің бәрі, артық ештеңе жоқ */
const ITEMS = [
  'index.html', 'sw.js', 'manifest.json',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable.png',
  'js', 'models', 'audio',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let n = 0;
for (const item of ITEMS) {
  const src = join(ROOT, item);
  if (!existsSync(src)) {
    console.warn(`  ескерту: ${item} табылмады, өткізіп жіберілді`);
    continue;
  }
  await cp(src, join(OUT, item), { recursive: true });
  n++;
}
console.log(`www/ дайын — ${n} нысан көшірілді (${(await readdir(OUT)).join(', ')})`);
