package kz.fitday.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Телефон қайта қосылғанда (немесе қосымша жаңартылғанда) оятқышты қайта
 * жоспарлайды. AlarmManager-дегі дабылдар өшіру кезінде жоғалады, ал баптау
 * SharedPreferences-те сақталғандықтан, WebView-сіз-ақ қалпына келтіріледі.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        Log.i(AlarmScheduler.TAG, "жүйе оқиғасы: " + action);
        if (action == null) return;

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            AlarmScheduler.reschedule(context);
        }
    }
}
