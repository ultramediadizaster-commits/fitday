package kz.fitday.app;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

/**
 * ОЯТҚЫШ ҚЫЗМЕТІ (foreground service).
 *
 * Екі режимі бар:
 *   PREPARE — соғуға 10 минут қалғанда іске қосылады. Көзге түспейтін
 *             хабарламамен процесті тірі ұстайды: жүйе оны өлтіріп,
 *             оятқышты жіберіп алмасын.
 *   RING    — уақыт келді. Дыбысты res/raw ішіндегі файлдан, ОЯТҚЫШ ағынында
 *             (USAGE_ALARM), қайталап ойнатады және дірілдетеді. Дыбысты
 *             хабарлама арнасы емес, дәл осы қызмет шығарады — сондықтан
 *             тоқтағанша соға береді және дауысты ауыстыру бірден әсер етеді.
 *
 * Дыбыс өздігінен MAX_RING_MS-тен кейін тоқтайды — пайдаланушы жоқ болса,
 * батареяны түгел жеп қоймас үшін.
 */
public class AlarmService extends Service {

    static final String ACTION_PREPARE = "kz.fitday.app.SVC_PREPARE";
    static final String ACTION_RING = "kz.fitday.app.SVC_RING";
    static final String ACTION_STOP = "kz.fitday.app.SVC_STOP";

    /** Ең ұзағы 15 минут соғады */
    private static final long MAX_RING_MS = 15 * 60 * 1000L;

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean ringing = false;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        Log.i(AlarmScheduler.TAG, "қызмет: " + action);
        AlarmNotifications.ensureChannels(this);

        if (ACTION_STOP.equals(action)) {
            stopRinging();
            return START_NOT_STICKY;
        }

        if (ACTION_RING.equals(action)) {
            startAsForeground(AlarmNotifications.ID_RING,
                    AlarmNotifications.buildRing(this, false), true);
            startRinging();
            return START_STICKY;
        }

        /* PREPARE (немесе белгісіз әрекет) — тек тірі тұрамыз */
        startAsForeground(AlarmNotifications.ID_PREPARE,
                AlarmNotifications.buildPrepare(this), false);
        /* Соғу сәті өтіп кетсе, қызмет өздігінен тоқтасын */
        handler.postDelayed(this::stopIfIdle, AlarmScheduler.PREPARE_LEAD_MS + 60_000L);
        return START_STICKY;
    }

    private void startAsForeground(int id, android.app.Notification n, boolean media) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int type = media
                    ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    : ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
            startForeground(id, n, type);
        } else {
            startForeground(id, n);
        }
    }

    private void startRinging() {
        if (ringing) return;
        ringing = true;
        AlarmStore.setRinging(this, true);
        acquireWakeLock();
        playSound();
        startVibration();
        handler.postDelayed(this::stopRinging, MAX_RING_MS);
    }

    private void playSound() {
        String voice = AlarmNotifications.resolveVoice(AlarmStore.voice(this),
                AlarmScheduler.stamp(System.currentTimeMillis()).substring(0, 10));
        int res = AlarmNotifications.soundRes(this, voice);
        if (res == 0) {
            Log.e(AlarmScheduler.TAG, "дыбыс табылмады: alarm_" + voice);
            return;
        }
        try {
            player = MediaPlayer.create(this, res);
            if (player == null) {
                Log.e(AlarmScheduler.TAG, "MediaPlayer құрылмады");
                return;
            }
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_ALARM)     // оятқыш ағыны
                    .build());
            player.setLooping(true);                           // тоқтатқанша соғады
            player.setVolume(1f, 1f);
            player.start();

            /* Оятқыш ағыны басылып тұрса, дыбыс естілмей қалады — көтереміз */
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                if (am.getStreamVolume(AudioManager.STREAM_ALARM) < max / 2) {
                    am.setStreamVolume(AudioManager.STREAM_ALARM, max / 2, 0);
                }
            }
        } catch (Exception e) {
            Log.e(AlarmScheduler.TAG, "дыбыс қатесі: " + e.getMessage());
        }
    }

    private void startVibration() {
        if (!AlarmStore.vibro(this)) return;
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(
                        AlarmNotifications.VIBRATION, 0));     // 0 = қайталау
            } else {
                vibrator.vibrate(AlarmNotifications.VIBRATION, 0);
            }
        } catch (Exception e) {
            Log.e(AlarmScheduler.TAG, "діріл қатесі: " + e.getMessage());
        }
    }

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "fitday:alarm");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(MAX_RING_MS + 60_000L);
    }

    private void stopIfIdle() {
        if (!ringing) stopSelf();
    }

    private void stopRinging() {
        handler.removeCallbacksAndMessages(null);
        ringing = false;
        AlarmStore.setRinging(this, false);
        if (player != null) {
            try { player.stop(); } catch (Exception ignored) { /* тоқтап қалған */ }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) { /* қолдамайды */ }
            vibrator = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) { /* босаған */ }
        }
        wakeLock = null;
        AlarmNotifications.cancelRing(this);
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopRinging();
        super.onDestroy();
    }

    /** Басқа жерден тоқтату (JS «Оятқышты өшір» дегенде). */
    static void stop(Context c) {
        Intent i = new Intent(c, AlarmService.class).setAction(ACTION_STOP);
        try {
            c.startService(i);
        } catch (Exception e) {
            /* Қызмет жүрмесе — тоқтататын да ештеңе жоқ */
            AlarmNotifications.cancelRing(c);
            AlarmStore.setRinging(c, false);
        }
    }
}
