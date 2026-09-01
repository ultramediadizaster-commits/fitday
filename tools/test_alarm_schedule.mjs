/* =============================================================================
   js/native.js — JS ЖАҒЫНЫҢ ТЕСТІ

   Жоспарлаудың өзі енді нативте (AlarmManager.setAlarmClock), оны Node тексере
   алмайды — ол үшін бөлек JUnit тесті бар: android/app/src/test/.../AlarmStoreTest
   (gradlew testDebugUnitTest).

   Мұнда JS жағы тексеріледі: қосымшаның күйі нативке ДҰРЫС аударыла ма
   (уақыт, күндер, дауыс), соғу белгісі оқылғанда оятқыш беті ашыла ма.

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
  console.log((cond ? '  OK   ' : '  ҚАТЕ ') + name +
    (cond || extra === undefined ? '' : '  -> ' + extra));
  if (!cond) fails++;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Жалған орта ---------- */
function makeEnv(alarm, opts = {}) {
  const calls = { setAlarm: [], stopRinging: 0, listeners: {}, confirms: [], opened: [] };
  const ring = {
    id: 'ov-ring', shown: false,
    classList: {
      contains: (c) => c === 'show' && ring.shown,
      add(c) { if (c === 'show') ring.shown = true; },
      remove(c) { if (c === 'show') ring.shown = false; },
    },
  };

  const AlarmChannel = {
    checkPermissions: async () => ({ notifications: 'granted' }),
    requestPermissions: async () => ({ notifications: 'granted' }),
    setAlarm: async (o) => {
      calls.setAlarm.push(o);
      return { scheduled: !!o.enabled, nextTrigger: 1, nextLabel: '2026-09-02 07:00' };
    },
    cancelAlarm: async () => {},
    stopRinging: async () => { calls.stopRinging++; },
    consumePendingRing: async () => opts.pending
      ? { pending: true, stamp: opts.pending, ringing: true }
      : { pending: false, stamp: '', ringing: false },
    status: async () => ({
      enabled: !!alarm.on,
      nextLabel: '2026-09-02 07:00',
      exactAllowed: opts.exactAllowed !== false,
      batteryUnrestricted: opts.battery !== false,
      manufacturer: opts.manufacturer || 'Google',
    }),
    openExactAlarmSettings: async () => { calls.opened.push('exact'); },
    requestBatteryUnrestricted: async () => { calls.opened.push('battery'); },
    openAppSettings: async () => { calls.opened.push('app'); },
  };

  const sandbox = {
    console: { log() {}, error() {} },
    setTimeout, clearTimeout, Promise, Date, Math, String, Number, JSON, Array, Object,
    S: { alarm, settings: {} },
    toast: () => {},
    saveState: () => {},
    fireAlarm: () => { ring.shown = true; calls.fired = true; },
    Sound: { ready: () => true },
    document: {
      getElementById: (id) => (id === 'ov-ring' ? ring : null),
      querySelector: () => null,
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  sandbox.window.confirm = (msg) => { calls.confirms.push(msg); return false; };
  sandbox.window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { AlarmChannel, StatusBar: null, App: null, SplashScreen: null, KeepAwake: null },
  };
  const ctx = createContext(sandbox);
  runInContext(src, ctx, { filename: 'js/native.js' });
  return { calls, ring, Native: sandbox.Native, S: sandbox.S };
}

/* ---------- 1) Күй нативке дұрыс аударыла ма ---------- */
console.log('\n1) Дүйсенбі–жұма 07:00, дауыс = classic');
{
  const { calls, Native } = makeEnv(
    { time: '07:00', days: [1, 2, 3, 4, 5], on: true, math: true, sound: 'classic', vibro: true });
  await Native.syncAlarm();
  await wait(600);

  const p = calls.setAlarm[0];
  check('setAlarm шақырылды', !!p);
  check('enabled = true', p.enabled === true);
  check('сағат = 7', p.hour === 7, p.hour);
  check('минут = 0', p.minute === 0, p.minute);
  check('күндер = "1,2,3,4,5"', p.days === '1,2,3,4,5', p.days);
  check('дауыс = classic', p.voice === 'classic', p.voice);
  check('math = true', p.math === true);
  check('vibro = true', p.vibro === true);
  check('келесі соғу белгісі оқылды', Native.nextLabel === '2026-09-02 07:00', Native.nextLabel);
}

/* ---------- 2) Уақыттың нөлі мен түн ортасы ---------- */
console.log('\n2) 00:05, тек жексенбі');
{
  const { calls, Native } = makeEnv(
    { time: '00:05', days: [0], on: true, math: false, sound: 'random', vibro: false });
  await Native.syncAlarm();
  await wait(600);
  const p = calls.setAlarm[0];
  check('сағат = 0', p.hour === 0, p.hour);
  check('минут = 5', p.minute === 5, p.minute);
  check('күндер = "0"', p.days === '0', p.days);
  check('дауыс = random (нативте шешіледі)', p.voice === 'random', p.voice);
  check('math = false', p.math === false);
  check('vibro = false', p.vibro === false);
}

/* ---------- 3) Оятқыш өшірулі ---------- */
console.log('\n3) Оятқыш өшірулі');
{
  const { calls, Native } = makeEnv(
    { time: '07:00', days: [1, 2, 3], on: false, math: true, sound: 'classic', vibro: true });
  await Native.syncAlarm();
  await wait(600);
  check('setAlarm бәрібір шақырылады (нативте өшіріледі)', calls.setAlarm.length === 1);
  check('enabled = false', calls.setAlarm[0].enabled === false);
}

/* ---------- 4) Соғу белгісі: бет ашылады ---------- */
console.log('\n4) Нативте оятқыш соққан — бет ашылуы керек');
{
  const { calls, ring, Native, S } = makeEnv(
    { time: '07:00', days: [1], on: true, math: true, sound: 'classic', vibro: true },
    { pending: '2026-09-02 07:00' });
  Native.init();
  await wait(700);
  check('оятқыш беті ашылды', ring.shown === true);
  check('fireAlarm шақырылды', calls.fired === true);
  check('lastFire жазылды', S.alarm.lastFire === '2026-09-02 07:00', S.alarm.lastFire);
}

/* ---------- 5) Өшіргенде дыбыс тоқтайды ---------- */
console.log('\n5) stopRinging');
{
  const { calls, Native } = makeEnv(
    { time: '07:00', days: [1], on: true, math: true, sound: 'classic', vibro: true });
  await Native.stopRinging();
  check('нативке stopRinging жіберілді', calls.stopRinging === 1, calls.stopRinging);
}

/* ---------- 6) Сенімділік тексерісі ---------- */
console.log('\n6) Рұқсаттар мен өндіруші');
{
  const { calls, Native } = makeEnv(
    { time: '07:00', days: [1], on: true, math: true, sound: 'classic', vibro: true },
    { exactAllowed: false, battery: false, manufacturer: 'Xiaomi' });
  await Native.reliabilitySetup(true);
  await wait(1200);
  const all = calls.confirms.join(' | ');
  check('дәл уақыт рұқсаты сұралды', /Оятқыш пен еске/.test(all), all.slice(0, 60));
  check('батарея шектеуі айтылды', /батарея шектеуінен/.test(all));
  check('Xiaomi автозапуск ескертілді', /Автозапуск/.test(all));
}
console.log('\n7) Бәрі дұрыс болса — ескерту жоқ');
{
  const { calls, Native } = makeEnv(
    { time: '07:00', days: [1], on: true, math: true, sound: 'classic', vibro: true },
    { exactAllowed: true, battery: true, manufacturer: 'Google' });
  await Native.reliabilitySetup(true);
  await wait(800);
  check('бір де бір диалог көрсетілмеді', calls.confirms.length === 0, calls.confirms.length);
}

console.log(fails ? '\n' + fails + ' ТЕКСЕРУ ҚҰЛАДЫ' : '\nБарлық тексеру өтті.');
process.exit(fails ? 1 : 0);
