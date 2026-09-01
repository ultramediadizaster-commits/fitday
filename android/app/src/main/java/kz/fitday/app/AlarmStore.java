package kz.fitday.app;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Calendar;

/**
 * ОЯТҚЫШ БАПТАУЫН САҚТАУ.
 *
 * WebView-дің localStorage-і қосымша ашылғанда ғана қолжетімді. Ал оятқышты
 * телефон қайта қосылғанда немесе қосымша өлтірілген соң қайта жоспарлау
 * керек — сол сәтте WebView жоқ. Сондықтан баптау SharedPreferences-те
 * бөлек сақталады: оны BroadcastReceiver де, Service де оқи алады.
 */
final class AlarmStore {

    private static final String PREFS = "fitday_alarm";

    private static final String K_ENABLED = "enabled";
    private static final String K_HOUR = "hour";
    private static final String K_MINUTE = "minute";
    private static final String K_DAYS = "days";          // "1,2,3,4,5" (0 = жексенбі)
    private static final String K_VOICE = "voice";        // classic | siren | ... | random
    private static final String K_MATH = "math";
    private static final String K_VIBRO = "vibro";
    private static final String K_PENDING = "pendingRing";   // ашылмаған соғу белгісі
    private static final String K_RINGING = "ringing";
    private static final String K_LAST_FIRE = "lastFire";

    private AlarmStore() { }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void save(Context c, boolean enabled, int hour, int minute, String days,
                     String voice, boolean math, boolean vibro) {
        prefs(c).edit()
                .putBoolean(K_ENABLED, enabled)
                .putInt(K_HOUR, hour)
                .putInt(K_MINUTE, minute)
                .putString(K_DAYS, days == null ? "" : days)
                .putString(K_VOICE, voice == null ? "classic" : voice)
                .putBoolean(K_MATH, math)
                .putBoolean(K_VIBRO, vibro)
                .apply();
    }

    static boolean enabled(Context c) { return prefs(c).getBoolean(K_ENABLED, false); }
    static int hour(Context c) { return prefs(c).getInt(K_HOUR, 7); }
    static int minute(Context c) { return prefs(c).getInt(K_MINUTE, 0); }
    static boolean math(Context c) { return prefs(c).getBoolean(K_MATH, true); }
    static boolean vibro(Context c) { return prefs(c).getBoolean(K_VIBRO, true); }
    static String voice(Context c) { return prefs(c).getString(K_VOICE, "classic"); }

    /** Таңдалған күндер: 0 = жексенбі … 6 = сенбі. */
    static boolean[] days(Context c) {
        boolean[] out = new boolean[7];
        String raw = prefs(c).getString(K_DAYS, "");
        if (raw == null || raw.isEmpty()) return out;
        for (String part : raw.split(",")) {
            try {
                int d = Integer.parseInt(part.trim());
                if (d >= 0 && d < 7) out[d] = true;
            } catch (NumberFormatException ignored) { /* бүлінген жазба — өткіземіз */ }
        }
        return out;
    }

    static boolean anyDay(Context c) {
        for (boolean d : days(c)) if (d) return true;
        return false;
    }

    /**
     * Келесі соғу сәті (мс). Оятқыш өшірулі не күн таңдалмаған болса — 0.
     * from-нан кейінгі ЕҢ ЖАҚЫН сәйкес күн мен уақыт табылады.
     */
    static long nextTrigger(Context c, long from) {
        if (!enabled(c)) return 0L;
        return nextTriggerAt(hour(c), minute(c), days(c), from);
    }

    /**
     * Таза есеп — Context-сіз, сондықтан бірлік тестпен тексеріледі
     * (AlarmStoreTest). Жоспарлаудың бүкіл логикасы осында.
     */
    static long nextTriggerAt(int hour, int minute, boolean[] days, long from) {
        if (days == null) return 0L;
        boolean any = false;
        for (boolean d : days) if (d) { any = true; break; }
        if (!any) return 0L;

        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(from);
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, minute);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        /* Бүгінгі уақыт өтіп кетсе, ертеңнен бастаймыз */
        if (cal.getTimeInMillis() <= from) cal.add(Calendar.DAY_OF_YEAR, 1);
        for (int i = 0; i < 8; i++) {
            int dow = cal.get(Calendar.DAY_OF_WEEK) - 1;      // Calendar: 1 = жексенбі
            if (days[dow]) return cal.getTimeInMillis();
            cal.add(Calendar.DAY_OF_YEAR, 1);
        }
        return 0L;
    }

    /** «HH:MM» — хабарлама мәтіні үшін. */
    static String timeLabel(Context c) {
        return String.format(java.util.Locale.US, "%02d:%02d", hour(c), minute(c));
    }

    /* ---------- Соғу күйі: нативтен JS-ке хабар ---------- */

    /** Оятқыш соқты, бірақ бет оны әлі көрсеткен жоқ. */
    static void setPendingRing(Context c, String stamp) {
        prefs(c).edit().putString(K_PENDING, stamp).apply();
    }
    /** JS оқып алды — белгіні өшіреміз (екі рет ашылмас үшін). */
    static String consumePendingRing(Context c) {
        String v = prefs(c).getString(K_PENDING, null);
        if (v != null) prefs(c).edit().remove(K_PENDING).apply();
        return v;
    }

    static void setRinging(Context c, boolean on) {
        prefs(c).edit().putBoolean(K_RINGING, on).apply();
    }
    static boolean isRinging(Context c) { return prefs(c).getBoolean(K_RINGING, false); }

    static void setLastFire(Context c, String stamp) {
        prefs(c).edit().putString(K_LAST_FIRE, stamp).apply();
    }
    static String lastFire(Context c) { return prefs(c).getString(K_LAST_FIRE, ""); }
}
