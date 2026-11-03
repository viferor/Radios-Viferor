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
        // La reproducción la lleva la web (dentro de MainActivity). Si la app ya no está
        // abierta, se abre con la orden: al cargar, empieza a sonar sin tocar nada más.
        if (!MainActivity.dispatchMediaActionToActive(action)) {
            if (arrancarReproduccion(action) && MainActivity.startWithMediaAction(context, action)) return;
            // La app ya no está abierta (el reproductor web no existe): se retira la
            // notificación en lugar de dejar un botón que no hace nada.
            MediaPlaybackService.stop(context);
            android.app.NotificationManager nm = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(PodcastMediaController.NOTIFICATION_ID);
            context.getSharedPreferences("radio_viferor_prefs", Context.MODE_PRIVATE).edit()
                    .putBoolean("widget_playing", false).putString("widget_subtitle", "Sin reproducción").apply();
            WidgetProvider.updateAll(context);
        }
    }

    /** ¿Esta orden tiene sentido si no hay nada sonando? (Pausar o buscar, no). */
    private static boolean arrancarReproduccion(String action) {
        return PodcastMediaController.ACTION_WIDGET_PLAY.equals(action)
                || PodcastMediaController.ACTION_WIDGET_NEXT.equals(action)
                || PodcastMediaController.ACTION_WIDGET_PREV.equals(action);
    }
}
