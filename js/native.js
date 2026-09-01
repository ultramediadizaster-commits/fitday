/* =============================================================================
   FitDay — НАТИВТІ ҚАБАТ (Capacitor)

   Браузерде бұл файл түк істемейді: барлық әрекет window.Capacitor бар кезде
   ғана орындалады, сондықтан PWA нұсқасы бұрынғыдай жұмыс істей береді.

   Bundler жоқ, сондықтан плагиндер npm модулі арқылы емес, нативті көпір
   енгізетін window.Capacitor.Plugins арқылы шақырылады.

   ЕҢ МАҢЫЗДЫСЫ — ОЯТҚЫШ. Қосымша жабық тұрғанда JS жүрмейді, сондықтан
   index.html ішіндегі setInterval оятқышы жарамайды. Оның орнына алдын ала
   жоспарланған жүйелік хабарламалар қойылады (setExactAndAllowWhileIdle),
   дыбысы — res/raw ішіндегі файл, арнасы — USAGE_ALARM.
   ============================================================================= */
(function () {
  'use strict';

  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

  /* ---------- Баптаулар ---------- */
  var CH_VERSION = 'v1';              // AlarmChannelPlugin.VERSION-мен сәйкес болуы тиіс
  var CH_PREFIX = 'fitday_alarm_';
  var SOUND_VOICES = ['classic', 'siren', 'industrial', 'drip', 'dawn'];
  var RANDOM_POOL = ['classic', 'siren', 'industrial', 'drip'];   // index.html-дегідей
  var VOICE_NAMES = {
    classic: 'Классика', siren: 'Сирена', industrial: 'Дабыл',
    drip: 'Тамшы', dawn: 'Таң'
  };
  var VIBRATION = [0, 600, 300, 600, 300, 900];   // арнаның діріл ырғағы

  /* Бір оятқыш = бірнеше хабарлама тізбегі. Бір дыбыс 30 секунд, сондықтан
     30 секунд сайын жаңасы келеді — үзіліссіз шырылдағандай болады.
     CHAIN × 30 сек = шырылдау ұзақтығы. */
  var CHAIN = 6;                      // 3 минут
  var CHAIN_STEP_MS = 30 * 1000;
  var OCCURRENCES = 10;               // алдағы неше рет оянуды жоспарлаймыз
  var ID_BASE = 41000;                // біздің хабарлама id-лерінің диапазоны
  var ID_MAX = ID_BASE + OCCURRENCES * CHAIN;

  var Native = {
    active: isNative,
    channelsReady: false,
    permission: 'unknown',            // granted | denied | unknown
    exactAllowed: null,               // true | false | null (белгісіз)
    lastError: null,
    scheduled: 0
  };
  window.Native = Native;

  function plugin(name) {
    return (Cap && Cap.Plugins && Cap.Plugins[name]) || null;
  }
  function log() {
    if (window.console) console.log.apply(console, ['[native]'].concat([].slice.call(arguments)));
  }
  function say(msg) {
    if (typeof toast === 'function') toast(msg); else log(msg);
  }

  /* =========================================================================
     1) ЭКРАН: күй жолағы, splash
     ========================================================================= */
  function initStatusBar() {
    var sb = plugin('StatusBar');
    if (!sb) return;
    /* Style.Dark = қара фонға ақ мәтін (Capacitor терминологиясы) */
    sb.setStyle({ style: 'DARK' }).catch(noop);
    sb.setBackgroundColor({ color: '#0A0A0B' }).catch(noop);
    sb.setOverlaysWebView({ overlay: false }).catch(noop);
  }
  function hideSplash() {
    var sp = plugin('SplashScreen');
    if (sp) sp.hide({ fadeOutDuration: 250 }).catch(noop);
  }

  /* =========================================================================
     2) АРТҚЫ ТҮЙМЕ
     Тәртібі: ашық оверлей болса — жабамыз (оятқыш экранынан басқасы);
     негізгі бетте болмасақ — үй бетіне; үйде екі рет бассаң — шығу.
     ========================================================================= */
  var lastBack = 0;
  function initBackButton() {
    var app = plugin('App');
    if (!app) return;
    app.addListener('backButton', function () {
      /* Оятқыш соғып тұрғанда артқы түйме ештеңе істемейді —
         тапсырманы шешпей шығып кетуге болмайды. */
      var ring = document.getElementById('ov-ring');
      if (ring && ring.classList.contains('show')) {
        if (typeof buzz === 'function') buzz();
        return;
      }
      var open = document.querySelector('.ov.show');
      if (open) {
        /* Жаттығудан шығу — таймерлерді, дауысты, 3D-ні тоқтатып,
           әрі растауды сұрап шығу керек (прогресс сақталмайды). */
        if (open.id === 'ov-run' && typeof stopRun === 'function') stopRun(true);
        else open.classList.remove('show');
        return;
      }
      var view = (typeof curView !== 'undefined') ? curView : 'home';
      if (view !== 'home' && typeof nav === 'function') { nav('home'); return; }

      var now = Date.now();
      if (now - lastBack < 2000) { app.exitApp(); return; }
      lastBack = now;
      say('Шығу үшін тағы бір рет бас');
    });
  }

  /* =========================================================================
     3) ЭКРАННЫҢ СӨНБЕУІ — жаттығу кезінде
     index.html-дегі navigator.wakeLock орнына нативті нұсқа.
     ========================================================================= */
  Native.keepAwake = function (on) {
    var ka = plugin('KeepAwake');
    if (!ka) return Promise.resolve(false);
    return (on ? ka.keepAwake() : ka.allowSleep()).then(function () { return true; },
      function () { return false; });
  };

  /* =========================================================================
     4) ОЯТҚЫШ
     ========================================================================= */

  /* «random» — күнге байланған таңдау. index.html-дегі resolveVoice-пен бірдей
     болуы керек, әйтпесе экрандағы дыбыс пен хабарламаның дыбысы үйлеспейді. */
  function resolveVoiceFor(id, date) {
    if (id !== 'random') return SOUND_VOICES.indexOf(id) >= 0 ? id : 'classic';
    var key = dayKeyOf(date);
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 9973;
    return RANDOM_POOL[h % RANDOM_POOL.length];
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKeyOf(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function channelFor(voiceId) { return CH_PREFIX + voiceId + '_' + CH_VERSION; }

  /* Хабарлама рұқсаты + арналар. Бір рет жеткілікті. */
  Native.prepare = function () {
    var ln = plugin('LocalNotifications');
    if (!ln) return Promise.resolve(false);

    return ln.checkPermissions()
      .then(function (r) {
        if (r && r.display === 'granted') return r;
        return ln.requestPermissions();
      })
      .then(function (r) {
        Native.permission = (r && r.display) || 'unknown';
        if (Native.permission !== 'granted') {
          say('Хабарламаға рұқсат жоқ — оятқыш қосымша жабық тұрғанда соқпайды.');
          return false;
        }
        return createChannels();
      })
      .then(function (ok) {
        if (!ok) return false;
        Native.channelsReady = true;
        return checkExact();
      })
      .catch(function (e) {
        Native.lastError = String(e && e.message || e);
        log('prepare қатесі:', Native.lastError);
        return false;
      });
  };

  function createChannels() {
    var ac = plugin('AlarmChannel');
    if (!ac) {
      /* Өз плагині жоқ — стандартты плагинмен жасаймыз. Дыбыс шығады, бірақ
         ОЯТҚЫШ ағыны емес, хабарлама ағыны қолданылады (әлсіздеу). */
      return fallbackChannels();
    }
    return ac.create({
      vibration: VIBRATION,
      voices: SOUND_VOICES.map(function (id) {
        return { id: id, name: 'FitDay: ' + (VOICE_NAMES[id] || id), sound: 'alarm_' + id + '.mp3' };
      })
    }).then(function (r) {
      log('арналар жасалды:', r && r.created);
      return true;
    }, function (e) {
      Native.lastError = String(e && e.message || e);
      log('AlarmChannel сәтсіз, стандарт нұсқаға көшеміз:', Native.lastError);
      return fallbackChannels();
    });
  }
  function fallbackChannels() {
    var ln = plugin('LocalNotifications');
    if (!ln || !ln.createChannel) return Promise.resolve(false);
    var jobs = SOUND_VOICES.map(function (id) {
      return ln.createChannel({
        id: channelFor(id),
        name: 'FitDay: ' + (VOICE_NAMES[id] || id),
        description: 'FitDay оятқышы',
        importance: 5,
        visibility: 1,
        sound: 'alarm_' + id + '.mp3',
        vibration: true,
        lights: true,
        lightColor: '#D9F24E'
      }).catch(noop);
    });
    return Promise.all(jobs).then(function () { return true; });
  }

  function checkExact() {
    var ac = plugin('AlarmChannel');
    if (!ac || !ac.canScheduleExact) { Native.exactAllowed = null; return true; }
    return ac.canScheduleExact().then(function (r) {
      Native.exactAllowed = !!(r && r.granted);
      if (!Native.exactAllowed) {
        say('Дәл уақытта ояту рұқсаты жоқ — баптаудан «Оятқыш пен еске салу» рұқсатын бер.');
      }
      return true;
    }, function () { Native.exactAllowed = null; return true; });
  }

  /* Жүйелік баптау беттері — қосымшадан ашу үшін */
  Native.openExactSettings = function () {
    var ac = plugin('AlarmChannel');
    if (ac && ac.openExactAlarmSettings) ac.openExactAlarmSettings().catch(noop);
  };
  Native.openNotificationSettings = function () {
    var ac = plugin('AlarmChannel');
    if (ac && ac.openNotificationSettings) ac.openNotificationSettings().catch(noop);
  };

  /* Алдағы OCCURRENCES рет ояту сәтін есептеу */
  function occurrences(alarm, from) {
    var parts = String(alarm.time || '07:00').split(':');
    var hh = +parts[0] || 0, mm = +parts[1] || 0;
    var out = [];
    var d = new Date(from.getTime());
    d.setSeconds(0, 0);
    for (var i = 0; i < 90 && out.length < OCCURRENCES; i++) {
      var day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, hh, mm, 0, 0);
      if (day.getTime() <= from.getTime()) continue;
      if (alarm.days.indexOf(day.getDay()) < 0) continue;
      out.push(day);
    }
    return out;
  }

  /* Барлық жоспарланған FitDay оятқышын өшіру */
  function cancelAll() {
    var ln = plugin('LocalNotifications');
    if (!ln) return Promise.resolve();
    return ln.getPending().then(function (r) {
      var ours = ((r && r.notifications) || []).filter(function (n) {
        return n.id >= ID_BASE && n.id < ID_MAX;
      }).map(function (n) { return { id: n.id }; });
      if (!ours.length) return null;
      return ln.cancel({ notifications: ours });
    }).catch(noop);
  }

  /* Негізгі функция: күйге қарап хабарламаларды қайта жоспарлау */
  var syncTimer = null;
  Native.syncAlarm = function () {
    if (!isNative) return Promise.resolve(false);
    clearTimeout(syncTimer);
    return new Promise(function (resolve) {
      syncTimer = setTimeout(function () { doSync().then(resolve); }, 400);
    });
  };

  function doSync() {
    var ln = plugin('LocalNotifications');
    if (!ln || typeof S === 'undefined' || !S.alarm) return Promise.resolve(false);
    var alarm = S.alarm;

    return cancelAll().then(function () {
      if (!alarm.on || !alarm.days || !alarm.days.length) {
        Native.scheduled = 0;
        log('оятқыш өшірулі — хабарлама жоспарланбады');
        return false;
      }
      if (!Native.channelsReady) return Native.prepare().then(function (ok) {
        return ok ? schedule(ln, alarm) : false;
      });
      return schedule(ln, alarm);
    });
  }

  function schedule(ln, alarm) {
    var list = occurrences(alarm, new Date());
    var notifications = [];

    list.forEach(function (when, di) {
      var voice = resolveVoiceFor(alarm.sound, when);
      var channelId = channelFor(voice);
      var stamp = dayKeyOf(when) + ' ' + alarm.time;

      for (var ci = 0; ci < CHAIN; ci++) {
        var at = new Date(when.getTime() + ci * CHAIN_STEP_MS);
        notifications.push({
          id: ID_BASE + di * CHAIN + ci,
          channelId: channelId,
          title: ci === 0 ? 'Тұратын уақыт келді!' : 'Оятқыш әлі соғып тұр',
          body: alarm.time + ' · ' + (alarm.math
            ? 'Өшіру үшін тапсырманы шеш' : 'Өшіру үшін аш'),
          smallIcon: 'ic_stat_fitday',
          iconColor: '#D9F24E',
          ongoing: false,
          autoCancel: true,
          sound: 'alarm_' + voice + '.mp3',
          extra: { fitday: 'alarm', stamp: stamp, chain: ci },
          schedule: {
            at: at,
            allowWhileIdle: true          // Doze режимінде де оянады
          }
        });
      }
    });

    if (!notifications.length) { Native.scheduled = 0; return false; }
    return ln.schedule({ notifications: notifications }).then(function () {
      Native.scheduled = notifications.length;
      log('жоспарланды:', notifications.length, 'хабарлама,', list.length, 'ояту');
      return true;
    }, function (e) {
      Native.lastError = String(e && e.message || e);
      Native.scheduled = 0;
      log('жоспарлау қатесі:', Native.lastError);
      say('Оятқышты жоспарлау мүмкін болмады: ' + Native.lastError);
      return false;
    });
  }

  /* Оятқыш өшірілгенде — сол күнгі қалған тізбекті тоқтату */
  Native.stopRinging = function () {
    if (!isNative) return Promise.resolve();
    return cancelAll().then(function () { return Native.syncAlarm(); });
  };

  /* Хабарламаны басқанда — бірден оятқыш экранын ашу */
  function initNotificationTap() {
    var ln = plugin('LocalNotifications');
    if (!ln) return;
    ln.addListener('localNotificationActionPerformed', function (ev) {
      var data = ev && ev.notification && ev.notification.extra;
      if (!data || data.fitday !== 'alarm') return;
      openRing(data.stamp);
    });
  }

  /* Қосымша суық күйден ашылса, DOM әлі дайын болмауы мүмкін — күтеміз */
  function openRing(stamp) {
    var tries = 0;
    (function attempt() {
      var ring = document.getElementById('ov-ring');
      if (!ring || typeof fireAlarm !== 'function' || typeof S === 'undefined') {
        if (tries++ < 60) return setTimeout(attempt, 100);
        return;
      }
      if (ring.classList.contains('show')) return;      // әлдеқашан ашық
      if (stamp && S.alarm) { S.alarm.lastFire = stamp; }   // қайта соқпасын
      if (typeof Sound !== 'undefined' && Sound.ready) Sound.ready();
      fireAlarm();
      log('оятқыш экраны ашылды:', stamp);
    })();
  }
  Native.openRing = openRing;

  /* =========================================================================
     5) ҚОЙМАНЫ ТЕКСЕРУ — localStorage мен IndexedDB WebView-де жұмыс істей ме
     ========================================================================= */
  Native.checkStorage = function () {
    var res = { localStorage: 'жоқ', indexedDB: 'жоқ' };
    try {
      var k = '__fitday_test__';
      localStorage.setItem(k, '1');
      res.localStorage = localStorage.getItem(k) === '1' ? 'жұмыс істейді' : 'оқылмады';
      localStorage.removeItem(k);
    } catch (e) {
      res.localStorage = 'ҚАТЕ: ' + (e && e.name || e);
    }
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(res);
      var req;
      try { req = indexedDB.open('__fitday_test__', 1); }
      catch (e) { res.indexedDB = 'ҚАТЕ: ' + (e && e.name || e); return resolve(res); }
      req.onupgradeneeded = function () { req.result.createObjectStore('t'); };
      req.onerror = function () {
        res.indexedDB = 'ҚАТЕ: ' + (req.error && req.error.name || 'ашылмады');
        resolve(res);
      };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction('t', 'readwrite');
          tx.objectStore('t').put({ a: 1 }, 'k');
          tx.oncomplete = function () {
            res.indexedDB = 'жұмыс істейді';
            db.close();
            try { indexedDB.deleteDatabase('__fitday_test__'); } catch (e) { /* маңызды емес */ }
            resolve(res);
          };
          tx.onerror = function () {
            res.indexedDB = 'ҚАТЕ: жазылмады';
            db.close(); resolve(res);
          };
        } catch (e) {
          res.indexedDB = 'ҚАТЕ: ' + (e && e.name || e);
          db.close(); resolve(res);
        }
      };
    });
  };

  /* =========================================================================
     6) Іске қосу — index.html ішіндегі init() соңында шақырылады
     ========================================================================= */
  Native.init = function () {
    if (!isNative) { log('браузер режимі — нативті қабат өшірулі'); return; }
    log('нативті режим:', Cap.getPlatform && Cap.getPlatform());

    initStatusBar();
    initBackButton();
    initNotificationTap();

    Native.checkStorage().then(function (r) {
      log('қойма:', r);
      Native.storage = r;
      if (String(r.localStorage).indexOf('ҚАТЕ') === 0) {
        say('Ескерту: localStorage жұмыс істемейді — деректер сақталмайды.');
      }
    });

    Native.prepare().then(function () { return Native.syncAlarm(); });

    /* Қосымша алдыңғы қатарға шыққанда: жоспарды жаңартып қоямыз
       (уақыт өтті, күн ауысты, пайдаланушы баптауды жүйеден өзгертті). */
    var app = plugin('App');
    if (app) {
      app.addListener('appStateChange', function (st) {
        if (st && st.isActive) { checkExact(); Native.syncAlarm(); }
      });
    }

    /* Суық қосылу: қосымша хабарламаны басу арқылы ашылған болуы мүмкін */
    var ln = plugin('LocalNotifications');
    if (ln && ln.getDeliveredNotifications) {
      ln.getDeliveredNotifications().then(function (r) {
        var list = (r && r.notifications) || [];
        for (var i = 0; i < list.length; i++) {
          var ex = list[i].extra;
          if (ex && ex.fitday === 'alarm') { openRing(ex.stamp); break; }
        }
      }).catch(noop);
    }

    setTimeout(hideSplash, 300);
  };

  function noop() { /* қатені елемейміз */ }
}());
