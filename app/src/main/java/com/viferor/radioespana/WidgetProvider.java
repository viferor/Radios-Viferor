package com.viferor.radioespana;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.widget.RemoteViews;

public class WidgetProvider extends AppWidgetProvider {
    private static final String PREFS_NAME = "radio_viferor_prefs";
    private static final String PREF_PLAYBACK_SECTION = "playback_section";
    public static final String ACTION_OPEN = "com.viferor.radioespana.WIDGET_OPEN";
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { updateAll(context); }
    public static void updateAll(Context context) { updateAll(context, null); }
    public static void updateAll(Context context, Object ignoredArtwork) {
        AppWidgetManager m = AppWidgetManager.getInstance(context);
        ComponentName cn = new ComponentName(context, WidgetProvider.class);
        int[] ids = m.getAppWidgetIds(cn);
        for (int id : ids) {
            RemoteViews v = buildViews(context);
            m.updateAppWidget(id, v);
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget_podcast);
        String section = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(PREF_PLAYBACK_SECTION, "radio");
        String type = PodcastMediaController.getWidgetType(context);
        boolean music = "music".equalsIgnoreCase(type);
        boolean podcast = "podcast".equalsIgnoreCase(type) || music;
        String rawTitle = PodcastMediaController.getWidgetTitle(context);
        String rawSubtitle = PodcastMediaController.getWidgetSubtitle(context);
        v.setTextViewText(R.id.widget_title, music ? "🎵 Música · " + rawTitle : podcast ? "🎙️ Podcast · " + rawTitle : "📻 Radio · " + rawTitle);
        v.setTextViewText(R.id.widget_subtitle, rawSubtitle);
        v.setTextViewText(R.id.widget_play, PodcastMediaController.getWidgetPlaying(context) ? "⏸" : "▶");
        v.setTextViewText(R.id.widget_back, podcast ? "−15" : "•");
        v.setTextViewText(R.id.widget_forward, podcast ? "+30" : "•");
        v.setTextViewText(R.id.widget_prev, podcast ? "⏮" : "•");
        v.setTextViewText(R.id.widget_next, podcast ? "⏭" : "•");
        v.setTextColor(R.id.widget_title, 0xFFFFFFFF);
        v.setTextColor(R.id.widget_subtitle, 0xFFDDDDDD);
        v.setTextColor(R.id.widget_prev, 0xFFFFFFFF);
        v.setTextColor(R.id.widget_back, 0xFFFFFFFF);
        v.setTextColor(R.id.widget_play, 0xFFFFFFFF);
        v.setTextColor(R.id.widget_forward, 0xFFFFFFFF);
        v.setTextColor(R.id.widget_next, 0xFFFFFFFF);
        v.setTextColor(R.id.widget_volume_down, 0xFFFFFFFF);
        v.setTextColor(R.id.widget_volume_up, 0xFFFFFFFF);
        v.setInt(R.id.widget_prev, "setBackgroundResource", R.drawable.widget_button_background);
        v.setInt(R.id.widget_back, "setBackgroundResource", R.drawable.widget_button_background);
        v.setInt(R.id.widget_play, "setBackgroundResource", R.drawable.widget_button_background);
        v.setInt(R.id.widget_forward, "setBackgroundResource", R.drawable.widget_button_background);
        v.setInt(R.id.widget_next, "setBackgroundResource", R.drawable.widget_button_background);
        v.setInt(R.id.widget_volume_down, "setBackgroundResource", R.drawable.widget_button_background);
        v.setInt(R.id.widget_volume_up, "setBackgroundResource", R.drawable.widget_button_background);
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        int maxVolume = am != null ? Math.max(1, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)) : 15;
        int currentVolume = am != null ? Math.max(0, am.getStreamVolume(AudioManager.STREAM_MUSIC)) : 0;
        v.setProgressBar(R.id.widget_volume, maxVolume, currentVolume, false);
        // Never send arbitrary podcast bitmaps through RemoteViews. Android applies
        // density scaling to widget bitmaps and can exceed the Binder bitmap limit.
        // Use the packaged app icon instead; this is always memory-safe.
        v.setImageViewResource(R.id.widget_watermark, R.mipmap.ic_launcher);
        Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("openSection", section);
        PendingIntent openApp = PendingIntent.getActivity(context, 490521, open,
                PendingIntent.FLAG_UPDATE_CURRENT | immutable());
        // The root contains a full-size child layout, so give the same open action
        // to the content area as well. The five control buttons install their own
        // PendingIntents below and therefore keep their direct actions.
        v.setOnClickPendingIntent(R.id.widget_root, openApp);
        v.setOnClickPendingIntent(R.id.widget_content, openApp);
        if (podcast) {
            v.setViewVisibility(R.id.widget_prev, android.view.View.VISIBLE);
            v.setViewVisibility(R.id.widget_back, android.view.View.VISIBLE);
            v.setViewVisibility(R.id.widget_forward, android.view.View.VISIBLE);
            v.setViewVisibility(R.id.widget_next, android.view.View.VISIBLE);
            set(v, context, R.id.widget_prev, PodcastMediaController.ACTION_WIDGET_PREV, 101);
            set(v, context, R.id.widget_back, PodcastMediaController.ACTION_WIDGET_BACK, 102);
            set(v, context, R.id.widget_forward, PodcastMediaController.ACTION_WIDGET_FORWARD, 104);
            set(v, context, R.id.widget_next, PodcastMediaController.ACTION_WIDGET_NEXT, 105);
        } else {
            // For live radio there are no podcast seek/queue actions. Hide them
            // instead of displaying decorative buttons that do nothing.
            v.setViewVisibility(R.id.widget_prev, android.view.View.GONE);
            v.setViewVisibility(R.id.widget_back, android.view.View.GONE);
            v.setViewVisibility(R.id.widget_forward, android.view.View.GONE);
            v.setViewVisibility(R.id.widget_next, android.view.View.GONE);
        }
        set(v, context, R.id.widget_play,
                PodcastMediaController.getWidgetPlaying(context)
                        ? PodcastMediaController.ACTION_WIDGET_PAUSE
                        : PodcastMediaController.ACTION_WIDGET_PLAY, 103);
        set(v, context, R.id.widget_volume_down, PodcastMediaController.ACTION_WIDGET_VOLUME_DOWN, 106);
        set(v, context, R.id.widget_volume_up, PodcastMediaController.ACTION_WIDGET_VOLUME_UP, 107);
        return v;
    }

    private static void set(RemoteViews v, Context c, int viewId, String action, int req) {
        Intent i = new Intent(c, MediaControlReceiver.class).setAction(action);
        v.setOnClickPendingIntent(viewId, PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | immutable()));
    }
    private static int immutable() { return android.os.Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0; }
}
