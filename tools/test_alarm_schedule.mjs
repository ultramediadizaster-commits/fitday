/* =============================================================================
   js/native.js — ОЯТҚЫШТЫ ЖОСПАРЛАУ ЛОГИКАСЫНЫҢ ТЕСТІ

   Эмуляторсыз тексереді: Capacitor көпірінің орнына жалған плагиндер қойылады,
   native.js солармен жүгіріп, қандай хабарламалар жоспарланғанын жазып алады.

   node tools/test_alarm_schedule.mjs
   ============================================================================= */
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = await readFile(join(ROOT, 'js', 'native.js'), 'utf8');

let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? '  OK   ' : '  ҚАТЕ ') + name + (cond || extra === undefined ? '' : '  -> ' + extra));
  if (!cond) fails++;
}

/* ---------- Жалған орта ---------- */
function makeEnv(alarm, now) {
  const calls = { scheduled: [], cancelled: [], channels: [], listeners: {} };

  const LocalNotifications = {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    getPending: async () => ({ notifications: [] }),
    cancel: async (o) => { calls.cancelled.push(o); },
    schedule: async (o) => { calls.scheduled.push(o); },
    getDeliveredNotifications: async () => ({ notifications: [] }),
    addListener: (n, f) => { calls.listeners[n] = f; },
  };
  const AlarmChannel = {
    create: async (o) => { calls.channels.push(o); return { created: o.voices.length }; },
    canScheduleExact: async () => ({ granted: true }),
  };
  const el = () => ({ classList: { contains: () => false, remove() {}, add() {} } });
  const sandbox = {
    console,
    setTimeout, clearTimeout, Promise, Date, Math, String, Number, JSON, Array, Object,
    S: { alarm },
    toast: () => {},
    document: { getElementById: el, querySelector: () => null, addEventListener() {} },
  };
  sandbox.window = sandbox;
  sandbox.window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { LocalNotifications, AlarmChannel, StatusBar: null, App: null, SplashScreen: null },
  };
  /* Уақытты бекітеміз — тест күнге тәуелді болмауы керек */
  const RealDate = Date;
  sandbox.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  };
  const ctx = createContext(sandbox);
  runInContext(src, ctx, { filename: 'js/native.js' });
  return { ctx, calls, Native: sandbox.Native };
}

/* ---------- 1) Дүйсенбі–жұма, 07:00 ---------- */
console.log('\n1) Дүйсенбі–жұма 07:00, дауыс = classic');
{
  const now = new RealDateSafe('2026-09-01T10:00:00').getTime();   // сейсенбі, түстен кейін
  const { calls, Native } = makeEnv(
    { time: '07:00', days: [1, 2, 3, 4, 5], on: true, math: true, sound: 'classic' }, now);

  await Native.prepare();
  await Native.syncAlarm();
  await new Promise((r) => setTimeout(r, 600));       // syncAlarm ішіндегі кідіріс

  const batch = calls.scheduled[0];
  const n = batch ? batch.notifications : [];
  check('хабарлама жоспарланды', n.length === 60, n.length);
  check('арналар жасалды (5 дауыс)',
    calls.channels.length === 1 && calls.channels[0].voices.length === 5);
  check('діріл ырғағы берілді', Array.isArray(calls.channels[0].vibration));

  const first = n[0];
  check('allowWhileIdle қосулы', first.schedule.allowWhileIdle === true);
  check('арна = fitday_alarm_classic_v1', first.channelId === 'fitday_alarm_classic_v1',
    first.channelId);
  check('дыбыс файлы', first.sound === 'alarm_classic.mp3', first.sound);
  check('шағын белгі', first.smallIcon === 'ic_stat_fitday');
  check('extra.fitday = alarm', first.extra && first.extra.fitday === 'alarm');

  const t0 = new RealDateSafe(first.schedule.at).getTime();
  const when = new RealDateSafe(t0);
  check('алғашқы ояту 07:00-де',
    when.getHours() === 7 && when.getMinutes() === 0, when.toString());
  check('алғашқы ояту болашақта', t0 > now);
  check('алғашқы ояту — 2 қыркүйек (сәрсенбі)', when.getDate() === 2, when.getDate());

  /* Тізбек: 30 секунд сайын */
  const t1 = new RealDateSafe(n[1].schedule.at).getTime();
  check('тізбек қадамы 30 сек', t1 - t0 === 30000, (t1 - t0) / 1000 + ' сек');

  /* id диапазоны бірегей */
  const ids = new Set(n.map((x) => x.id));
  check('id-лер бірегей', ids.size === n.length);
  check('id диапазонда (41000+)', Math.min(...ids) >= 41000 && Math.max(...ids) < 41060);

  /* Демалыс күндері жоқ */
  const weekend = n.filter((x) => {
    const d = new RealDateSafe(x.schedule.at).getDay();
    return d === 0 || d === 6;
  });
  check('сенбі-жексенбіге жоспарланбаған', weekend.length === 0, weekend.length);
}

/* ---------- 2) Оятқыш өшірулі ---------- */
console.log('\n2) Оятқыш өшірулі');
{
  const now = new RealDateSafe('2026-09-01T10:00:00').getTime();
  const { calls, Native } = makeEnv(
    { time: '07:00', days: [1, 2, 3, 4, 5], on: false, math: true, sound: 'classic' }, now);
  await Native.prepare();
  await Native.syncAlarm();
  await new Promise((r) => setTimeout(r, 600));
  check('ештеңе жоспарланбады', calls.scheduled.length === 0, calls.scheduled.length);
}

/* ---------- 3) «Кездейсоқ» дауыс — күнге қарай арна ---------- */
console.log('\n3) Дауыс = random');
{
  const now = new RealDateSafe('2026-09-01T10:00:00').getTime();
  const { calls, Native } = makeEnv(
    { time: '06:30', days: [0, 1, 2, 3, 4, 5, 6], on: true, math: false, sound: 'random' }, now);
  await Native.prepare();
  await Native.syncAlarm();
  await new Promise((r) => setTimeout(r, 600));

  const n = calls.scheduled[0].notifications;
  const pool = ['classic', 'siren', 'industrial', 'drip'];
  const chans = [...new Set(n.map((x) => x.channelId))];
  check('барлық арна пулдан алынған',
    chans.every((c) => pool.some((v) => c === 'fitday_alarm_' + v + '_v1')), chans.join(','));
  check('әр күнге бір арна (тізбек ішінде бірдей)',
    n[0].channelId === n[1].channelId && n[0].channelId === n[5].channelId);
  check('дыбыс арнаға сай',
    n[0].sound === n[0].channelId.replace('fitday_', '').replace('_v1', '') + '.mp3',
    n[0].sound + ' vs ' + n[0].channelId);

  const w = new RealDateSafe(n[0].schedule.at);
  check('уақыт 06:30', w.getHours() === 6 && w.getMinutes() === 30, w.toString());
}

console.log(fails ? '\n' + fails + ' ТЕКСЕРУ ҚҰЛАДЫ' : '\nБарлық тексеру өтті.');
process.exit(fails ? 1 : 0);

/* Sandbox ішіндегі Date-пен шатаспас үшін нақты Date-тің қауіпсіз атауы */
function RealDateSafe(v) { return v === undefined ? new Date() : new Date(v); }
