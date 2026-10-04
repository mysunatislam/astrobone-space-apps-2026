package com.mysunatislam.astrobone;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AstroBoneVoicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
