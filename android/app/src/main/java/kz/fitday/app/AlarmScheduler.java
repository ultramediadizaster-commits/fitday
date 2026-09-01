package kz.fitday.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * ОЯТҚЫШТЫ ЖОСПАРЛАУ.
 *
 * Неге setAlarmClock(): бұл AlarmManager-дің ең күшті әдісі. Жүйе оны «нағыз
 * оятқыш» деп таниды — Doze режимін толық айналып өтеді, батарея үнемдеу
 * шектеулеріне ілінбейді, әрі қосымша соңғы қосымшалар тізімінен алынып
 * тасталса да сақталады. setExactAndAllowWhileIdle() мұны кепілдемейді:
 * көп өндірушіде қосымша «свайппен» жабылғанда оның кәдімгі alarm-дары
 * жойылады, ал alarm clock жойылмайды.
 *
 * Екі дабыл қойылады:
 *   PREPARE  — соғудан 10 минут бұрын, процесті тірілтіп, foreground service
 *              іске қосады (жүйе процесті өлтірмесін);
 *   FIRE     — дәл уақытында, setAlarmClock арқылы.
 */
final class AlarmScheduler {

    static final String TAG = "FitDayAlarm";

    static final String ACTION_FIRE = "kz.fitday.app.ALARM_FIRE";
    static final String ACTION_PREPARE = "kz.fitday.app.ALARM_PREPARE";

    private static final int RQ_FIRE = 7101;
    private static final int RQ_PREPARE = 7102;
    private static final int RQ_SHOW = 7103;

    /** Соғудан қанша бұрын процесті тірілтеміз */
    static final long PREPARE_LEAD_MS = 10 * 60 * 1000L;

    private AlarmScheduler() { }

    private static AlarmManager am(Context c) {
        return (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    }

    private static int flags() {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) f |= PendingIntent.FLAG_IMMUTABLE;
        return f;
    }

    private static PendingIntent broadcast(Context c, String action, int rq) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(c, rq, i, flags());
    }

    /** Оятқыш сағатының белгішесін басқанда ашылатын бет */
    private static PendingIntent showIntent(Context c) {
        Intent i = new Intent(c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, RQ_SHOW, i, flags());
    }

    /** Сақталған баптау бойынша келесі соғуды қайта жоспарлау. */
    static void reschedule(Context c) {
        cancel(c);
        long next = AlarmStore.nextTrigger(c, System.currentTimeMillis());
        if (next == 0L) {
            Log.i(TAG, "оятқыш өшірулі — жоспарланбады");
            return;
        }
        AlarmManager am = am(c);
        if (am == null) return;

        /* Дәл уақыт — setAlarmClock. Рұқсат жоқ болса, ең жақын баламаға түсеміз. */
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        PendingIntent fire = broadcast(c, ACTION_FIRE, RQ_FIRE);
        if (exact) {
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(next, showIntent(c)), fire);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Log.w(TAG, "дәл оятқыш рұқсаты жоқ — setAndAllowWhileIdle қолданылды");
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, fire);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, next, fire);
        }

        /* Дайындық: 10 минут бұрын процесті тірілтеміз */
        long prep = next - PREPARE_LEAD_MS;
        if (prep > System.currentTimeMillis()) {
            PendingIntent pi = broadcast(c, ACTION_PREPARE, RQ_PREPARE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, prep, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, prep, pi);
            }
        }
        Log.i(TAG, "жоспарланды: " + stamp(next) + (exact ? " (alarm clock)" : " (дәл емес)"));
    }

    static void cancel(Context c) {
        AlarmManager am = am(c);
        if (am == null) return;
        am.cancel(broadcast(c, ACTION_FIRE, RQ_FIRE));
        am.cancel(broadcast(c, ACTION_PREPARE, RQ_PREPARE));
    }

    /** «2026-09-02 07:00» — қайталанып соқпауы үшін белгі. */
    static String stamp(long at) {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(new Date(at));
    }

    /** Келесі соғу сәті — JS-ке көрсету үшін (0 = жоқ). */
    static long nextTrigger(Context c) {
        return AlarmStore.nextTrigger(c, System.currentTimeMillis());
    }
}
