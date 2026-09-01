package kz.fitday.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Оятқыш соққанда осы әрекетпен ашылады (толық экранды intent). */
    public static final String ACTION_SHOW_RING = "kz.fitday.app.SHOW_RING";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AlarmChannelPlugin.class);
        super.onCreate(savedInstanceState);
        applyAlarmWindowFlags(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        applyAlarmWindowFlags(intent);
    }

    /**
     * Оятқышпен ашылса, бет ҚҰЛЫПТАЛҒАН экранның үстінде көрінуі және экранды
     * өзі жағуы керек. Бұл тек оятқыш кезінде қосылады — әйтпесе қосымша
     * әрқашан құлып үстінен ашылып, қауіпсіздікті нашарлатар еді.
     */
    private void applyAlarmWindowFlags(Intent intent) {
        boolean fromAlarm = intent != null && ACTION_SHOW_RING.equals(intent.getAction());
        if (!fromAlarm) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
