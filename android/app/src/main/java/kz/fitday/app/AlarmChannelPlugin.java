package kz.fitday.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * ОЯТҚЫШ АРНАЛАРЫ.
 *
 * Неге өз плагині керек: @capacitor/local-notifications арнаны
 * AudioAttributes.USAGE_NOTIFICATION атрибутымен жасайды — сонда дыбыс
 * ХАБАРЛАМА деңгейімен шығады. Телефонда хабарлама дыбысы басылып тұрса,
 * оятқыш естілмей қалады. Мұнда USAGE_ALARM қолданылады: дыбыс ОЯТҚЫШ
 * деңгейімен шығады (әдетте ол ең қатты әрі «үнсіз» режимде де жұмыс істейді).
 *
 * Қосымша: стандартты плагин діріл ырғағын бере алмайды (тек қосу/өшіру),
 * ал мұнда нақты pattern беріледі.
 *
 * Android арнаның баптауын ЖАСАЛҒАННАН КЕЙІН өзгертпейді. Сондықтан арна
 * идентификаторында нұсқа бар (…_v1) — дыбыс не діріл өзгерсе, нұсқаны
 * көтеру керек, әйтпесе ескі баптау қалып қояды.
 */
@CapacitorPlugin(name = "AlarmChannel")
public class AlarmChannelPlugin extends Plugin {

    /** Арна баптауы өзгерсе осыны көтер — Android ескісін жаңартпайды. */
    private static final String VERSION = "v1";
    private static final String PREFIX = "fitday_alarm_";

    /** JS-тен келген id үшін арнаның толық идентификаторы. */
    public static String channelId(String voiceId) {
        return PREFIX + voiceId + "_" + VERSION;
    }

    /**
     * create({ voices: [{ id, name, sound }], vibration: [0, 500, 250, 500] })
     * Әр дауысқа бөлек арна жасайды. Бар арнаны қайта жасау зиянсыз.
     */
    @PluginMethod
    public void create(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // Android 8-ге дейін арна жоқ — дыбысты хабарламаның өзі белгілейді
            call.resolve(new JSObject().put("created", 0).put("channelsSupported", false));
            return;
        }
        JSArray voices = call.getArray("voices");
        if (voices == null) {
            call.reject("voices тізімі берілмеген");
            return;
        }
        long[] pattern = longArray(call.getArray("vibration"));

        NotificationManager nm = (NotificationManager)
                getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        String pkg = getContext().getPackageName();

        AudioAttributes attrs = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)          // ← оятқыш ағыны
                .build();

        JSArray made = new JSArray();
        int created = 0;
        try {
            List<Object> list = voices.toList();
            for (Object item : list) {
                JSObject v = JSObject.fromJSONObject(new org.json.JSONObject(item.toString()));
                String id = v.getString("id");
                String name = v.getString("name", id);
                String sound = v.getString("sound");
                if (id == null || sound == null) continue;

                String chanId = channelId(id);
                NotificationChannel ch = new NotificationChannel(
                        chanId, name, NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("FitDay оятқышы: " + name);

                int resId = getContext().getResources().getIdentifier(
                        baseName(sound), "raw", pkg);
                if (resId == 0) {
                    call.reject("res/raw ішінде дыбыс табылмады: " + sound);
                    return;
                }
                ch.setSound(Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE
                        + "://" + pkg + "/raw/" + baseName(sound)), attrs);

                if (pattern != null && pattern.length > 0) {
                    ch.setVibrationPattern(pattern);
                    ch.enableVibration(true);
                } else {
                    ch.enableVibration(true);
                }
                ch.enableLights(true);
                ch.setLightColor(0xFFD9F24E);
                ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                ch.setBypassDnd(true);   // тек «Мазаламау» рұқсаты берілсе әсер етеді
                ch.setShowBadge(false);

                nm.createNotificationChannel(ch);
                made.put(chanId);
                created++;
            }
        } catch (Exception e) {
            call.reject("арна жасау қатесі: " + e.getMessage(), e);
            return;
        }
        call.resolve(new JSObject()
                .put("created", created)
                .put("channels", made)
                .put("channelsSupported", true));
    }

    /** Дәл уақытты оятқыш қоюға рұқсат бар ма (Android 12+ тексереді). */
    @PluginMethod
    public void canScheduleExact(PluginCall call) {
        boolean ok = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            ok = am != null && am.canScheduleExactAlarms();
        }
        call.resolve(new JSObject().put("granted", ok));
    }

    /** Рұқсат жоқ болса — жүйелік баптау бетін ашады. */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            call.resolve(new JSObject().put("opened", false));
            return;
        }
        Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve(new JSObject().put("opened", true));
    }

    /** Пайдаланушы қосымшаның хабарлама баптауын ашады (арна дыбысын тексеру үшін). */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** «alarm_classic.mp3» -> «alarm_classic» */
    private static String baseName(String sound) {
        String n = sound;
        int slash = n.lastIndexOf('/');
        if (slash >= 0) n = n.substring(slash + 1);
        int dot = n.lastIndexOf('.');
        if (dot >= 0) n = n.substring(0, dot);
        return n;
    }

    private static long[] longArray(JSArray arr) {
        if (arr == null) return null;
        try {
            List<Object> l = arr.toList();
            long[] out = new long[l.size()];
            for (int i = 0; i < l.size(); i++) out[i] = ((Number) l.get(i)).longValue();
            return out;
        } catch (Exception e) {
            return null;
        }
    }
}
