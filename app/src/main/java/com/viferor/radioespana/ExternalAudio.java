package com.viferor.radioespana;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.MediaStore;
import android.provider.OpenableColumns;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Archivos de audio abiertos desde otras apps. Cada uno recibe una ficha con la que la web
 * lo reproduce por /__music/ext/{ficha} (y su carátula por /__music/extart/{ficha}).
 */
final class ExternalAudio {
    static final class Item {
        final Uri uri;
        final String mime;
        byte[] art;
        Item(Uri uri, String mime) { this.uri = uri; this.mime = mime; }
    }

    private static final Map<String, Item> ITEMS = new LinkedHashMap<String, Item>() {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Item> e) { return size() > 30; }
    };
    private static final SecureRandom RND = new SecureRandom();

    static synchronized Item get(String token) {
        return ITEMS.get(token);
    }

    private static synchronized String put(Item it) {
        byte[] b = new byte[12];
        RND.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        ITEMS.put(sb.toString(), it);
        return sb.toString();
    }

    static boolean isPlaylist(String name, String mime) {
        String n = name == null ? "" : name.toLowerCase();
        String m = mime == null ? "" : mime.toLowerCase();
        return n.endsWith(".m3u") || n.endsWith(".m3u8") || m.contains("mpegurl");
    }

    /** Prepara el archivo y devuelve el JSON que recibe la web. Se llama en segundo plano. */
    static JSONObject describe(Context c, Uri uri, String type) throws Exception {
        ContentResolver cr = c.getContentResolver();
        JSONObject o = new JSONObject();
        String name = null;
        long size = -1;
        try (Cursor cur = cr.query(uri, new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cur != null && cur.moveToFirst()) {
                name = cur.getString(0);
                if (!cur.isNull(1)) size = cur.getLong(1);
            }
        } catch (Exception ignored) {}
        if (name == null) name = uri.getLastPathSegment();
        String mime = type;
        try { if (mime == null || mime.equals("*/*")) mime = cr.getType(uri); } catch (Exception ignored) {}
        o.put("name", name == null ? "" : name);
        o.put("size", size);
        o.put("mime", mime == null ? "" : mime);

        if (isPlaylist(name, mime)) {
            try (InputStream in = cr.openInputStream(uri)) {
                if (in == null) throw new IllegalStateException("No se pudo leer la lista");
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int r;
                while ((r = in.read(buf)) > 0 && bo.size() < 2_000_000) bo.write(buf, 0, r);
                o.put("playlist", true);
                o.put("text", new String(bo.toByteArray(), StandardCharsets.UTF_8));
            }
            return o;
        }

        // ¿Es una canción de la biblioteca? (así se reproduce con su ficha, favoritos, letra…)
        long mediaId = -1;
        try {
            if (MediaStore.AUTHORITY.equals(uri.getAuthority()) && uri.getPath() != null && uri.getPath().contains("/audio/media/")) {
                mediaId = ContentUris.parseId(uri);
            }
        } catch (Exception ignored) {}
        if (mediaId < 0 && name != null && LocalMusic.hasPermission(c)) {
            String sel = MediaStore.Audio.Media.DISPLAY_NAME + "=?" + (size > 0 ? " AND " + MediaStore.Audio.Media.SIZE + "=?" : "");
            String[] args = size > 0 ? new String[]{name, String.valueOf(size)} : new String[]{name};
            try (Cursor cur = cr.query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, new String[]{MediaStore.Audio.Media._ID}, sel, args, null)) {
                if (cur != null && cur.getCount() == 1 && cur.moveToFirst()) mediaId = cur.getLong(0);
            } catch (Exception ignored) {}
        }
        if (mediaId > 0) o.put("mediaId", mediaId);

        Item it = new Item(uri, mime);
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(c, uri);
            putIf(o, "title", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE));
            putIf(o, "artist", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST));
            putIf(o, "album", mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM));
            String d = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (d != null) o.put("dur", Long.parseLong(d) / 1000.0);
            byte[] pic = mmr.getEmbeddedPicture();
            if (pic != null && pic.length < 4_000_000) it.art = pic;
        } catch (Exception ignored) {
        } finally {
            try { mmr.release(); } catch (Exception ignored) {}
        }
        String token = put(it);
        o.put("token", token);
        o.put("art", it.art != null);
        return o;
    }

    private static void putIf(JSONObject o, String k, String v) throws Exception {
        if (v != null && !v.trim().isEmpty()) o.put(k, v.trim());
    }
}
