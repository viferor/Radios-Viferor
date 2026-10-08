package com.viferor.radioespana;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Servicio en primer plano mientras suena la radio o un podcast.
 *
 * El audio lo sigue reproduciendo el WebView; este servicio solo existe para que
 * Android no cierre el proceso con la pantalla apagada o la app en segundo plano.
 * Mantiene además un bloqueo de Wi-Fi y de CPU mientras hay reproducción, para que
 * el stream no se corte al dormirse el teléfono.
 *
 * La notificación la construye PodcastMediaController y se la pasa con show().
 * Al pausar se llama a pause(): el servicio deja de estar en primer plano (la
 * notificación queda y se puede descartar) y se detiene.
 */
public class MediaPlaybackService extends Service {
    private static final String ACTION_SHOW = "com.viferor.radioespana.PLAYBACK_SHOW";
    private static final String ACTION_PAUSE = "com.viferor.radioespana.PLAYBACK_PAUSE";
    private static final String ACTION_STOP = "com.viferor.radioespana.PLAYBACK_STOP";

    private static volatile boolean running;
    private static volatile Notification pendingNotification;
    private static volatile int pendingId;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    public static boolean isRunning() {
        return running;
    }

    /** Pone (o actualiza) el servicio en primer plano con esta notificación. */
    public static boolean show(Context context, int id, Notification notification) {
        pendingNotification = notification;
        pendingId = id;
        Intent i = new Intent(context, MediaPlaybackService.class).setAction(ACTION_SHOW);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i);
            else context.startService(i);
            return true;
        } catch (Exception e) {
            // Android 12+ puede denegar el inicio desde segundo plano. En ese caso el
            // llamante publica la notificación normal y el audio sigue sonando.
            return false;
        }
    }

    /** Sale de primer plano dejando la notificación (reproducción en pausa). */
    public static void pause(Context context) {
        sendIfRunning(context, ACTION_PAUSE);
    }

    /** Detiene el servicio y retira la notificación. */
    public static void stop(Context context) {
        sendIfRunning(context, ACTION_STOP);
    }

    private static void sendIfRunning(Context context, String action) {
        if (!running) return;
        // Se marca ya: si justo después hay que volver a mostrar (p. ej. pasa de la
        // radio a un podcast), show() relanzará el servicio en lugar de suponerlo activo.
        running = false;
        try {
            // startService (no startForegroundService): si el servicio no está en
            // marcha no hay nada que pausar, y así no se exige llamar a startForeground.
            context.startService(new Intent(context, MediaPlaybackService.class).setAction(action));
        } catch (Exception ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_SHOW.equals(action)) {
            Notification n = pendingNotification;
            if (n == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(pendingId, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(pendingId, n);
                }
                running = true;
                acquireLocks();
            } catch (Exception e) {
                stopSelf();
            }
            return START_NOT_STICKY;
        }
        // stopSelf(startId): si mientras tanto llegó otra orden de mostrar, el servicio
        // no se detiene.
        if (ACTION_PAUSE.equals(action)) {
            releaseLocks();
            leaveForeground(false);
            if (stopSelfResult(startId)) running = false;
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) {
            releaseLocks();
            leaveForeground(true);
            if (stopSelfResult(startId)) running = false;
            return START_NOT_STICKY;
        }
        // Reinicio del sistema sin intención explícita: no hay nada que mostrar.
        stopSelf(startId);
        return START_NOT_STICKY;
    }

    private void leaveForeground(boolean removeNotification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(removeNotification ? STOP_FOREGROUND_REMOVE : STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(removeNotification);
            }
        } catch (Exception ignored) {
        }
    }

    private void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RadiosViferor:playback");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();
        } catch (Exception ignored) {
        }
        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    @SuppressWarnings("deprecation")
                    int mode = WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                    wifiLock = wm.createWifiLock(mode, "RadiosViferor:playback");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (Exception ignored) {
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        running = false;
        releaseLocks();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
