/* =============================================================================
   FitDay — НАТИВТІ ҚАБАТ (Capacitor)

   Браузерде бұл файл түк істемейді: барлық әрекет window.Capacitor бар кезде
   ғана орындалады, сондықтан PWA нұсқасы бұрынғыдай жұмыс істей береді.

   Bundler жоқ, сондықтан плагиндер npm модулі арқылы емес, нативті көпір
   енгізетін window.Capacitor.Plugins арқылы шақырылады.

   ОЯТҚЫШ ТУРАЛЫ. Бұрын хабарламалар JS-тен жоспарланатын
   (@capacitor/local-notifications). Ол экран өшкенде істеді, бірақ қосымша
   соңғы қосымшалар тізімінен алынып тасталса, дабылдар жоғалатын. Сондықтан
   жоспарлау түгел нативке көшті: AlarmChannel.setAlarm() баптауды
   SharedPreferences-ке жазады да, AlarmManager.setAlarmClock() қояды. JS
   мұнда тек баптауды береді және соғу белгісін оқиды.
   ============================================================================= */
(function () {
  'use strict';

  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

  var Native = {
    active: isNative,
    permission: 'unknown',            // granted | denied | unknown
    exactAllowed: null,
    batteryOk: null,
    nextLabel: '',
    lastError: null
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
  function noop() { /* қатені елемейміз */ }

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

  /* Хабарлама рұқсаты (Android 13+). Онсыз оятқыш беті ашылмайды. */
  Native.askNotifications = function () {
    var ac = plugin('AlarmChannel');
    if (!ac || !ac.checkPermissions) return Promise.resolve(true);
    return ac.checkPermissions()
      .then(function (r) {
        if (r && r.notifications === 'granted') return r;
        return ac.requestPermissions();
      })
      .then(function (r) {
        Native.permission = (r && r.notifications) || 'unknown';
        if (Native.permission !== 'granted') {
          say('Хабарламаға рұқсат жоқ — оятқыш экраны ашылмауы мүмкін.');
        }
        return Native.permission === 'granted';
      })
      .catch(function (e) {
        Native.lastError = String(e && e.message || e);
        return false;
      });
  };

  /* Баптауды нативке беру. saveState() ішінен шақырылады, сондықтан кідіріс бар. */
  var syncTimer = null;
  Native.syncAlarm = function () {
    if (!isNative) return Promise.resolve(false);
    clearTimeout(syncTimer);
    return new Promise(function (resolve) {
      syncTimer = setTimeout(function () { doSync().then(resolve); }, 400);
    });
  };

  function doSync() {
    var ac = plugin('AlarmChannel');
    if (!ac || typeof S === 'undefined' || !S.alarm) return Promise.resolve(false);
    var a = S.alarm;
    var parts = String(a.time || '07:00').split(':');

    return ac.setAlarm({
      enabled: !!a.on,
      hour: +parts[0] || 0,
      minute: +parts[1] || 0,
      days: (a.days || []).join(','),      // 0 = жексенбі
      voice: a.sound || 'classic',
      math: !!a.math,
      vibro: !!a.vibro
    }).then(function (r) {
      Native.nextLabel = (r && r.nextLabel) || '';
      log(r && r.scheduled ? 'оятқыш қойылды: ' + Native.nextLabel : 'оятқыш өшірулі');
      if (r && r.scheduled) Native.reliabilitySetup(false);
      return !!(r && r.scheduled);
    }, function (e) {
      Native.lastError = String(e && e.message || e);
      log('жоспарлау қатесі:', Native.lastError);
      say('Оятқышты қою мүмкін болмады: ' + Native.lastError);
      return false;
    });
  }

  /* Оятқыш өшірілгенде дыбысты тоқтату */
  Native.stopRinging = function () {
    var ac = plugin('AlarmChannel');
    if (!ac) return Promise.resolve();
    return ac.stopRinging().catch(noop);
  };

  /* Нативте оятқыш соққан ба? Соқса — бетті ашамыз.
     Қосымша толық жабық тұрғанда да дабыл жүреді, сондықтан бет ашылғанда
     «мен соқтым» деген белгіні оқып аламыз. */
  function checkPendingRing() {
    var ac = plugin('AlarmChannel');
    if (!ac || !ac.consumePendingRing) return Promise.resolve(false);
    return ac.consumePendingRing().then(function (r) {
      if (!r || !r.pending) return false;
      openRing(r.stamp);
      return true;
    }, noop);
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
      if (stamp && S.alarm) S.alarm.lastFire = stamp;   // қайта соқпасын
      if (typeof Sound !== 'undefined' && Sound.ready) Sound.ready();
      fireAlarm();
      log('оятқыш экраны ашылды:', stamp);
    })();
  }
  Native.openRing = openRing;

  /* =========================================================================
     5) СЕНІМДІЛІК: дәл уақыт, батарея, автозапуск
     ========================================================================= */

  /* Осы өндірушілерде қосымшаны «Автозапуск» тізіміне қолмен қосу керек,
     әйтпесе жүйе оны жауып тастайды да, оятқыш соқпайды. */
  var exactPrompted = false;   // дәл уақыт диалогы бір сеанста бір рет
  var STRICT = ['xiaomi', 'redmi', 'poco', 'huawei', 'honor', 'oppo', 'realme',
    'vivo', 'oneplus', 'meizu'];

  Native.checkReliability = function () {
    var ac = plugin('AlarmChannel');
    if (!ac || !ac.status) return Promise.resolve(null);
    return ac.status().then(function (r) {
      if (!r) return null;
      Native.exactAllowed = r.exactAllowed;
      Native.batteryOk = r.batteryUnrestricted;
      Native.nextLabel = r.nextLabel || '';
      Native.manufacturer = r.manufacturer || '';
      return r;
    }, noop);
  };

  Native.openExactSettings = function () {
    var ac = plugin('AlarmChannel');
    if (ac) ac.openExactAlarmSettings().catch(noop);
  };
  Native.askBattery = function () {
    var ac = plugin('AlarmChannel');
    if (ac) return ac.requestBatteryUnrestricted().catch(noop);
    return Promise.resolve();
  };
  Native.openAppSettings = function () {
    var ac = plugin('AlarmChannel');
    if (ac) ac.openAppSettings().catch(noop);
  };
  Native.openNotificationSettings = function () {
    var ac = plugin('AlarmChannel');
    if (ac) ac.openNotificationSettings().catch(noop);
  };

  /* Оятқыш алғаш қосылғанда бір рет түсіндіріп, рұқсат сұраймыз.
     Бас тартса қайта мазаламаймыз — S.settings.alarmSetup белгісі сақталады. */
  Native.reliabilitySetup = function (force) {
    if (!isNative) return Promise.resolve();
    if (typeof S === 'undefined') return Promise.resolve();
    /* Бір рет көрсетілген — қайта мазаламаймыз. Бірақ ДӘЛ УАҚЫТ рұқсаты
       жоқ болса, оятқыш мүлдем сенімсіз болады, сондықтан ол тексеріс
       бұл шектеуден өтеді (төменде force-қа қарамай қосылады). */
    var shown = !force && S.settings && S.settings.alarmSetup;

    return Native.checkReliability().then(function (r) {
      if (!r) return;
      var steps = [];

      if (!r.exactAllowed && !exactPrompted) {
        exactPrompted = true;                 // бір сеанста бір рет қана сұраймыз
        steps.push(function () {
          if (window.confirm('Оятқыш дәл уақытында соғуы үшін «Оятқыш пен еске '
              + 'салу» рұқсаты керек. Баптауды ашайын ба?')) {
            Native.openExactSettings();
          }
        });
      }
      if (!r.batteryUnrestricted && !shown) {
        steps.push(function () {
          if (window.confirm('Оятқыш дұрыс жұмыс істеуі үшін батарея шектеуінен '
              + 'шығару керек. Онсыз жүйе қосымшаны ұйықтатып, оятқышты '
              + 'кешіктіруі мүмкін. Рұқсат сұрайын ба?')) {
            Native.askBattery();
          }
        });
      }
      var maker = String(r.manufacturer || '').toLowerCase();
      if (!shown && STRICT.some(function (m) { return maker.indexOf(m) >= 0; })) {
        steps.push(function () {
          if (window.confirm('Сенің телефоның (' + r.manufacturer + ') қосымшаларды '
              + 'қатаң жабады. Оятқыш жұмыс істеуі үшін FitDay-ды «Автозапуск» '
              + 'тізіміне қосу керек. Қосымша баптауын ашайын ба?')) {
            Native.openAppSettings();
          }
        });
      }

      if (S.settings) {
        S.settings.alarmSetup = true;
        if (typeof saveState === 'function') saveState();
      }
      /* Диалогтарды бірінің артынан бірін көрсетеміз */
      steps.forEach(function (fn, i) { setTimeout(fn, 400 + i * 300); });
      if (!steps.length) log('сенімділік тексерісі: бәрі дұрыс');
    });
  };

  /* =========================================================================
     6) ҚОЙМАНЫ ТЕКСЕРУ — localStorage мен IndexedDB WebView-де жұмыс істей ме
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
     7) Іске қосу — index.html ішіндегі init() соңында шақырылады
     ========================================================================= */
  Native.init = function () {
    if (!isNative) { log('браузер режимі — нативті қабат өшірулі'); return; }
    log('нативті режим:', Cap.getPlatform && Cap.getPlatform());

    initStatusBar();
    initBackButton();

    Native.checkStorage().then(function (r) {
      log('қойма:', r);
      Native.storage = r;
      if (String(r.localStorage).indexOf('ҚАТЕ') === 0) {
        say('Ескерту: localStorage жұмыс істемейді — деректер сақталмайды.');
      }
    });

    /* Оятқыш соғып тұрып ашылған болуы мүмкін — ең алдымен соны тексереміз */
    checkPendingRing();

    Native.askNotifications()
      .then(function () { return Native.syncAlarm(); })
      .then(function () {
        if (typeof S !== 'undefined' && S.alarm && S.alarm.on) {
          return Native.reliabilitySetup(false);
        }
      });

    /* Қосымша алдыңғы қатарға шыққанда: соғу белгісін және күйді тексереміз */
    var app = plugin('App');
    if (app) {
      app.addListener('appStateChange', function (st) {
        if (st && st.isActive) {
          checkPendingRing();
          Native.checkReliability();
        }
      });
      /* Толық экранды intent-пен ашылғанда resume оқиғасы да келеді */
      app.addListener('resume', function () { checkPendingRing(); });
    }

    setTimeout(hideSplash, 300);
  };
}());
