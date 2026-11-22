package com.viferor.radioespana;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.util.List;

/**
 * Sabe por dónde sale la música (altavoz, auriculares con cable, Bluetooth…) y avisa a
 * la web cuando cambia, para que use los ajustes de sonido de esa salida.
 * window.onAndroidAudioOutput({type, name})
 */
final class AudioOutputWatcher {
    interface JsSink { void run(String js); }

    private final AudioManager am;
    private final JsSink js;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private String last = "";
    private final Runnable check = this::checkNow;

    private final AudioDeviceCallback callback = new AudioDeviceCallback() {
        @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) { schedule(); }
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) { schedule(); }
    };

    AudioOutputWatcher(Context c, JsSink js) {
        this.am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        this.js = js;
    }

    void start() {
        try {
            if (am != null) am.registerAudioDeviceCallback(callback, handler);
        } catch (Exception ignored) {}
    }

    void stop() {
        try {
            if (am != null) am.unregisterAudioDeviceCallback(callback);
        } catch (Exception ignored) {}
    }

    /** Al conectar o desconectar, Android tarda un momento en cambiar la ruta. */
    private void schedule() {
        handler.removeCallbacks(check);
        handler.postDelayed(check, 700);
    }

    void checkNow() {
        String now = current();
        if (now.equals(last)) return;
        last = now;
        js.run("window.onAndroidAudioOutput && window.onAndroidAudioOutput(" + now + ");");
    }

    /** JSON {type, name}: type = speaker | wired | usb | bluetooth | other. */
    String current() {
        AudioDeviceInfo d = null;
        if (am != null && Build.VERSION.SDK_INT >= 33) {
            try {
                AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
                List<AudioDeviceInfo> list = am.getAudioDevicesForAttributes(attrs);
                if (list != null && !list.isEmpty()) d = list.get(0);
            } catch (Exception ignored) {}
        }
        if (d == null && am != null) d = guess(am.getDevices(AudioManager.GET_DEVICES_OUTPUTS));
        JSONObject o = new JSONObject();
        try {
            String type = typeOf(d);
            o.put("type", type);
            String name = "";
            if (d != null && !"speaker".equals(type) && d.getProductName() != null) name = d.getProductName().toString().trim();
            if (name.equals(Build.MODEL)) name = "";
            o.put("name", name);
        } catch (Exception ignored) {}
        return o.toString();
    }

    // Sin la ruta exacta (Android 12 o anterior): Bluetooth > cable/USB > altavoz.
    private static AudioDeviceInfo guess(AudioDeviceInfo[] devs) {
        if (devs == null) return null;
        AudioDeviceInfo best = null;
        int bestRank = 0;
        for (AudioDeviceInfo d : devs) {
            int r;
            switch (d.getType()) {
                case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
                case 26: // TYPE_BLE_HEADSET
                case 27: // TYPE_BLE_SPEAKER
                case 23: // TYPE_HEARING_AID
                    r = 4; break;
                case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                case 22: // TYPE_USB_HEADSET
                case AudioDeviceInfo.TYPE_USB_DEVICE:
                    r = 3; break;
                case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
                    r = 1; break;
                default:
                    r = 0;
            }
            if (r > bestRank) {
                bestRank = r;
                best = d;
            }
        }
        return best;
    }

    private static String typeOf(AudioDeviceInfo d) {
        if (d == null) return "speaker";
        switch (d.getType()) {
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER:
            case 24: // TYPE_BUILTIN_SPEAKER_SAFE
            case AudioDeviceInfo.TYPE_BUILTIN_EARPIECE:
                return "speaker";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES:
                return "wired";
            case 22: // TYPE_USB_HEADSET
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
                return "usb";
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
            case 23: // TYPE_HEARING_AID
            case 26: // TYPE_BLE_HEADSET
            case 27: // TYPE_BLE_SPEAKER
            case 30: // TYPE_BLE_BROADCAST
                return "bluetooth";
            default:
                return "other";
        }
    }
}
