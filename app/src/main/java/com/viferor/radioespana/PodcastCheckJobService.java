package com.viferor.radioespana;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Comprueba periódicamente si hay episodios nuevos en las suscripciones.
 *
 * Sustituye al antiguo PodcastNotificationReceiver (AlarmManager + goAsync), que
 * descargaba los feeds completos uno a uno dentro del tiempo límite de un
 * BroadcastReceiver y, con muchas suscripciones, el sistema lo cortaba a medias.
 *
 * Ahora se usa JobScheduler (solo con red y persistente tras reiniciar) y se
 * consulta /api/podcast-feed?meta=1, que devuelve solo el episodio más reciente
 * por fecha (no el primero del XML) y funciona también con feeds http://.
 */
public class PodcastCheckJobService extends JobService {
    static final String API_BASE = "https://radiosviferor.vercel.app/api/podcast-feed?meta=1&url=";
    private static final String PREFS_NAME = "radio_viferor_prefs";
    private static final String PREF_PODCAST_SUBS = "podcast_subscriptions_json";
    private static final String PREF_INITIALIZED = "podcast_notifications_initialized";
    private static final String PREF_LAST_PREFIX = "podcast_last_";
    // Canal silencioso: un aviso de episodio nuevo no debe cortar la radio que suena.
    // (El canal antiguo tenía sonido y Android no deja cambiarlo: se usa uno nuevo.)
    private static final String CHANNEL_ID = "podcast_new_episodes_silent";
    private static final String OLD_CHANNEL_ID = "podcast_new_episodes";
    private static final int MAX_NOTIFICATIONS = 5;

    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    @Override
    public boolean onStartJob(JobParameters params) {
        cancelled.set(false);
        final Context context = getApplicationContext();
        new Thread(() -> {
            boolean reschedule = false;
            try {
                check(context);
            } catch (Exception e) {
                reschedule = true;
            }
            if (!cancelled.get()) jobFinished(params, reschedule);
        }, "PodcastCheck").start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        cancelled.set(true);
        return true; // reintentar más tarde
    }

    private void check(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        List<Subscription> subs = parseSubscriptions(prefs.getString(PREF_PODCAST_SUBS, "[]"));
        if (subs.isEmpty()) return;

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        boolean canNotify = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !nm.areNotificationsEnabled()) canNotify = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) canNotify = false;

        createChannel(context);
        boolean initialized = prefs.getBoolean(PREF_INITIALIZED, false);
        int shown = 0;
        SharedPreferences.Editor editor = prefs.edit();
        for (Subscription sub : subs) {
            if (cancelled.get()) break;
            Latest latest = fetchLatest(sub.feedUrl);
            if (latest == null || TextUtils.isEmpty(latest.id)) continue;
            String key = PREF_LAST_PREFIX + Integer.toHexString(sub.feedUrl.toLowerCase().hashCode());
            String previous = prefs.getString(key, "");
            editor.putString(key, latest.id);
            // Primera comprobación de cada podcast: solo se anota el punto de partida.
            if (!initialized || TextUtils.isEmpty(previous) || previous.equals(latest.id)) continue;
            if (canNotify && shown < MAX_NOTIFICATIONS) {
                showNotification(context, sub, latest.title);
                shown++;
            }
        }
        editor.putBoolean(PREF_INITIALIZED, true).apply();
    }

    private static void showNotification(Context context, Subscription sub, String episode) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // Un id por podcast: un episodio nuevo sustituye al aviso anterior del mismo podcast.
        int id = 3000 + (sub.feedUrl.toLowerCase().hashCode() & 0x0FFFFFFF) % 100000;
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // Se envía la URL del feed: la web abre ese podcast (antes se enviaba la página
        // web del episodio, que nunca coincidía con ninguna suscripción).
        open.putExtra(MainActivity.EXTRA_PODCAST_FEED_URL, sub.feedUrl);
        PendingIntent pi = PendingIntent.getActivity(context, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        b.setSmallIcon(R.drawable.ic_stat_app)
                .setContentTitle("Nuevo episodio · " + (TextUtils.isEmpty(sub.title) ? "Podcast" : sub.title))
                .setContentText(TextUtils.isEmpty(episode) ? "Hay un episodio nuevo" : episode)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi);
        nm.notify(id, b.build());
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.deleteNotificationChannel(OLD_CHANNEL_ID); } catch (Exception ignored) {}
            NotificationChannel c = new NotificationChannel(CHANNEL_ID, "Nuevos episodios",
                    NotificationManager.IMPORTANCE_DEFAULT);
            c.setSound(null, null);
            c.enableVibration(false);
            c.setDescription("Aviso silencioso cuando un podcast al que estás suscrito publica un episodio");
            nm.createNotificationChannel(c);
        }
    }

    private static Latest fetchLatest(String feedUrl) {
        HttpURLConnection c = null;
        try {
            URL u = new URL(API_BASE + URLEncoder.encode(feedUrl, "UTF-8"));
            c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(20000);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "RadiosViferor-Android/podcast-check");
            if (c.getResponseCode() != 200) return null;
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n, total = 0;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > 512 * 1024) return null; // la respuesta meta=1 es pequeña
                    out.write(buf, 0, n);
                }
                JSONObject d = new JSONObject(out.toString("UTF-8"));
                JSONObject latest = d.optJSONObject("latest");
                if (latest == null) return null;
                String id = latest.optString("id", "");
                if (TextUtils.isEmpty(id)) id = latest.optString("audioUrl", "");
                return new Latest(id, latest.optString("title", ""));
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static List<Subscription> parseSubscriptions(String json) {
        List<Subscription> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json == null ? "[]" : json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                String feed = o.optString("feedUrl", "").trim();
                if (feed.isEmpty()) feed = o.optString("xmlUrl", "").trim();
                String title = o.optString("title", "Podcast").trim();
                if (feed.startsWith("http://") || feed.startsWith("https://")) out.add(new Subscription(title, feed));
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    private static final class Subscription {
        final String title, feedUrl;

        Subscription(String t, String f) {
            title = t;
            feedUrl = f;
        }
    }

    private static final class Latest {
        final String id, title;

        Latest(String i, String t) {
            id = i;
            title = t;
        }
    }
}
