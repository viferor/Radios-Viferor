package com.viferor.radioespana;

import android.content.ContentUris;
import android.content.Context;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;

import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.Renderer;
import androidx.media3.exoplayer.RenderersFactory;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.audio.MediaCodecAudioRenderer;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * Motor nativo de «Mi música» (APK 1.17+).
 *
 * La web sigue llevando la cola, las listas, la interfaz y las decisiones (qué suena, cuándo
 * se funde, cómo se recupera un fallo), igual que antes. Lo único que cambia es QUIÉN suena:
 * en vez de dos {@code <audio>} del WebView, dos reproductores ExoPlayer («platinas»). En la
 * web, motor-nativo.js los presenta como si fueran {@code <audio>} (mismas propiedades y
 * eventos), así que musica.js casi no ha tenido que cambiar.
 *
 * Por qué: el WebView de Android saca el sonido con búferes de milisegundos y con la pantalla
 * apagada se oían microcortes, sobre todo con el ecualizador o con FLAC. ExoPlayer lee el
 * archivo directamente, decodifica con el sistema, procesa por adelantado (FxAudioProcessor)
 * y entrega bloques grandes, como Poweramp.
 *
 * Canciones seguidas sin hueco: cuando la web prepara la siguiente en la otra platina, la
 * pide «enganchada» (arm). Entonces la siguiente se añade a la lista del reproductor que
 * suena y ExoPlayer pasa de una a otra sin silencio (respetando el relleno de MP3/AAC). En
 * ese momento las platinas se intercambian el reproductor y se avisa a la web.
 *
 * Todo se usa desde el hilo principal.
 */
@OptIn(markerClass = UnstableApi.class)
final class NativeMusic {
    static final int API_VERSION = 1;
    private static final long TICK_MS = 250;

    interface Js {
        void run(String js);
    }

    /** Un reproductor con su procesado de sonido. */
    private final class Slot {
        final ExoPlayer player;
        final FxAudioProcessor fx = new FxAudioProcessor();

        Slot() {
            AudioSink sink = new DefaultAudioSink.Builder(ctx)
                    .setAudioProcessors(new AudioProcessor[]{fx})
                    .build();
            // Solo audio: sin renderizadores de vídeo ni subtítulos.
            RenderersFactory rf = (handler, video, audio, text, metadata) -> new Renderer[]{
                    new MediaCodecAudioRenderer(ctx, MediaCodecSelector.DEFAULT, handler, audio, sink)
            };
            player = new ExoPlayer.Builder(ctx, rf)
                    .setLooper(Looper.getMainLooper())
                    // El foco de audio lo lleva esta clase (con dos reproductores se lo quitarían el uno al otro).
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(C.USAGE_MEDIA)
                            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                            .build(), false)
                    .setHandleAudioBecomingNoisy(false)
                    .setWakeMode(C.WAKE_MODE_LOCAL)
                    .build();
            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int state) {
                    onState(Slot.this, state);
                }

                @Override
                public void onIsPlayingChanged(boolean isPlaying) {
                    onPlaying(Slot.this, isPlaying);
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    onError(Slot.this, error);
                }

                @Override
                public void onMediaItemTransition(MediaItem item, int reason) {
                    if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) onAutoTransition(Slot.this);
                }

                @Override
                public void onPositionDiscontinuity(Player.PositionInfo oldPos, Player.PositionInfo newPos, int reason) {
                    if (reason == Player.DISCONTINUITY_REASON_SEEK) onSeeked(Slot.this);
                }
            });
        }
    }

    /** Lo que la web sabe de cada platina. */
    private static final class Deck {
        int gen;
        String url;
        Uri uri;
        boolean ready;
        boolean ended;
        float volume = 1f; // volumen pedido por la web (usuario × nivel del fundido)
        float shown = 1f; // volumen puesto ahora en el reproductor
        float rampFrom, rampTo;
        long rampStart, rampMs;
    }

    private final Context ctx;
    private final Js js;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Slot[] slots = new Slot[2];
    private final int[] deckSlot = {0, 1};
    private final Deck[] decks = {new Deck(), new Deck()};
    private FxDsp.Plan plan = FxDsp.Plan.OFF;
    private int armFrom = -1, armTo = -1;
    private boolean released;

    // Foco de audio
    private final AudioManager am;
    private AudioFocusRequest focusRequest;
    private boolean hasFocus;
    private float duck = 1f;
    private final AudioManager.OnAudioFocusChangeListener focusListener = this::onFocusChange;
    private final Runnable abandonIfIdle = () -> {
        if (!anyPlaying()) abandonFocus();
    };

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            boolean any = false;
            StringBuilder sb = new StringBuilder();
            for (int d = 0; d < 2; d++) {
                ExoPlayer p = player(d);
                if (p != null && p.isPlaying()) {
                    any = true;
                    sb.append(eventJs(d, "time", null));
                }
            }
            if (sb.length() > 0) js.run(sb.toString());
            if (any) handler.postDelayed(this, TICK_MS);
        }
    };

    private final Runnable ramper = new Runnable() {
        @Override
        public void run() {
            boolean more = false;
            long now = android.os.SystemClock.uptimeMillis();
            for (int d = 0; d < 2; d++) {
                Deck k = decks[d];
                if (k.rampMs <= 0) continue;
                float f = Math.min(1f, (now - k.rampStart) / (float) k.rampMs);
                k.shown = k.rampFrom + (k.rampTo - k.rampFrom) * f;
                if (f >= 1f) k.rampMs = 0;
                else more = true;
                applyVolume(d);
            }
            if (more) handler.postDelayed(this, 20);
        }
    };

    NativeMusic(Context context, Js js) {
        this.ctx = context.getApplicationContext();
        this.js = js;
        this.am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
    }

    // ------------------------------------------------------------ Órdenes de la web

    void load(int d, String url, int gen) {
        if (!need(d)) return;
        Deck k = decks[d];
        if (armFrom == d || armTo == d) disarm();
        // Primero se vacía (sus avisos llevan aún la generación vieja y la web los ignora).
        Slot s = slot(d);
        s.player.stop();
        s.player.clearMediaItems();
        k.gen = gen;
        k.url = url;
        k.uri = resolve(url);
        k.ready = false;
        k.ended = false;
        if (k.uri == null) {
            js.run(eventJs(d, "error", errJson(4, "Dirección no válida para el reproductor nativo: " + url)));
            return;
        }
        s.player.setMediaItem(MediaItem.fromUri(k.uri));
        s.player.setPlayWhenReady(false);
        applyVolume(d);
        s.player.prepare();
    }

    void play(int d) {
        if (!need(d)) return;
        Deck k = decks[d];
        ExoPlayer p = player(d);
        if (k.uri == null) return;
        requestFocus();
        if (!hasFocus && am != null) {
            // Android no da el foco (hay una llamada): como una interrupción, la web
            // volverá a intentarlo cuando se pueda.
            js.run(eventJs(d, "syspause", null));
            return;
        }
        if (p.getPlaybackState() == Player.STATE_IDLE) p.prepare(); // tras un error
        if (k.ended || p.getPlaybackState() == Player.STATE_ENDED) {
            k.ended = false;
            p.seekTo(0, 0);
        }
        applyVolume(d);
        p.play();
        startTicker();
    }

    void pause(int d) {
        if (!valid(d) || player(d) == null) return;
        player(d).pause();
        handler.removeCallbacks(abandonIfIdle);
        handler.postDelayed(abandonIfIdle, 3000);
    }

    void seek(int d, double sec) {
        if (!valid(d)) return;
        ExoPlayer p = player(d);
        if (p == null || decks[d].uri == null) return;
        decks[d].ended = false;
        p.seekTo(Math.max(0, (long) (sec * 1000)));
    }

    void stop(int d) {
        if (!valid(d)) return;
        if (armFrom == d || armTo == d) disarm();
        Deck k = decks[d];
        k.url = null;
        k.uri = null;
        k.ready = false;
        k.ended = false;
        ExoPlayer p = player(d);
        if (p == null) return;
        p.stop();
        p.clearMediaItems();
    }

    void volume(int d, double v, double secs) {
        if (!valid(d)) return;
        Deck k = decks[d];
        k.volume = (float) Math.max(0, Math.min(1, v));
        if (secs <= 0) {
            k.rampMs = 0;
            k.shown = k.volume;
            applyVolume(d);
            return;
        }
        k.rampFrom = k.shown;
        k.rampTo = k.volume;
        k.rampStart = android.os.SystemClock.uptimeMillis();
        k.rampMs = (long) (secs * 1000);
        handler.removeCallbacks(ramper);
        handler.post(ramper);
    }

    /**
     * La platina «to» debe empezar en cuanto acabe «from», sin hueco (-1 = ninguna). Se
     * añade la canción de «to» a la lista del reproductor de «from».
     */
    void arm(int from, int to) {
        if (from == armFrom && to == armTo) return;
        disarm();
        if (!valid(from) || !valid(to) || from == to) return;
        Deck kt = decks[to];
        if (kt.uri == null || decks[from].uri == null) return;
        ExoPlayer p = player(from);
        if (p == null || p.getPlaybackState() == Player.STATE_IDLE || p.getPlaybackState() == Player.STATE_ENDED) return;
        p.addMediaItem(MediaItem.fromUri(kt.uri));
        armFrom = from;
        armTo = to;
    }

    void disarm() {
        if (armFrom >= 0) {
            ExoPlayer p = player(armFrom);
            if (p != null && p.getMediaItemCount() > 1) {
                int cur = p.getCurrentMediaItemIndex();
                p.removeMediaItems(cur + 1, p.getMediaItemCount());
            }
        }
        armFrom = armTo = -1;
    }

    /** Ajustes de sonido (el JSON que manda ecualizador.js). */
    void setFx(String json) {
        plan = parsePlan(json);
        for (Slot s : slots) if (s != null) s.fx.setPlan(plan);
    }

    /** La página se recarga o se cierra la app: se para todo (la web volverá a empezar). */
    void stopAll() {
        disarm();
        for (int d = 0; d < 2; d++) stop(d);
        handler.removeCallbacks(ticker);
        abandonFocus();
    }

    void release() {
        released = true;
        handler.removeCallbacksAndMessages(null);
        for (Slot s : slots) if (s != null) try { s.player.release(); } catch (Exception ignored) {}
        slots[0] = slots[1] = null;
        abandonFocus();
    }

    boolean anyPlaying() {
        for (Slot s : slots) if (s != null && s.player.getPlayWhenReady()) return true;
        return false;
    }

    // ------------------------------------------------------------ Eventos del reproductor

    private int deckOf(Slot s) {
        for (int d = 0; d < 2; d++) if (slots[deckSlot[d]] == s) return d;
        return -1;
    }

    private void onState(Slot s, int state) {
        int d = deckOf(s);
        if (d < 0) return;
        Deck k = decks[d];
        switch (state) {
            case Player.STATE_READY:
                if (!k.ready) {
                    k.ready = true;
                    js.run(eventJs(d, "ready", null));
                } else {
                    js.run(eventJs(d, "canplay", null));
                }
                break;
            case Player.STATE_BUFFERING:
                if (k.ready && s.player.getPlayWhenReady()) js.run(eventJs(d, "waiting", null));
                break;
            case Player.STATE_ENDED:
                k.ended = true;
                if (armFrom == d) disarm();
                js.run(eventJs(d, "ended", null));
                handler.removeCallbacks(abandonIfIdle);
                handler.postDelayed(abandonIfIdle, 3000);
                break;
            default:
                break;
        }
    }

    private void onPlaying(Slot s, boolean isPlaying) {
        int d = deckOf(s);
        if (d < 0) return;
        if (isPlaying) {
            js.run(eventJs(d, "playing", null));
            startTicker();
        } else {
            js.run(eventJs(d, "time", null));
        }
    }

    private void onSeeked(Slot s) {
        int d = deckOf(s);
        if (d >= 0) js.run(eventJs(d, "seeked", null));
    }

    private void onError(Slot s, PlaybackException e) {
        int d = deckOf(s);
        if (d < 0) return;
        if (armFrom == d || armTo == d) disarm();
        int code;
        int c = e.errorCode;
        if (c >= 4000 && c < 5000) {
            code = (c == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
                    || c == PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES) ? 4 : 3;
        } else if (c >= 3000 && c < 4000) {
            code = 4;
        } else {
            code = 2; // lectura, AudioTrack u otros: se puede reintentar
        }
        String msg = e.getErrorCodeName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
        Throwable cause = e.getCause();
        if (cause != null && cause.getMessage() != null) msg += " (" + cause.getClass().getSimpleName() + ": " + cause.getMessage() + ")";
        js.run(eventJs(d, "error", errJson(code, msg)));
    }

    /** Ha empezado sola la canción enganchada: las platinas se intercambian el reproductor. */
    private void onAutoTransition(Slot s) {
        int from = deckOf(s);
        if (from < 0 || from != armFrom || armTo < 0) return;
        int to = armTo;
        armFrom = armTo = -1;
        int slotA = deckSlot[from], slotB = deckSlot[to];
        deckSlot[to] = slotA;
        deckSlot[from] = slotB;
        // La canción anterior ya no hace falta en la lista (quitarla no corta la que suena).
        ExoPlayer pa = slots[slotA].player;
        int cur = pa.getCurrentMediaItemIndex();
        if (cur > 0) pa.removeMediaItems(0, cur);
        // El otro reproductor tenía la copia preparada: se vacía y queda para la siguiente.
        ExoPlayer pb = slots[slotB].player;
        pb.stop();
        pb.clearMediaItems();
        Deck kf = decks[from], kt = decks[to];
        // Esa platina se queda vacía hasta que la web cargue en ella la siguiente.
        kf.ended = true;
        kf.uri = null;
        kf.url = null;
        kf.ready = false;
        kt.ended = false;
        kt.ready = true;
        kt.rampMs = 0;
        kt.shown = kt.volume;
        applyVolume(to);
        applyVolume(from);
        // Primero la que empieza y luego la que acaba (la web cambia de platina al recibir «ended»).
        js.run(eventJs(to, "autostart", null) + eventJs(from, "ended", null));
    }

    // ------------------------------------------------------------ Foco de audio

    private void requestFocus() {
        handler.removeCallbacks(abandonIfIdle);
        if (hasFocus || am == null) return;
        int r;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focusRequest == null) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(new android.media.AudioAttributes.Builder()
                                .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                                .build())
                        .setOnAudioFocusChangeListener(focusListener, handler)
                        .build();
            }
            r = am.requestAudioFocus(focusRequest);
        } else {
            r = am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        hasFocus = r == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private void abandonFocus() {
        if (!hasFocus || am == null) return;
        hasFocus = false;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focusRequest != null) am.abandonAudioFocusRequest(focusRequest);
        } else {
            am.abandonAudioFocus(focusListener);
        }
    }

    /**
     * Otra app, una llamada o un aviso quieren sonar. Como hacía el {@code <audio>} del
     * WebView: se pausa y se avisa a la web, que decide si vuelve a sonar (al colgar, tras un
     * aviso corto) o se queda en pausa (ver startMusicInterrupt en musica.js).
     */
    private void onFocusChange(int change) {
        if (released) return;
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                // Al volver a sonar se pedirá otra vez (si no, se sonaría sin tener el foco).
                hasFocus = false;
                StringBuilder sb = new StringBuilder();
                for (int d = 0; d < 2; d++) {
                    ExoPlayer p = player(d);
                    if (p != null && p.getPlayWhenReady()) {
                        p.pause();
                        sb.append(eventJs(d, "syspause", null));
                    }
                }
                if (sb.length() > 0) js.run(sb.toString());
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                // Desde Android 8 baja el volumen el propio sistema; antes hay que hacerlo aquí.
                if (Build.VERSION.SDK_INT < 26) {
                    duck = 0.2f;
                    applyVolume(0);
                    applyVolume(1);
                }
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                hasFocus = true;
                if (duck != 1f) {
                    duck = 1f;
                    applyVolume(0);
                    applyVolume(1);
                }
                break;
            default:
                break;
        }
    }

    // ------------------------------------------------------------ Utilidades

    private boolean valid(int d) {
        return !released && d >= 0 && d <= 1;
    }

    /** Como valid(), y además crea los reproductores (solo al cargar o reproducir algo). */
    private boolean need(int d) {
        if (!valid(d)) return false;
        ensureSlots();
        return true;
    }

    private void ensureSlots() {
        for (int i = 0; i < 2; i++) {
            if (slots[i] == null) {
                slots[i] = new Slot();
                slots[i].fx.setPlan(plan);
            }
        }
    }

    private Slot slot(int d) {
        return slots[deckSlot[d]];
    }

    private ExoPlayer player(int d) {
        Slot s = slots[deckSlot[d]];
        return s == null ? null : s.player;
    }

    private void applyVolume(int d) {
        ExoPlayer p = player(d);
        if (p != null) p.setVolume(Math.max(0f, Math.min(1f, decks[d].shown * duck)));
    }

    private void startTicker() {
        handler.removeCallbacks(ticker);
        handler.postDelayed(ticker, TICK_MS);
    }

    /** /__music/track/{id} → canción de MediaStore; /__music/ext/{ficha} → abierta desde otra app. */
    private static Uri resolve(String url) {
        if (url == null) return null;
        try {
            Uri u = Uri.parse(url);
            String path = u.getPath();
            if (path == null) return null;
            if (path.startsWith(LocalMusic.PREFIX + "track/")) {
                long id = Long.parseLong(path.substring((LocalMusic.PREFIX + "track/").length()).replaceAll("[^0-9].*$", ""));
                return ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
            }
            if (path.startsWith(LocalMusic.PREFIX + "ext/")) {
                ExternalAudio.Item it = ExternalAudio.get(path.substring((LocalMusic.PREFIX + "ext/").length()));
                return it == null ? null : it.uri;
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private String eventJs(int d, String type, String extra) {
        Deck k = decks[d];
        ExoPlayer p = player(d);
        double t = 0, dur = -1, buf = 0;
        boolean playing = false;
        int state = Player.STATE_IDLE;
        if (p != null) {
            t = Math.max(0, p.getCurrentPosition()) / 1000.0;
            long du = p.getDuration();
            dur = du == C.TIME_UNSET ? -1 : du / 1000.0;
            buf = Math.max(0, p.getTotalBufferedDuration()) / 1000.0;
            playing = p.isPlaying();
            state = p.getPlaybackState();
        }
        // readyState / networkState como los de un <audio>.
        int rs = k.uri == null ? 0 : state == Player.STATE_READY || state == Player.STATE_ENDED ? 4 : k.ready ? 2 : 0;
        int ns = k.uri == null ? 0 : state == Player.STATE_BUFFERING ? 2 : 1;
        String s = String.format(Locale.ROOT, "{\"t\":%.3f,\"dur\":%.3f,\"buf\":%.1f,\"pl\":%b,\"rs\":%d,\"ns\":%d%s}",
                t, dur, buf, playing, rs, ns, extra == null ? "" : "," + extra);
        return "window.rvNativeMusicEvent&&window.rvNativeMusicEvent(" + d + "," + k.gen + ",'" + type + "'," + s + ");";
    }

    private static String errJson(int code, String msg) {
        return "\"err\":" + code + ",\"msg\":" + JSONObject.quote(msg == null ? "" : msg);
    }

    static FxDsp.Plan parsePlan(String json) {
        try {
            JSONObject o = new JSONObject(json);
            if (!o.optBoolean("on", false)) return FxDsp.Plan.OFF;
            JSONArray a = o.optJSONArray("filters");
            int n = a == null ? 0 : Math.min(64, a.length());
            FxDsp.Filter[] fs = new FxDsp.Filter[n];
            for (int i = 0; i < n; i++) {
                JSONObject f = a.getJSONObject(i);
                fs[i] = new FxDsp.Filter(f.optString("type", "peaking"), f.optDouble("fc", 1000), f.optDouble("gain", 0), f.optDouble("q", 0.707));
            }
            return new FxDsp.Plan(true, o.optDouble("pre", 0), fs, o.optBoolean("level", false), o.optDouble("balance", 0), o.optBoolean("mono", false));
        } catch (Exception e) {
            return FxDsp.Plan.OFF;
        }
    }
}
