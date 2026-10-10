package com.viferor.radioespana;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.util.Size;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Música del móvil para la pestaña «Mi música» (APK 1.10+).
 *
 * La web no puede abrir content:// directamente, así que el WebView intercepta
 * unas rutas propias dentro del dominio de la app:
 *   /__music/library.json      → canciones de MediaStore (JSON)
 *   /__music/track/{id}        → audio, con soporte de Range para poder saltar
 *   /__music/art/{albumId}?t=  → carátula del álbum (o de la canción) en JPEG
 * Solo responde con el permiso de música concedido.
 */
final class LocalMusic {
    static final int API_VERSION = 1;
    static final String PREFIX = "/__music/";

    private LocalMusic() {}

    static String permissionName() {
        return Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_AUDIO : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    static boolean hasPermission(Context c) {
        return c.checkSelfPermission(permissionName()) == PackageManager.PERMISSION_GRANTED;
    }

    // ---------------------------------------------------------------- Biblioteca

    static String libraryJson(Context c) throws Exception {
        ContentResolver cr = c.getContentResolver();
        Uri uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        List<String> base = new ArrayList<>(Arrays.asList(
                MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.ALBUM_ID, MediaStore.Audio.Media.TRACK,
                MediaStore.Audio.Media.YEAR, MediaStore.Audio.Media.DURATION, MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.DATE_ADDED, MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.DATA));
        if (Build.VERSION.SDK_INT >= 29) base.add(MediaStore.Audio.Media.RELATIVE_PATH);
        List<String> extra = new ArrayList<>(base);
        extra.add("album_artist");
        if (Build.VERSION.SDK_INT >= 30) extra.add("genre");
        String sel = MediaStore.Audio.Media.IS_MUSIC + " != 0";
        Cursor cur;
        try {
            cur = cr.query(uri, extra.toArray(new String[0]), sel, null, null);
        } catch (Exception e) {
            // Algunos fabricantes no tienen album_artist / genre.
            cur = cr.query(uri, base.toArray(new String[0]), sel, null, null);
        }
        Map<Long, String> genres = Build.VERSION.SDK_INT < 30 ? legacyGenres(cr) : null;
        String root = Environment.getExternalStorageDirectory().getPath();
        JSONArray out = new JSONArray();
        if (cur != null) {
            try {
                int cId = cur.getColumnIndex(MediaStore.Audio.Media._ID);
                int cTitle = cur.getColumnIndex(MediaStore.Audio.Media.TITLE);
                int cArtist = cur.getColumnIndex(MediaStore.Audio.Media.ARTIST);
                int cAlbum = cur.getColumnIndex(MediaStore.Audio.Media.ALBUM);
                int cAlbumId = cur.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID);
                int cTrack = cur.getColumnIndex(MediaStore.Audio.Media.TRACK);
                int cYear = cur.getColumnIndex(MediaStore.Audio.Media.YEAR);
                int cDur = cur.getColumnIndex(MediaStore.Audio.Media.DURATION);
                int cName = cur.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME);
                int cAdded = cur.getColumnIndex(MediaStore.Audio.Media.DATE_ADDED);
                int cSize = cur.getColumnIndex(MediaStore.Audio.Media.SIZE);
                int cMime = cur.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE);
                int cData = cur.getColumnIndex(MediaStore.Audio.Media.DATA);
                int cRel = cur.getColumnIndex("relative_path");
                int cAA = cur.getColumnIndex("album_artist");
                int cGenre = cur.getColumnIndex("genre");
                while (cur.moveToNext()) {
                    long id = cur.getLong(cId);
                    JSONObject t = new JSONObject();
                    t.put("id", id);
                    t.put("t", str(cur, cTitle));
                    t.put("a", clean(str(cur, cArtist)));
                    t.put("al", clean(str(cur, cAlbum)));
                    t.put("aa", clean(str(cur, cAA)));
                    t.put("ai", cAlbumId >= 0 ? cur.getLong(cAlbumId) : 0);
                    t.put("n", cTrack >= 0 ? cur.getInt(cTrack) : 0);
                    t.put("y", cYear >= 0 ? cur.getInt(cYear) : 0);
                    t.put("d", cDur >= 0 ? cur.getLong(cDur) : 0);
                    t.put("fn", str(cur, cName));
                    t.put("da", cAdded >= 0 ? cur.getLong(cAdded) : 0);
                    t.put("s", cSize >= 0 ? cur.getLong(cSize) : 0);
                    t.put("m", str(cur, cMime));
                    String g = cGenre >= 0 ? str(cur, cGenre) : (genres != null ? genres.get(id) : null);
                    t.put("g", clean(g));
                    t.put("f", folderOf(str(cur, cRel), str(cur, cData), root));
                    out.put(t);
                }
            } finally {
                cur.close();
            }
        }
        JSONObject r = new JSONObject();
        r.put("ok", true);
        r.put("api", API_VERSION);
        r.put("count", out.length());
        r.put("tracks", out);
        return r.toString();
    }

    private static String str(Cursor c, int i) {
        if (i < 0) return "";
        try {
            String s = c.getString(i);
            return s == null ? "" : s;
        } catch (Exception e) {
            return "";
        }
    }

    private static String clean(String s) {
        if (s == null) return "";
        s = s.trim();
        return "<unknown>".equalsIgnoreCase(s) ? "" : s;
    }

    private static String folderOf(String rel, String data, String root) {
        String f = "";
        if (!TextUtils.isEmpty(rel)) f = rel;
        else if (!TextUtils.isEmpty(data)) {
            int slash = data.lastIndexOf('/');
            f = slash > 0 ? data.substring(0, slash) : "";
            if (!TextUtils.isEmpty(root) && f.startsWith(root)) f = f.substring(root.length());
            else if (f.startsWith("/storage/")) {
                // Tarjeta SD: /storage/XXXX-XXXX/Music → SD/Music
                String rest = f.substring("/storage/".length());
                int s2 = rest.indexOf('/');
                f = "SD" + (s2 >= 0 ? rest.substring(s2) : "");
            }
        }
        while (f.startsWith("/")) f = f.substring(1);
        while (f.endsWith("/")) f = f.substring(0, f.length() - 1);
        return f;
    }

    /** Antes de Android 11 el género no está en la tabla de canciones. */
    private static Map<Long, String> legacyGenres(ContentResolver cr) {
        Map<Long, String> map = new HashMap<>();
        try (Cursor g = cr.query(MediaStore.Audio.Genres.EXTERNAL_CONTENT_URI,
                new String[]{MediaStore.Audio.Genres._ID, MediaStore.Audio.Genres.NAME}, null, null, null)) {
            if (g == null) return map;
            while (g.moveToNext()) {
                long gid = g.getLong(0);
                String name = g.getString(1);
                if (TextUtils.isEmpty(name)) continue;
                try (Cursor m = cr.query(MediaStore.Audio.Genres.Members.getContentUri("external", gid),
                        new String[]{MediaStore.Audio.Genres.Members.AUDIO_ID}, null, null, null)) {
                    if (m == null) continue;
                    while (m.moveToNext()) map.put(m.getLong(0), name);
                } catch (Exception ignored) {}
            }
        } catch (Exception ignored) {}
        return map;
    }

    // ---------------------------------------------------------------- Rutas

    static WebResourceResponse handle(Context c, Uri url, Map<String, String> headers) {
        String path = url.getPath() == null ? "" : url.getPath();
        if (!hasPermission(c)) return json(403, "Forbidden", "{\"ok\":false,\"error\":\"permission\"}");
        try {
            if (path.equals(PREFIX + "library.json")) return json(200, "OK", libraryJson(c));
            if (path.startsWith(PREFIX + "track/")) {
                long id = Long.parseLong(path.substring((PREFIX + "track/").length()).replaceAll("[^0-9].*$", ""));
                return serveTrack(c, id, header(headers, "Range"));
            }
            if (path.startsWith(PREFIX + "art/")) {
                long albumId = Long.parseLong(path.substring((PREFIX + "art/").length()).replaceAll("[^0-9].*$", ""));
                long trackId = 0;
                try { trackId = Long.parseLong(url.getQueryParameter("t")); } catch (Exception ignored) {}
                byte[] jpg = artJpeg(c, albumId, trackId, 512);
                if (jpg == null) return empty(404, "Not Found");
                Map<String, String> h = new HashMap<>();
                h.put("Cache-Control", "max-age=86400");
                h.put("Content-Length", String.valueOf(jpg.length));
                return new WebResourceResponse("image/jpeg", null, 200, "OK", h, new ByteArrayInputStream(jpg));
            }
        } catch (Exception e) {
            return json(500, "Error", "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}");
        }
        return empty(404, "Not Found");
    }

    private static String header(Map<String, String> h, String name) {
        if (h == null) return null;
        for (Map.Entry<String, String> e : h.entrySet())
            if (e.getKey() != null && e.getKey().equalsIgnoreCase(name)) return e.getValue();
        return null;
    }

    private static WebResourceResponse json(int status, String reason, String body) {
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-store");
        return new WebResourceResponse("application/json", "utf-8", status, reason, h,
                new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }

    private static WebResourceResponse empty(int status, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", status, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    /** Audio con «Range»: sin él el reproductor no podría saltar a otra parte de la canción. */
    static WebResourceResponse serveTrack(Context c, long id, String range) throws IOException {
        ContentResolver cr = c.getContentResolver();
        Uri u = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
        String mime = cr.getType(u);
        if (TextUtils.isEmpty(mime)) mime = "audio/mpeg";
        AssetFileDescriptor afd = cr.openAssetFileDescriptor(u, "r");
        if (afd == null) return empty(404, "Not Found");
        long len = afd.getLength();
        if (len < 0) len = afd.getParcelFileDescriptor().getStatSize();
        long start = 0, end = len - 1;
        boolean partial = false;
        if (range != null && len > 0) {
            String r = range.trim().toLowerCase(Locale.ROOT);
            if (r.startsWith("bytes=")) {
                String spec = r.substring(6).split(",")[0].trim();
                int dash = spec.indexOf('-');
                try {
                    if (dash == 0) {
                        long n = Long.parseLong(spec.substring(1));
                        start = Math.max(0, len - n);
                    } else if (dash > 0) {
                        start = Long.parseLong(spec.substring(0, dash));
                        String e = spec.substring(dash + 1);
                        if (!e.isEmpty()) end = Math.min(len - 1, Long.parseLong(e));
                    }
                    partial = true;
                } catch (NumberFormatException ignored) {}
                if (start >= len || start > end) {
                    afd.close();
                    Map<String, String> h = new HashMap<>();
                    h.put("Content-Range", "bytes */" + len);
                    return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
                }
            }
        }
        FileInputStream in = afd.createInputStream();
        if (start > 0) in.getChannel().position(afd.getStartOffset() + start);
        long count = len > 0 ? end - start + 1 : -1;
        InputStream body = new Bounded(in, count, afd);
        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Cache-Control", "no-store");
        if (count >= 0) h.put("Content-Length", String.valueOf(count));
        if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + len);
        return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, body);
    }

    private static final class Bounded extends FilterInputStream {
        private long left;
        private final AssetFileDescriptor afd;
        Bounded(InputStream in, long count, AssetFileDescriptor afd) {
            super(in);
            this.left = count;
            this.afd = afd;
        }
        @Override public int read() throws IOException {
            if (left == 0) return -1;
            int b = super.read();
            if (b >= 0 && left > 0) left--;
            return b;
        }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left == 0) return -1;
            if (left > 0) len = (int) Math.min(len, left);
            int n = super.read(b, off, len);
            if (n > 0 && left > 0) left -= n;
            return n;
        }
        @Override public void close() throws IOException {
            try { super.close(); } finally { try { afd.close(); } catch (Exception ignored) {} }
        }
    }

    // ---------------------------------------------------------------- Carátulas

    static Bitmap artBitmap(Context c, long albumId, long trackId, int size) {
        ContentResolver cr = c.getContentResolver();
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                if (albumId > 0)
                    return cr.loadThumbnail(ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, albumId), new Size(size, size), null);
            } catch (Exception ignored) {}
            try {
                if (trackId > 0)
                    return cr.loadThumbnail(ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, trackId), new Size(size, size), null);
            } catch (Exception ignored) {}
            return null;
        }
        try (InputStream in = cr.openInputStream(ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), albumId))) {
            if (in == null) return null;
            Bitmap b = BitmapFactory.decodeStream(in);
            if (b != null && (b.getWidth() > size || b.getHeight() > size)) {
                float s = Math.min((float) size / b.getWidth(), (float) size / b.getHeight());
                Bitmap sc = Bitmap.createScaledBitmap(b, Math.max(1, Math.round(b.getWidth() * s)), Math.max(1, Math.round(b.getHeight() * s)), true);
                if (sc != b) b.recycle();
                b = sc;
            }
            return b;
        } catch (Exception e) {
            return null;
        }
    }

    static byte[] artJpeg(Context c, long albumId, long trackId, int size) {
        Bitmap b = artBitmap(c, albumId, trackId, size);
        if (b == null) return null;
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.JPEG, 85, bos);
        return bos.toByteArray();
    }

    /** Para la notificación: carátula a partir de la URL /__music/art/{albumId}?t={trackId}. */
    static Bitmap artBitmapFromUrl(Context c, String url) {
        try {
            Uri u = Uri.parse(url);
            String p = u.getPath();
            if (p == null || !p.startsWith(PREFIX + "art/") || !hasPermission(c)) return null;
            long albumId = Long.parseLong(p.substring((PREFIX + "art/").length()).replaceAll("[^0-9].*$", ""));
            long trackId = 0;
            try { trackId = Long.parseLong(u.getQueryParameter("t")); } catch (Exception ignored) {}
            return artBitmap(c, albumId, trackId, 512);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean isMusicUrl(String url) {
        try {
            Uri u = Uri.parse(url);
            return MainActivity.isAppUrl(url) && u.getPath() != null && u.getPath().startsWith(PREFIX);
        } catch (Exception e) {
            return false;
        }
    }
}
