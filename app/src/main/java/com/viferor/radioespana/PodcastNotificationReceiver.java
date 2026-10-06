package com.viferor.radioespana;

import android.content.BroadcastReceiver;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.text.Html;
import android.text.TextUtils;

import java.io.BufferedInputStream;
import java.io.ByteArrayInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

public class PodcastNotificationReceiver extends BroadcastReceiver {
    private static final String PREFS_NAME = "radio_viferor_prefs";
    private static final String PREF_PODCAST_SUBS = "podcast_subscriptions_json";
    private static final String PREF_INITIALIZED = "podcast_notifications_initialized";
    private static final String PREF_LAST_PREFIX = "podcast_last_";
    private static final String CHANNEL_ID = "podcast_new_episodes";

    @Override public void onReceive(Context context, Intent intent) {
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try { check(context.getApplicationContext()); }
            finally { pending.finish(); }
        }, "PodcastNotifications").start();
    }

    private static void check(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String json = prefs.getString(PREF_PODCAST_SUBS, "[]");
        List<Subscription> subs = parseSubscriptions(json);
        if (subs.isEmpty()) return;

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // areNotificationsEnabled() requires API 24. Keep minSdk 23.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !nm.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) return;

        createChannel(context);
        boolean initialized = prefs.getBoolean(PREF_INITIALIZED, false);
        int notifications = 0;
        SharedPreferences.Editor editor = prefs.edit();

        for (Subscription sub : subs) {
            if (TextUtils.isEmpty(sub.feedUrl)) continue;
            FeedResult feed = fetchFeed(sub.feedUrl);
            if (feed == null || TextUtils.isEmpty(feed.latestId)) continue;
            String key = PREF_LAST_PREFIX + Integer.toHexString(sub.feedUrl.toLowerCase().hashCode());
            String previous = prefs.getString(key, "");
            editor.putString(key, feed.latestId);

            // Primera comprobación: solo establece el punto de partida y no bombardea al usuario.
            if (!initialized || TextUtils.isEmpty(previous) || previous.equals(feed.latestId)) continue;

            showNotification(context, sub.title, feed.latestTitle, feed.latestUrl, notifications++);
            if (notifications >= 5) break;
        }
        editor.putBoolean(PREF_INITIALIZED, true).apply();
    }

    private static void showNotification(Context context, String podcast, String episode, String url, int id) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (!TextUtils.isEmpty(url)) open.putExtra("podcastEpisodeUrl", url);
        PendingIntent pi = PendingIntent.getActivity(context, 2000 + id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        b.setSmallIcon(com.viferor.radioespana.R.mipmap.ic_launcher)
                .setContentTitle("Nuevo episodio · " + (podcast == null ? "Podcast" : podcast))
                .setContentText(episode == null ? "Hay un episodio nuevo" : episode)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(Notification.PRIORITY_DEFAULT);
        nm.notify(3000 + id, b.build());
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Nuevos episodios", NotificationManager.IMPORTANCE_DEFAULT));
    }

    private static FeedResult fetchFeed(String feedUrl) {
        HttpURLConnection c = null;
        try {
            URL u = new URL(feedUrl);
            c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(10000); c.setReadTimeout(15000); c.setRequestMethod("GET");
            c.setRequestProperty("User-Agent", "RadioEspana/1.4.38 Android podcast-notifications");
            c.setRequestProperty("Accept-Encoding", "identity");
            c.setRequestProperty("Accept", "application/rss+xml, application/atom+xml, application/xml, text/xml, */*");
            c.setInstanceFollowRedirects(true);
            if (c.getResponseCode() < 200 || c.getResponseCode() >= 400) return null;
            try (BufferedInputStream in = new BufferedInputStream(c.getInputStream())) {
                DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
                f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
                Document d = f.newDocumentBuilder().parse(in);
                NodeList items = d.getElementsByTagName("item");
                if (items.getLength() == 0) items = d.getElementsByTagName("entry");
                if (items.getLength() == 0) return null;
                Element item = (Element) items.item(0);
                String title = text(item, "title");
                String guid = text(item, "guid");
                if (TextUtils.isEmpty(guid)) guid = text(item, "id");
                String link = text(item, "link");
                if (TextUtils.isEmpty(link)) {
                    NodeList links = item.getElementsByTagName("link");
                    if (links.getLength() > 0) link = ((Element)links.item(0)).getAttribute("href");
                }
                if (TextUtils.isEmpty(guid)) guid = link;
                return new FeedResult(guid, title, link);
            }
        } catch (Exception ignored) { return null; }
        finally { if (c != null) c.disconnect(); }
    }

    private static String text(Element e, String tag) {
        NodeList n = e.getElementsByTagName(tag);
        if (n.getLength() == 0) return "";
        return n.item(0).getTextContent().trim();
    }

    private static List<Subscription> parseSubscriptions(String json) {
        List<Subscription> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(json == null ? "[]" : json);
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.optJSONObject(i);
                if (o == null) continue;
                String feed = o.optString("feedUrl", "").trim();
                String title = o.optString("title", "Podcast").trim();
                if (!feed.isEmpty()) out.add(new Subscription(title, feed));
            }
        } catch (Exception ignored) {}
        return out;
    }

    private static class Subscription { final String title, feedUrl; Subscription(String t,String f){title=t;feedUrl=f;} }
    private static class FeedResult { final String latestId, latestTitle, latestUrl; FeedResult(String i,String t,String u){latestId=i;latestTitle=t;latestUrl=u;} }
}
