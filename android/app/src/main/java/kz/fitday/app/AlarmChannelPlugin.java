package kz.fitday.app;

import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * ОЯТҚЫШТЫҢ НАТИВТІ ЖАҒЫ — JS-тен басқарылады.
 *
 * Бүкіл жоспарлау осында: JS тек баптауды береді, ал уақытты есептеу,
 * AlarmManager-ге қою, қайта жоспарлау — бәрі нативте. Себебі қосымша
 * жабылғанда JS мүлдем жүрмейді.
 */
@CapacitorPlugin(
        name = "AlarmChannel",
        /* Android 13+ хабарлама рұқсаты. Осы жариялау арқасында Capacitor
           checkPermissions()/requestPermissions() әдістерін өзі жасайды. */
        permissions = {
                @Permission(alias = "notifications",
                        strings = { "android.permission.POST_NOTIFICATIONS" })
        })
public class AlarmChannelPlugin extends Plugin {

    /**
     * setAlarm({ enabled, hour, minute, days: "1,2,3,4,5", voice, math, vibro })
     * Баптауды сақтап, келесі соғуды қайта жоспарлайды.
     */
    @PluginMethod
    public void setAlarm(PluginCall call) {
        Context c = getContext();
        AlarmNotifications.ensureChannels(c);

        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Integer hour = call.getInt("hour", 7);
        Integer minute = call.getInt("minute", 0);
        String days = call.getString("days", "");
        String voice = call.getString("voice", "classic");
        boolean math = Boolean.TRUE.equals(call.getBoolean("math", true));
        boolean vibro = Boolean.TRUE.equals(call.getBoolean("vibro", true));

        AlarmStore.save(c, enabled, hour == null ? 7 : hour, minute == null ? 0 : minute,
                days, voice, math, vibro);
        AlarmScheduler.reschedule(c);

        long next = AlarmScheduler.nextTrigger(c);
        call.resolve(new JSObject()
                .put("scheduled", next > 0)
                .put("nextTrigger", next)
                .put("nextLabel", next > 0 ? AlarmScheduler.stamp(next) : ""));
    }

    /** Жоспарланған оятқышты толық өшіру. */
    @PluginMethod
    public void cancelAlarm(PluginCall call) {
        AlarmScheduler.cancel(getContext());
        call.resolve();
    }

    /** Соғып тұрған оятқышты тоқтату (тапсырма шешілгенде). */
    @PluginMethod
    public void stopRinging(PluginCall call) {
        AlarmService.stop(getContext());
        AlarmStore.consumePendingRing(getContext());
        call.resolve();
    }

    /**
     * Қосымша ашылғанда: оятқыш соққан ба, оны бет әлі көрсеткен жоқ па?
     * Белгі бір рет қана қайтарылады.
     */
    @PluginMethod
    public void consumePendingRing(PluginCall call) {
        Context c = getContext();
        String stamp = AlarmStore.consumePendingRing(c);
        call.resolve(new JSObject()
                .put("pending", stamp != null)
                .put("stamp", stamp == null ? "" : stamp)
                .put("ringing", AlarmStore.isRinging(c)));
    }

    /** Ағымдағы күй — баптаулар бетінде көрсету үшін. */
    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        long next = AlarmScheduler.nextTrigger(c);
        call.resolve(new JSObject()
                .put("enabled", AlarmStore.enabled(c))
                .put("nextTrigger", next)
                .put("nextLabel", next > 0 ? AlarmScheduler.stamp(next) : "")
                .put("ringing", AlarmStore.isRinging(c))
                .put("exactAllowed", exactAllowed())
                .put("batteryUnrestricted", batteryUnrestricted())
                .put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER));
    }

    /* ---------- Рұқсаттар ---------- */

    private boolean exactAllowed() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    private boolean batteryUnrestricted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void canScheduleExact(PluginCall call) {
        call.resolve(new JSObject().put("granted", exactAllowed()));
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            call.resolve(new JSObject().put("opened", false));
            return;
        }
        open(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:" + getContext().getPackageName())));
        call.resolve(new JSObject().put("opened", true));
    }

    @PluginMethod
    public void isBatteryUnrestricted(PluginCall call) {
        call.resolve(new JSObject().put("granted", batteryUnrestricted()));
    }

    /**
     * Батарея оптимизациясынан шығаруды сұрайды. Жүйе диалогын көрсетеді —
     * бұл рұқсатсыз Doze режимі процесті ұйықтатып, оятқышты кешіктіруі мүмкін.
     */
    @PluginMethod
    public void requestBatteryUnrestricted(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || batteryUnrestricted()) {
            call.resolve(new JSObject().put("opened", false));
            return;
        }
        open(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName())));
        call.resolve(new JSObject().put("opened", true));
    }

    /** Қосымшаның жүйелік баптау беті — «Автозапуск» сол жерде болады. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName())));
        call.resolve();
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        open(i);
        call.resolve();
    }

    private void open(Intent i) {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            /* Кейбір өндірушіде мұндай бет жоқ — үнсіз өтеміз */
        }
    }
}
