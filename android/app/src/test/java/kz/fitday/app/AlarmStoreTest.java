package kz.fitday.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Calendar;

/**
 * Келесі соғу сәтін есептеу — оятқыштың ең маңызды логикасы.
 * Құрылғысыз тексеріледі: gradlew testDebugUnitTest
 */
public class AlarmStoreTest {

    /** 0 = жексенбі … 6 = сенбі */
    private static boolean[] days(int... list) {
        boolean[] d = new boolean[7];
        for (int i : list) d[i] = true;
        return d;
    }

    private static long at(int year, int month, int day, int hour, int minute) {
        Calendar c = Calendar.getInstance();
        c.set(year, month - 1, day, hour, minute, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static Calendar cal(long ms) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return c;
    }

    @Test
    public void bugin_uaqyt_otpese_bugin_soqady() {
        // 2026-09-02 — сәрсенбі. Таңғы 05:00-де тұрмыз, оятқыш 07:00.
        long from = at(2026, 9, 2, 5, 0);
        long next = AlarmStore.nextTriggerAt(7, 0, days(1, 2, 3, 4, 5), from);
        Calendar c = cal(next);
        assertEquals(2, c.get(Calendar.DAY_OF_MONTH));
        assertEquals(7, c.get(Calendar.HOUR_OF_DAY));
        assertEquals(0, c.get(Calendar.MINUTE));
    }

    @Test
    public void bugingi_uaqyt_otse_kelesi_kunge_koshedi() {
        // Сәрсенбі 10:00 — 07:00 өтіп кеткен, келесісі бейсенбі
        long from = at(2026, 9, 2, 10, 0);
        long next = AlarmStore.nextTriggerAt(7, 0, days(1, 2, 3, 4, 5), from);
        Calendar c = cal(next);
        assertEquals(3, c.get(Calendar.DAY_OF_MONTH));
        assertEquals(Calendar.THURSDAY, c.get(Calendar.DAY_OF_WEEK));
    }

    @Test
    public void demalys_kunderi_attap_otiledi() {
        // Жұма 10:00, тек жұмыс күндері -> келесісі дүйсенбі (7 қыркүйек)
        long from = at(2026, 9, 4, 10, 0);
        long next = AlarmStore.nextTriggerAt(7, 0, days(1, 2, 3, 4, 5), from);
        Calendar c = cal(next);
        assertEquals(Calendar.MONDAY, c.get(Calendar.DAY_OF_WEEK));
        assertEquals(7, c.get(Calendar.DAY_OF_MONTH));
    }

    @Test
    public void bir_gana_kun_tandalsa_bir_apta_keyin() {
        // Жексенбі ғана. Жексенбі 08:00-де тұрмыз, 07:00 өтіп кеткен.
        long from = at(2026, 9, 6, 8, 0);          // 6 қыркүйек — жексенбі
        long next = AlarmStore.nextTriggerAt(7, 0, days(0), from);
        Calendar c = cal(next);
        assertEquals(Calendar.SUNDAY, c.get(Calendar.DAY_OF_WEEK));
        assertEquals(13, c.get(Calendar.DAY_OF_MONTH));   // келесі жексенбі
    }

    @Test
    public void kun_tandalmasa_noldi_qaytarady() {
        long from = at(2026, 9, 2, 5, 0);
        assertEquals(0L, AlarmStore.nextTriggerAt(7, 0, days(), from));
        assertEquals(0L, AlarmStore.nextTriggerAt(7, 0, null, from));
    }

    @Test
    public void naqty_sol_minutta_turgan_bolsaq_kelesige_koshedi() {
        // Дәл 07:00 — «<=» шарты бүгінгіні өткізіп жіберуі керек
        long from = at(2026, 9, 2, 7, 0);
        long next = AlarmStore.nextTriggerAt(7, 0, days(1, 2, 3, 4, 5), from);
        assertTrue("келесі соғу болашақта болуы керек", next > from);
        assertEquals(3, cal(next).get(Calendar.DAY_OF_MONTH));
    }

    @Test
    public void barlyq_kun_tandalsa_ertenge_koshedi() {
        long from = at(2026, 9, 2, 23, 30);
        long next = AlarmStore.nextTriggerAt(7, 0, days(0, 1, 2, 3, 4, 5, 6), from);
        Calendar c = cal(next);
        assertEquals(3, c.get(Calendar.DAY_OF_MONTH));
        assertEquals(7, c.get(Calendar.HOUR_OF_DAY));
    }

    @Test
    public void random_dauys_kunge_baylangan_turaqty_bolady() {
        String a = AlarmNotifications.resolveVoice("random", "2026-09-02");
        String b = AlarmNotifications.resolveVoice("random", "2026-09-02");
        String c = AlarmNotifications.resolveVoice("random", "2026-09-03");
        assertEquals("бір күнде әрқашан бірдей дауыс", a, b);
        assertTrue("пулдан алынуы керек",
                a.equals("classic") || a.equals("siren")
                        || a.equals("industrial") || a.equals("drip"));
        assertTrue(c != null);
    }

    @Test
    public void belgisiz_dauys_classic_ke_tusedi() {
        assertEquals("classic", AlarmNotifications.resolveVoice("joq-dauys", "2026-09-02"));
        assertEquals("siren", AlarmNotifications.resolveVoice("siren", "2026-09-02"));
    }
}
