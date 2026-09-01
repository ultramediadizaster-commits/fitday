package kz.fitday.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Оятқыш арналарын USAGE_ALARM атрибутымен жасайтын өз плагині
        registerPlugin(AlarmChannelPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
