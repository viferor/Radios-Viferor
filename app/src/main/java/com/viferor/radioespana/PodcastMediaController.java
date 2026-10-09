package com.viferor.radioespana;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.SystemClock;
import android.text.TextUtils;

import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Additive Android media controls for the existing WebView podcast player.
 * It does not replace or own the HTML audio element.
 */
public final class PodcastMediaController {
    public static final String ACTION_WIDGET_PLAY = "com.viferor.radioespana.WIDGET_PLAY";
    public static final String ACTION_WIDGET_PAUSE = "com.viferor.radioespana.WIDGET_PAUSE";
    public static final String ACTION_WIDGET_BACK = "com.viferor.radioespana.WIDGET_BACK";
    public static final String ACTION_WIDGET_FORWARD = "com.viferor.radioespana.WIDGET_FORWARD";
    public static final String ACTION_WIDGET_PREV = "com.viferor.radioespana.WIDGET_PREV";
    public static final String ACTION_WIDGET_NEXT = "com.viferor.radioespana.WIDGET_NEXT";
    public static final String ACTION_WIDGET_VOLUME_DOWN = "com.viferor.radioespana.WIDGET_VOLUME_DOWN";
    public static final String ACTION_WIDGET_VOLUME_UP = "com.viferor.radioespana.WIDGET_VOLUME_UP";

    private static final String CHANNEL_ID = "podcast_media_controls";
    private static final String PREFS_NAME = "radio_viferor_prefs";
    private static final String PREF_PLAYBACK_SECTION = "playback_section";
    private static final String PREF_WIDGET_TITLE = "widget_title";
    private static final String PREF_WIDGET_SUBTITLE = "widget_subtitle";
    private static final String PREF_WIDGET_PLAYING = "widget_playing";
    private static final String PREF_WIDGET_TYPE = "widget_type";
    static final int NOTIFICATION_ID = 49052;
    private static PodcastMediaController instance;

    private final MainActivity activity;
    private final MediaSession session;
    private final NotificationManager notifications;
    private final ExecutorService imageExecutor = Executors.newSingleThreadExecutor();
    private String title = "Podcast";
    private String subtitle = "Radios Viferor";
    private String artworkUrl = "";
    private long durationMs = 0;
    private long positionMs = 0;
    private boolean playing = false;
    // Última portada descargada: se reutiliza en cada actualización de la
    // notificación (antes desaparecía con la siguiente actualización).
    private Bitmap artworkBitmap;
    private String artworkBitmapUrl = "";
    // Emisora de radio actual (se muestra como «álbum» en la pantalla de bloqueo).
    private String radioStation = "";
    private static String widgetTitle = "Radios Viferor";
    private static String widgetSubtitle = "Sin reproducción";
    private static boolean widgetPlaying = false;
    private static String widgetType = "radio";

    public static synchronized PodcastMediaController get(MainActivity activity) {
        if (instance == null || instance.activity != activity) {
            if (instance != null) {
                try { instance.release(); } catch (Exception ignored) {}
            }
            instance = new PodcastMediaController(activity);
        }
        return instance;
    }

    private PodcastMediaController(MainActivity activity) {
        this.activity = activity;
        notifications = (NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
        createChannel();
        session = new MediaSession(activity, "Radios Viferor Podcasts");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            private boolean isPodcast() {
                return "podcast".equalsIgnoreCase(activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_PLAYBACK_SECTION, "radio"));
            }
            @Override public void onPlay() { sendToWeb(isPodcast() ? "window.viferorNativePodcastPlay&&window.viferorNativePodcastPlay();" : "window.viferorNativeRadioPlay&&window.viferorNativeRadioPlay();"); }
            @Override public void onPause() { sendToWeb(isPodcast() ? "window.viferorNativePodcastPause&&window.viferorNativePodcastPause();" : "window.viferorNativeRadioPause&&window.viferorNativeRadioPause();"); }
            @Override public void onSkipToNext() { if (isPodcast()) sendToWeb("window.viferorNativePodcastNext&&window.viferorNativePodcastNext();"); }
            @Override public void onSkipToPrevious() { if (isPodcast()) sendToWeb("window.viferorNativePodcastPrevious&&window.viferorNativePodcastPrevious();"); }
            @Override public void onFastForward() { if (isPodcast()) sendToWeb("window.viferorNativePodcastSeek&&window.viferorNativePodcastSeek(30);"); }
            @Override public void onRewind() { if (isPodcast()) sendToWeb("window.viferorNativePodcastSeek&&window.viferorNativePodcastSeek(-15);"); }
            @Override public void onSeekTo(long pos) { if (isPodcast()) sendToWeb("window.viferorNativePodcastSetPosition&&window.viferorNativePodcastSetPosition(" + Math.max(0,pos) + ");"); }
        });
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26 && notifications != null) {
            NotificationChannel c = new NotificationChannel(CHANNEL_ID, "Reproductor multimedia", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Controles multimedia de Radios Viferor");
            c.setShowBadge(false);
            notifications.createNotificationChannel(c);
        }
    }

    public void start(String title, String subtitle, String artworkUrl, long durationMs, long positionMs, boolean playing) {
        activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(PREF_PLAYBACK_SECTION, "podcast").apply();
        this.title = TextUtils.isEmpty(title) ? "Podcast" : title;
        this.subtitle = TextUtils.isEmpty(subtitle) ? "Radios Viferor" : subtitle;
        this.artworkUrl = artworkUrl == null ? "" : artworkUrl;
        this.durationMs = Math.max(0, durationMs);
        this.positionMs = Math.max(0, positionMs);
        this.playing = playing;
        persistWidgetState();
        session.setActive(true);
        updateState();
        postNotification(null);
        loadArtworkIfNeeded();
    }

    public void update(long durationMs, long positionMs, boolean playing) {
        if (!isPlaybackSection("podcast")) return;
        this.durationMs = Math.max(0, durationMs);
        this.positionMs = Math.max(0, Math.min(this.durationMs > 0 ? this.durationMs : Long.MAX_VALUE, positionMs));
        this.playing = playing;
        persistWidgetState();
        if (!session.isActive()) session.setActive(true);
        updateState();
        postNotification(null);
        WidgetProvider.updateAll(activity);
    }

    public void refreshNotification() { postNotification(null); WidgetProvider.updateAll(activity); }

    public void release() {
        // Al cerrarse la actividad se destruye el WebView y el audio se detiene:
        // se retiran el servicio en primer plano y la notificación.
        try { MediaPlaybackService.stop(activity); } catch (Exception ignored) {}
        try { if (notifications != null) notifications.cancel(NOTIFICATION_ID); } catch (Exception ignored) {}
        playing = false;
        try { persistWidgetState(); WidgetProvider.updateAll(activity); } catch (Exception ignored) {}
        try { session.setActive(false); } catch (Exception ignored) {}
        try { session.release(); } catch (Exception ignored) {}
        try { imageExecutor.shutdownNow(); } catch (Exception ignored) {}
        if (instance == this) instance = null;
    }

    /** Media state for the existing radio HTML player. It does not replace radio playback. */
    public void startRadio(String station, String track, String artworkUrl, boolean playing) {
        // This method is called explicitly by the existing radio player. The explicit
        // call is authoritative, so do not discard it because an older preference
        // value still says "podcast". The web player remains the owner of audio.
        this.title = TextUtils.isEmpty(station) ? "Radio" : station;
        this.radioStation = this.title;
        this.subtitle = TextUtils.isEmpty(track) ? "🎵 En directo" : track;
        this.artworkUrl = artworkUrl == null ? "" : artworkUrl;
        this.durationMs = 0;
        this.positionMs = 0;
        this.playing = playing;
        activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString(PREF_PLAYBACK_SECTION, "radio").apply();
        persistWidgetState();
        session.setActive(true);
        updateState();
        postNotification(null);
        WidgetProvider.updateAll(activity);
        loadArtworkIfNeeded();
    }

    public void updateRadio(String station, String track, boolean playing) {
        if (!isPlaybackSection("radio")) return;
        // Radio callbacks are generated by the active radio HTML player. Do not let
        // a stale section preference suppress a legitimate station update.
        if (!TextUtils.isEmpty(station)) this.title = station;
        this.subtitle = TextUtils.isEmpty(track) ? "🎵 En directo" : track;
        this.playing = playing;
        persistWidgetState();
        if (!session.isActive()) session.setActive(true);
        updateState();
        postNotification(null);
        WidgetProvider.updateAll(activity);
    }

    /**
     * Canción o programa de la radio. Notificación: título de la canción (o el
     * programa, o la emisora) y debajo «artista · emisora». Pantalla de bloqueo y
     * Android Auto reciben título, artista y emisora en campos separados.
     */
    public void updateRadioNowPlaying(String station, String artist, String song, String program, String artwork, boolean playing) {
        if (!isPlaybackSection("radio")) return;
        String st = TextUtils.isEmpty(station) ? (TextUtils.isEmpty(radioStation) ? "Radio" : radioStation) : station;
        radioStation = st;
        if (!TextUtils.isEmpty(song)) {
            this.title = song;
            this.subtitle = TextUtils.isEmpty(artist) ? st : artist + " · " + st;
        } else if (!TextUtils.isEmpty(program)) {
            this.title = program;
            this.subtitle = st;
        } else {
            this.title = st;
            this.subtitle = "🎵 En directo";
        }
        this.playing = playing;
        String art = artwork == null ? "" : artwork;
        boolean artChanged = !art.equals(this.artworkUrl);
        this.artworkUrl = art;
        persistWidgetState();
        if (!session.isActive()) session.setActive(true);
        updateState();
        postNotification(null);
        WidgetProvider.updateAll(activity);
        if (artChanged) loadArtworkIfNeeded();
    }

    public void stopRadio() {
        if (!isPlaybackSection("radio")) return;
        playing = false;
        persistWidgetState();
        updateState();
        postNotification(null);
        WidgetProvider.updateAll(activity);
    }

    private boolean isPlaybackSection(String wanted) {
        return wanted.equalsIgnoreCase(activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_PLAYBACK_SECTION, "radio"));
    }

    private void persistWidgetState() {
        widgetTitle = title;
        widgetSubtitle = subtitle;
        widgetPlaying = playing;
        widgetType = isPlaybackSection("podcast") ? "podcast" : "radio";
        activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putString(PREF_WIDGET_TITLE, widgetTitle)
                .putString(PREF_WIDGET_SUBTITLE, widgetSubtitle)
                .putBoolean(PREF_WIDGET_PLAYING, widgetPlaying)
                .putString(PREF_WIDGET_TYPE, widgetType)
                .apply();
    }

    public static String getWidgetTitle(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_WIDGET_TITLE, widgetTitle);
    }
    public static String getWidgetSubtitle(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_WIDGET_SUBTITLE, widgetSubtitle);
    }
    public static boolean getWidgetPlaying(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(PREF_WIDGET_PLAYING, widgetPlaying);
    }
    public static String getWidgetType(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_WIDGET_TYPE, widgetType);
    }

    public static String getWidgetTitle() { return widgetTitle; }
    public static String getWidgetSubtitle() { return widgetSubtitle; }
    public static boolean getWidgetPlaying() { return widgetPlaying; }

    public void stop() {
        if (!isPlaybackSection("podcast")) return;
        playing = false; persistWidgetState();
        session.setPlaybackState(new PlaybackState.Builder().setState(PlaybackState.STATE_NONE, positionMs, 0f).build());
        session.setActive(false);
        MediaPlaybackService.stop(activity);
        if (notifications != null) notifications.cancel(NOTIFICATION_ID);
        WidgetProvider.updateAll(activity);
    }

    private void updateState() {
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO |
                PlaybackState.ACTION_REWIND | PlaybackState.ACTION_FAST_FORWARD |
                PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        int state = playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        PlaybackState.Builder b = new PlaybackState.Builder().setActions(actions).setState(state, positionMs, 1f, SystemClock.elapsedRealtime());
        session.setPlaybackState(b.build());
        MediaMetadata.Builder m = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, subtitle)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle)
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_DESCRIPTION, subtitle);
        if (durationMs > 0) m.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (!TextUtils.isEmpty(radioStation) && isPlaybackSection("radio")) m.putString(MediaMetadata.METADATA_KEY_ALBUM, radioStation);
        if (artworkBitmap != null && artworkBitmapUrl.equals(artworkUrl)) m.putBitmap(MediaMetadata.METADATA_KEY_ART, artworkBitmap);
        session.setMetadata(m.build());
    }

    private void postNotification(Bitmap artwork) {
        if (notifications == null) return;
        // Sin permiso de notificaciones el aviso no se ve, pero el servicio en primer
        // plano sigue siendo necesario para que Android no corte el audio.
        boolean canShow = Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        Intent open = new Intent(activity, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        String section = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(PREF_PLAYBACK_SECTION, "radio");
        boolean podcast = "podcast".equalsIgnoreCase(section);
        open.putExtra("openSection", section);
        PendingIntent content = PendingIntent.getActivity(activity, 490520, open, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(activity, CHANNEL_ID) : new Notification.Builder(activity);
        b.setSmallIcon(R.drawable.ic_stat_app)
                .setContentTitle(title)
                .setContentText(subtitle)
                .setContentIntent(content)
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(playing)
                .setOnlyAlertOnce(true);
        if (artwork != null) {
            artworkBitmap = artwork;
            artworkBitmapUrl = artworkUrl;
        }
        if (artworkBitmap != null && artworkBitmapUrl.equals(artworkUrl)) b.setLargeIcon(artworkBitmap);
        if (Build.VERSION.SDK_INT >= 21) {
            if (podcast) {
                b.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0,1,2));
                b.addAction(new Notification.Action.Builder(R.drawable.ic_media_previous, "Anterior", action(ACTION_WIDGET_PREV)).build());
                b.addAction(new Notification.Action.Builder(playing ? R.drawable.ic_media_pause : R.drawable.ic_media_play, playing ? "Pausar" : "Reproducir", action(playing ? ACTION_WIDGET_PAUSE : ACTION_WIDGET_PLAY)).build());
                b.addAction(new Notification.Action.Builder(R.drawable.ic_media_next, "Siguiente", action(ACTION_WIDGET_NEXT)).build());
            } else {
                b.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0));
                b.addAction(new Notification.Action.Builder(playing ? R.drawable.ic_media_pause : R.drawable.ic_media_play, playing ? "Pausar" : "Reproducir", action(playing ? ACTION_WIDGET_PAUSE : ACTION_WIDGET_PLAY)).build());
            }
        }
        Notification n = b.build();
        if (playing) {
            // show() actualiza la notificación si el servicio ya está en primer plano
            // (también durante el margen de pausa) o lo arranca si no lo está.
            if (!MediaPlaybackService.show(activity, NOTIFICATION_ID, n) && canShow) {
                notifications.notify(NOTIFICATION_ID, n);
            }
        } else if (MediaPlaybackService.isRunning()) {
            MediaPlaybackService.pause(activity, NOTIFICATION_ID, n);
        } else if (canShow) {
            notifications.notify(NOTIFICATION_ID, n);
        }
    }

    private PendingIntent action(String action) {
        Intent i = new Intent(activity, MediaControlReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(activity, action.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | immutable());
    }

    private int immutable() { return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0; }

    private void sendToWeb(String js) {
        activity.runOnUiThread(() -> activity.evalPodcastJavascript(js));
    }

    private void loadArtworkIfNeeded() {
        if (TextUtils.isEmpty(artworkUrl)) return;
        final String u = artworkUrl;
        imageExecutor.execute(() -> {
            try {
                Bitmap bmp;
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new URL(u).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(10000);
                try (java.io.InputStream in = c.getInputStream()) {
                    bmp = BitmapFactory.decodeStream(in);
                } finally {
                    c.disconnect();
                }
                if (bmp != null) {
                    int max = 512;
                    int w = bmp.getWidth(), h = bmp.getHeight();
                    if (w > max || h > max) {
                        float scale = Math.min((float)max / w, (float)max / h);
                        Bitmap scaled = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), true);
                        if (scaled != bmp) bmp.recycle();
                        bmp = scaled;
                    }
                }
                if (bmp != null && u.equals(artworkUrl)) {
                    final Bitmap readyBitmap = bmp;
                    activity.runOnUiThread(() -> { postNotification(readyBitmap); updateState(); WidgetProvider.updateAll(activity, readyBitmap); });
                }
            } catch (Exception ignored) {}
        });
    }
}
