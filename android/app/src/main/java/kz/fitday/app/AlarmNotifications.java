package kz.fitday.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

/**
 * ХАБАРЛАМАЛАР МЕН АРНАЛАР.
 *
 * Екі түрлі арна бар, себебі дыбысты кім шығаратыны екі жағдайда екі басқа:
 *
 *  1) fitday_ring_*  — ҮНСІЗ арна. Дыбысты AlarmService өзі MediaPlayer
 *     арқылы, оятқыш ағынында, ҚАЙТАЛАП ойнатады. Арна да дыбыс шығарса,
 *     екеуі қабаттасар еді. Үнсіз болғандықтан дауысты ауыстыру бірден
 *     күшіне енеді (Android арнаның дыбысын жасалғаннан кейін өзгертпейді).
 *
 *  2) fitday_alarm_<дауыс>_v1 — дыбысы бар арналар. Тек ҚОР жағдайы үшін:
 *     фондық шектеу қызметті іске қоспай қойса, оятқыш мүлдем үнсіз
 *     қалмауы керек.
 */
final class AlarmNotifications {

    static final String CH_RING = "fitday_ring_v2";
    static final String CH_PREPARE = "fitday_prepare_v2";
    static final String CH_ALARM_PREFIX = "fitday_alarm_";
    static final String CH_ALARM_SUFFIX = "_v1";

    static final int ID_RING = 7201;
    static final int ID_PREPARE = 7202;

    static final String[] VOICES = { "classic", "siren", "industrial", "drip", "dawn" };
    /** «random» күнге қарай осы төртеудің біреуін таңдайды (index.html-дегідей) */
    private static final String[] RANDOM_POOL = { "classic", "siren", "industrial", "drip" };

    static final long[] VIBRATION = { 0, 600, 300, 600, 300, 900 };

    private AlarmNotifications() { }

    static String channelForVoice(String voice) {
        return CH_ALARM_PREFIX + voice + CH_ALARM_SUFFIX;
    }

    /** «random» болса, күнге байланған тұрақты таңдау. */
    static String resolveVoice(String id, String dayKey) {
        if (id == null) return "classic";
        if (!"random".equals(id)) {
            for (String v : VOICES) if (v.equals(id)) return id;
            return "classic";
        }
        int h = 0;
        for (int i = 0; i < dayKey.length(); i++) h = (h * 31 + dayKey.charAt(i)) % 9973;
        return RANDOM_POOL[Math.abs(h) % RANDOM_POOL.length];
    }

    static int soundRes(Context c, String voice) {
        return c.getResources().getIdentifier("alarm_" + voice, "raw", c.getPackageName());
    }

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
                (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        /* 1) Соғу арнасы — үнсіз, дыбысты қызмет ойнатады */
        NotificationChannel ring = new NotificationChannel(
                CH_RING, "Оятқыш", NotificationManager.IMPORTANCE_HIGH);
        ring.setDescription("Оятқыш соғып тұрғанда көрсетіледі");
        ring.setSound(null, null);
        ring.enableVibration(false);          // дірілді де қызмет басқарады
        ring.enableLights(true);
        ring.setLightColor(0xFFD9F24E);
        ring.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ring.setBypassDnd(true);
        ring.setShowBadge(false);
        nm.createNotificationChannel(ring);

        /* 2) Дайындық арнасы — көзге түспейтін, дыбыссыз */
        NotificationChannel prep = new NotificationChannel(
                CH_PREPARE, "Оятқышқа дайындық", NotificationManager.IMPORTANCE_LOW);
        prep.setDescription("Оятқыш соғар алдында қосымшаны дайын күйде ұстайды");
        prep.setSound(null, null);
        prep.enableVibration(false);
        prep.setShowBadge(false);
        nm.createNotificationChannel(prep);

        /* 3) Қор арналары — дыбысы бар, әр дауысқа біреу */
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build();
        for (String v : VOICES) {
            int res = soundRes(c, v);
            if (res == 0) continue;
            NotificationChannel ch = new NotificationChannel(
                    channelForVoice(v), "FitDay: " + v, NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Қор нұсқасы — қызмет іске қосылмаса қолданылады");
            ch.setSound(Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE
                    + "://" + c.getPackageName() + "/raw/alarm_" + v), attrs);
            ch.setVibrationPattern(VIBRATION);
            ch.enableVibration(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setBypassDnd(true);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    private static int piFlags() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
        return f;
    }

    /** Оятқыш бетін ашатын intent (құлыптан өтіп ашылады). */
    static PendingIntent ringActivity(Context c) {
        Intent i = new Intent(c, MainActivity.class)
                .setAction(MainActivity.ACTION_SHOW_RING)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(c, 7301, i, piFlags());
    }

    /**
     * Соғу хабарламасы. setFullScreenIntent арқасында құлыпталған экранда
     * оятқыш беті БІРДЕН ашылады — пайдаланушының басуын күтпейді.
     *
     * @param withSound қор режимі: қызмет іске қосылмаған, дыбысты арна шығарсын
     */
    static Notification buildRing(Context c, boolean withSound) {
        String time = AlarmStore.timeLabel(c);
        String voice = resolveVoice(AlarmStore.voice(c),
                AlarmScheduler.stamp(System.currentTimeMillis()).substring(0, 10));
        String channel = withSound ? channelForVoice(voice) : CH_RING;

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channel)
                .setSmallIcon(R.drawable.ic_stat_fitday)
                .setColor(0xFFD9F24E)
                .setContentTitle("Тұратын уақыт келді!")
                .setContentText(time + " · " + (AlarmStore.math(c)
                        ? "Өшіру үшін тапсырманы шеш" : "Өшіру үшін аш"))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(ringActivity(c))
                .setFullScreenIntent(ringActivity(c), true);
        return b.build();
    }

    static void showRingNotification(Context c, boolean withSound) {
        ensureChannels(c);
        NotificationManager nm =
                (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(ID_RING, buildRing(c, withSound));
    }

    static void cancelRing(Context c) {
        NotificationManager nm =
                (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(ID_RING);
    }

    /** Дайындық режиміндегі көзге түспейтін хабарлама. */
    static Notification buildPrepare(Context c) {
        return new NotificationCompat.Builder(c, CH_PREPARE)
                .setSmallIcon(R.drawable.ic_stat_fitday)
                .setColor(0xFFD9F24E)
                .setContentTitle("Оятқыш " + AlarmStore.timeLabel(c) + "-де")
                .setContentText("Қосымша дайын күйде тұр")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(ringActivity(c))
                .build();
    }
}
