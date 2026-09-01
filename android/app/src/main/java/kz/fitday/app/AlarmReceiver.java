package kz.fitday.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Оятқыш дабылын қабылдайды.
 *
 * FIRE    — уақыт келді: соғуды бастайтын foreground service іске қосылады
 *           және КЕЛЕСІ соғу бірден жоспарланады (setAlarmClock бір реттік).
 * PREPARE — соғуға 10 минут қалды: процесті тірілтіп, service-ті «күту»
 *           режимінде қосамыз, жүйе оны өлтірмесін.
 */
public class AlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        Log.i(AlarmScheduler.TAG, "дабыл келді: " + action);
        if (action == null) return;

        if (AlarmScheduler.ACTION_PREPARE.equals(action)) {
            if (AlarmStore.enabled(context)) {
                start(context, AlarmService.ACTION_PREPARE);
            }
            return;
        }

        if (AlarmScheduler.ACTION_FIRE.equals(action)) {
            if (!AlarmStore.enabled(context)) return;

            String stamp = AlarmScheduler.stamp(System.currentTimeMillis());
            /* Бір минут ішінде екі рет келсе (жүйе қайталауы), екінші ретін елемейміз */
            if (stamp.equals(AlarmStore.lastFire(context))) {
                Log.i(AlarmScheduler.TAG, "қайталанған дабыл еленбеді: " + stamp);
                return;
            }
            AlarmStore.setLastFire(context, stamp);
            AlarmStore.setPendingRing(context, stamp);
            start(context, AlarmService.ACTION_RING);

            /* setAlarmClock бір реттік — келесі күнді дереу жоспарлаймыз */
            AlarmScheduler.reschedule(context);
        }
    }

    private void start(Context c, String action) {
        Intent svc = new Intent(c, AlarmService.class).setAction(action);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                c.startForegroundService(svc);
            } else {
                c.startService(svc);
            }
        } catch (Exception e) {
            /* Фондық шектеу қызметті бастауға жол бермесе, оятқыш мүлдем
               үнсіз қалмауы үшін кемінде хабарламаны көрсетеміз. */
            Log.e(AlarmScheduler.TAG, "қызмет іске қосылмады: " + e.getMessage());
            if (AlarmService.ACTION_RING.equals(action)) {
                AlarmNotifications.showRingNotification(c, true);
            }
        }
    }
}
