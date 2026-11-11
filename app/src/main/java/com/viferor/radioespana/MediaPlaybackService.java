package com.viferor.radioespana;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * Servicio en primer plano mientras hay una radio o un podcast en curso.
 *
 * El audio lo reproduce el WebView; este servicio existe para que Android no cierre
 * el proceso con la pantalla apagada o la app en segundo plano. Mientras suena
 * mantiene bloqueos de CPU y Wi-Fi para que el stream no se corte.
 *
 * Importante (antes era la causa de los cortes): desde Android 12 una app en segundo
 * plano NO puede volver a poner un servicio en primer plano. Por eso, al pausar, el
 * servicio NO se detiene: suelta los bloqueos pero sigue en primer plano durante
 * PAUSE_GRACE_MS. Así, tras una notificación, una llamada o un corte de red, la
 * reproducción puede reanudarse sin que Android lo impida. Pasado ese tiempo en pausa
 * sale de primer plano (la notificación se queda y su botón ▶ vuelve a arrancarlo).
 */
public class MediaPlaybackService extends Service {
    private static final String ACTION_SHOW = "com.viferor.radioespana.PLAYBACK_SHOW";
    private static final long PAUSE_GRACE_MS = 15L * 60L * 1000L;

    private static volatile MediaPlaybackService instance;
    private static volatile Notification pendingNotification;
    private static volatile int pendingId;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable graceExpired = this::stopAfterLongPause;
    private boolean foreground;
    private boolean noisyRegistered;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    // Auriculares desconectados / Bluetooth apagado: se pausa en vez de pasar al altavoz.
    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                MainActivity.dispatchMediaActionToActive(PodcastMediaController.ACTION_WIDGET_PAUSE);
            }
        }
    };

    public static boolean isRunning() {
        return instance != null && instance.foreground;
    }

    /**
     * Reproducción activa: pone el servicio en primer plano o, si ya lo está (también
     * durante el margen de pausa), solo actualiza la notificación sin pedir permiso a
     * Android. Devuelve false si Android no permitió arrancarlo.
     */
    public static boolean show(Context context, int id, Notification notification) {
        pendingNotification = notification;
        pendingId = id;
        MediaPlaybackService s = instance;
        if (s != null && s.foreground) {
            s.onPlaying(id, notification);
            return true;
        }
        Intent i = new Intent(context, MediaPlaybackService.class).setAction(ACTION_SHOW);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i);
            else context.startService(i);
            return true;
        } catch (Exception e) {
            // Android 12+ en segundo plano sin exención: el llamante publica la notificación normal.
            return false;
        }
    }

    /** En pausa: sigue en primer plano un rato (ver PAUSE_GRACE_MS) y suelta los bloqueos. */
    public static void pause(Context context, int id, Notification notification) {
        MediaPlaybackService s = instance;
        if (s != null && s.foreground) s.onPaused(id, notification);
    }

    /** Fin de la reproducción (se cierra la app): se retira todo. */
    public static void stop(Context context) {
        MediaPlaybackService s = instance;
        if (s != null) s.stopAll();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        Notification n = pendingNotification;
        if (!ACTION_SHOW.equals(action) || n == null) {
            // Reinicio del sistema sin datos: no hay nada que mostrar.
            if (!foreground) stopSelf(startId);
            return START_NOT_STICKY;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(pendingId, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(pendingId, n);
            }
            foreground = true;
            onPlaying(pendingId, n);
        } catch (Exception e) {
            foreground = false;
            stopSelf(startId);
        }
        return START_NOT_STICKY;
    }

    private void onPlaying(int id, Notification n) {
        handler.removeCallbacks(graceExpired);
        notify(id, n);
        acquireLocks();
        registerNoisy();
    }

    private void onPaused(int id, Notification n) {
        notify(id, n);
        releaseLocks();
        unregisterNoisy();
        handler.removeCallbacks(graceExpired);
        handler.postDelayed(graceExpired, PAUSE_GRACE_MS);
    }

    private void stopAfterLongPause() {
        releaseLocks();
        unregisterNoisy();
        leaveForeground(false);
        stopSelf();
    }

    private void stopAll() {
        handler.removeCallbacks(graceExpired);
        releaseLocks();
        unregisterNoisy();
        leaveForeground(true);
        stopSelf();
    }

    private void notify(int id, Notification n) {
        if (n == null) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(id, n);
        } catch (Exception ignored) {
        }
    }

    private void leaveForeground(boolean removeNotification) {
        foreground = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(removeNotification ? STOP_FOREGROUND_REMOVE : STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(removeNotification);
            }
        } catch (Exception ignored) {
        }
    }

    private void registerNoisy() {
        if (noisyRegistered) return;
        try {
            IntentFilter f = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisyReceiver, f, Context.RECEIVER_NOT_EXPORTED);
            else registerReceiver(noisyReceiver, f);
            noisyRegistered = true;
        } catch (Exception ignored) {
        }
    }

    private void unregisterNoisy() {
        if (!noisyRegistered) return;
        try {
            unregisterReceiver(noisyReceiver);
        } catch (Exception ignored) {
        }
        noisyRegistered = false;
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
        handler.removeCallbacks(graceExpired);
        foreground = false;
        releaseLocks();
        unregisterNoisy();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
