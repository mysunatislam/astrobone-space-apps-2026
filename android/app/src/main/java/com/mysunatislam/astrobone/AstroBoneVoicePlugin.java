package com.mysunatislam.astrobone;

import android.speech.tts.TextToSpeech;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.UUID;

@CapacitorPlugin(name = "AstroBoneVoice")
public class AstroBoneVoicePlugin extends Plugin {
    private TextToSpeech textToSpeech;
    private volatile boolean ready = false;

    @Override
    public void load() {
        textToSpeech = new TextToSpeech(getContext(), status -> {
            if (status != TextToSpeech.SUCCESS || textToSpeech == null) {
                ready = false;
                return;
            }
            int languageResult = textToSpeech.setLanguage(Locale.getDefault());
            if (languageResult == TextToSpeech.LANG_MISSING_DATA
                    || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                languageResult = textToSpeech.setLanguage(Locale.US);
            }
            ready = languageResult != TextToSpeech.LANG_MISSING_DATA
                    && languageResult != TextToSpeech.LANG_NOT_SUPPORTED;
        });
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", ready);
        result.put("backend", "Android TextToSpeech");
        call.resolve(result);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("Text is required.");
            return;
        }
        if (!ready || textToSpeech == null) {
            call.reject("Android text-to-speech is still initializing or unavailable.");
            return;
        }

        float rate = clamp(call.getFloat("rate", 0.94f), 0.5f, 1.5f);
        float pitch = clamp(call.getFloat("pitch", 1.0f), 0.5f, 1.5f);
        String queueMode = call.getString("queueMode", "add");
        int queue = "flush".equals(queueMode)
                ? TextToSpeech.QUEUE_FLUSH
                : TextToSpeech.QUEUE_ADD;

        getActivity().runOnUiThread(() -> {
            textToSpeech.setSpeechRate(rate);
            textToSpeech.setPitch(pitch);
            int status = textToSpeech.speak(
                    text,
                    queue,
                    null,
                    "astrobone-" + UUID.randomUUID()
            );
            if (status == TextToSpeech.SUCCESS) {
                call.resolve();
            } else {
                call.reject("Android text-to-speech could not queue the alert.");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (textToSpeech != null) {
            textToSpeech.stop();
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        ready = false;
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
    }

    private static float clamp(float value, float minimum, float maximum) {
        return Math.min(maximum, Math.max(minimum, value));
    }
}
