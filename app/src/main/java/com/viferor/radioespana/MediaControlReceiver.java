package com.viferor.radioespana;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;

public class MediaControlReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (PodcastMediaController.ACTION_WIDGET_VOLUME_DOWN.equals(action) ||
                PodcastMediaController.ACTION_WIDGET_VOLUME_UP.equals(action)) {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int direction = PodcastMediaController.ACTION_WIDGET_VOLUME_UP.equals(action)
                        ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER;
                if (android.os.Build.VERSION.SDK_INT >= 26) {
                    am.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI);
                } else {
                    am.adjustVolume(direction, AudioManager.FLAG_SHOW_UI);
                }
            }
            WidgetProvider.updateAll(context);
            return;
        }
        // Playback is already owned by the live WebView while audio is playing.
        // Do not bring the application to the foreground just to execute a control.
        MainActivity.dispatchMediaActionToActive(action);
    }
}
