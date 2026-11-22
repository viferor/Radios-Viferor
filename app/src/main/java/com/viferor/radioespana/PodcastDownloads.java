package com.viferor.radioespana;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.StatFs;
import android.text.TextUtils;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;

/**
 * Descargas de episodios de podcast para escucharlos sin conexión (APK 1.19).
 *
 * Las hace el DownloadManager de Android (sigue aunque cierres la app, reanuda si se corta
 * y enseña el progreso en la barra de notificaciones). Los archivos van a la carpeta propia
 * de la app (Android/data/com.viferor.radioespana/files/podcasts): no hace falta ningún
 * permiso y se borran al desinstalar.
 *
 * La web los reproduce pidiendo https://radiosviferor.vercel.app/__pod/file/{nombre}, que
 * MainActivity intercepta y sirve desde aquí (con «Range» para poder saltar).
 *
 * Qué episodio es cada descarga: SharedPreferences «pod_downloads» → { clave: {id, file, url} }
 * (la clave la pone la web: el id del episodio o su URL).
 */
final class PodcastDownloads {
    static final int API_VERSION = 1;
    static final String PREFIX = "/__pod/";
    private static final String PREFS = "pod_downloads";
    private static final String DIR = "podcasts";

    private final Context ctx;

    PodcastDownloads(Context c) {
        this.ctx = c.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private File dir() {
        File base = ctx.getExternalFilesDir(DIR);
        if (base == null) base = new File(ctx.getFilesDir(), DIR);
        if (!base.exists()) base.mkdirs();
        return base;
    }

    private static String hash(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] d = md.digest(s.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 10; i++) sb.append(String.format(Locale.ROOT, "%02x", d[i]));
            return sb.toString();
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }

    private static String extOf(String url) {
        String p = "";
        try {
            p = Uri.parse(url).getLastPathSegment();
        } catch (Exception ignored) {}
        if (p == null) p = "";
        p = p.toLowerCase(Locale.ROOT);
        for (String e : new String[]{".mp3", ".m4a", ".aac", ".ogg", ".opus", ".mp4", ".wav", ".flac"}) {
            if (p.endsWith(e)) return e;
        }
        return ".mp3";
    }

    private static String mimeOf(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".m4a") || n.endsWith(".mp4") || n.endsWith(".aac")) return "audio/mp4";
        if (n.endsWith(".ogg") || n.endsWith(".opus")) return "audio/ogg";
        if (n.endsWith(".wav")) return "audio/wav";
        if (n.endsWith(".flac")) return "audio/flac";
        return "audio/mpeg";
    }

    private JSONObject all() {
        try {
            return new JSONObject(prefs().getString("map", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void save(JSONObject m) {
        prefs().edit().putString("map", m.toString()).apply();
    }

    /** Empieza a descargar un episodio. Devuelve "ok" o el motivo del fallo. */
    synchronized String start(String key, String url, String title, String podcast, boolean wifiOnly) {
        if (TextUtils.isEmpty(key) || TextUtils.isEmpty(url)) return "Falta el episodio";
        if (!url.startsWith("https://") && !url.startsWith("http://")) return "Dirección no válida";
        try {
            JSONObject m = all();
            JSONObject old = m.optJSONObject(key);
            if (old != null) {
                File f = new File(dir(), old.optString("file"));
                if (f.exists() && f.length() > 0 && stateOf(old).equals("done")) return "ok";
                remove(key);
                m = all();
            }
            String file = hash(key) + extOf(url);
            File dest = new File(dir(), file);
            if (dest.exists()) dest.delete();
            DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return "Este móvil no permite descargas";
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setTitle(TextUtils.isEmpty(title) ? "Episodio" : title);
            if (!TextUtils.isEmpty(podcast)) r.setDescription(podcast);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            r.setAllowedOverMetered(!wifiOnly);
            r.setAllowedOverRoaming(!wifiOnly);
            r.addRequestHeader("User-Agent", "RadiosViferor (Android; podcast)");
            if (ctx.getExternalFilesDir(DIR) != null) {
                r.setDestinationInExternalFilesDir(ctx, DIR, file);
            } else {
                r.setDestinationUri(Uri.fromFile(dest));
            }
            long id = dm.enqueue(r);
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("file", file);
            o.put("url", url);
            o.put("at", System.currentTimeMillis());
            m.put(key, o);
            save(m);
            return "ok";
        } catch (Exception e) {
            return "No se pudo descargar: " + e.getMessage();
        }
    }

    /** Estado de una descarga según DownloadManager y el archivo. */
    private String stateOf(JSONObject o) {
        long[] info = query(o.optLong("id", -1));
        File f = new File(dir(), o.optString("file"));
        if (info == null) return f.exists() && f.length() > 0 ? "done" : "failed";
        int st = (int) info[0];
        switch (st) {
            case DownloadManager.STATUS_SUCCESSFUL:
                return f.exists() && f.length() > 0 ? "done" : "failed";
            case DownloadManager.STATUS_RUNNING:
                return "running";
            case DownloadManager.STATUS_PAUSED:
                return "paused";
            case DownloadManager.STATUS_PENDING:
                return "queued";
            default:
                return "failed";
        }
    }

    /** [estado, descargado, total, motivo] o null si DownloadManager ya no la conoce. */
    private long[] query(long id) {
        if (id < 0) return null;
        DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return null;
        try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
            if (c == null || !c.moveToFirst()) return null;
            int iSt = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
            int iDone = c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
            int iTot = c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
            int iWhy = c.getColumnIndex(DownloadManager.COLUMN_REASON);
            return new long[]{
                    iSt >= 0 ? c.getInt(iSt) : 0,
                    iDone >= 0 ? c.getLong(iDone) : 0,
                    iTot >= 0 ? c.getLong(iTot) : -1,
                    iWhy >= 0 ? c.getInt(iWhy) : 0
            };
        } catch (Exception e) {
            return null;
        }
    }

    /** Todas las descargas: [{key, state, done, total, file, reason}]. */
    synchronized String listJson() {
        JSONArray out = new JSONArray();
        try {
            JSONObject m = all();
            Iterator<String> it = m.keys();
            while (it.hasNext()) {
                String k = it.next();
                JSONObject o = m.optJSONObject(k);
                if (o == null) continue;
                long[] info = query(o.optLong("id", -1));
                File f = new File(dir(), o.optString("file"));
                JSONObject x = new JSONObject();
                x.put("key", k);
                x.put("file", o.optString("file"));
                x.put("state", stateOf(o));
                x.put("done", info != null ? info[1] : f.length());
                x.put("total", info != null && info[2] > 0 ? info[2] : f.length());
                x.put("reason", info != null ? info[3] : 0);
                out.put(x);
            }
        } catch (Exception ignored) {}
        return out.toString();
    }

    /** Cancela o borra una descarga (y su archivo). */
    synchronized void remove(String key) {
        JSONObject m = all();
        JSONObject o = m.optJSONObject(key);
        if (o == null) return;
        try {
            DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
            long id = o.optLong("id", -1);
            if (dm != null && id >= 0) dm.remove(id);
        } catch (Exception ignored) {}
        try {
            File f = new File(dir(), o.optString("file"));
            if (f.exists()) f.delete();
        } catch (Exception ignored) {}
        m.remove(key);
        save(m);
    }

    /** Espacio usado por las descargas y libre en el móvil. */
    String storageJson() {
        long used = 0;
        File[] fs = dir().listFiles();
        if (fs != null) for (File f : fs) used += f.length();
        long free = -1;
        try {
            StatFs s = new StatFs(dir().getAbsolutePath());
            free = s.getAvailableBytes();
        } catch (Exception ignored) {}
        return "{\"used\":" + used + ",\"free\":" + free + "}";
    }

    /** /__pod/file/{nombre} → el archivo descargado, con soporte de Range. */
    WebResourceResponse handle(Uri url, Map<String, String> headers) {
        try {
            String path = url.getPath() == null ? "" : url.getPath();
            String name = path.substring(path.lastIndexOf('/') + 1);
            if (!path.startsWith(PREFIX + "file/") || !name.matches("[a-f0-9]{8,40}\\.[a-z0-9]{2,5}")) return empty(404);
            File f = new File(dir(), name);
            if (!f.exists() || !f.isFile()) return empty(404);
            String range = null;
            if (headers != null) for (Map.Entry<String, String> e : headers.entrySet()) {
                if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
            }
            long len = f.length();
            long start = 0, end = len - 1;
            boolean partial = false;
            if (range != null && len > 0) {
                String r = range.trim().toLowerCase(Locale.ROOT);
                if (r.startsWith("bytes=")) {
                    String spec = r.substring(6).split(",")[0].trim();
                    int dash = spec.indexOf('-');
                    try {
                        if (dash == 0) {
                            start = Math.max(0, len - Long.parseLong(spec.substring(1)));
                        } else if (dash > 0) {
                            start = Long.parseLong(spec.substring(0, dash));
                            String e = spec.substring(dash + 1);
                            if (!e.isEmpty()) end = Math.min(len - 1, Long.parseLong(e));
                        }
                        partial = true;
                    } catch (NumberFormatException ignored) {}
                    if (start >= len || start > end) {
                        Map<String, String> h = new HashMap<>();
                        h.put("Content-Range", "bytes */" + len);
                        return new WebResourceResponse(mimeOf(name), null, 416, "Range Not Satisfiable", h, new ByteArrayInputStream(new byte[0]));
                    }
                }
            }
            long count = end - start + 1;
            Map<String, String> h = new HashMap<>();
            h.put("Accept-Ranges", "bytes");
            h.put("Cache-Control", "no-store");
            h.put("Content-Length", String.valueOf(count));
            if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + len);
            FileInputStream in = new FileInputStream(f);
            in.getChannel().position(start);
            InputStream body = new Limited(in, count);
            return new WebResourceResponse(mimeOf(name), null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, body);
        } catch (IOException e) {
            return empty(500);
        }
    }

    private static WebResourceResponse empty(int status) {
        return new WebResourceResponse("text/plain", "utf-8", status, status == 404 ? "Not Found" : "Error",
                new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    /** Lee como mucho «left» bytes (lo pedido en el Range). */
    private static final class Limited extends InputStream {
        private final InputStream in;
        private long left;

        Limited(InputStream in, long count) {
            this.in = in;
            this.left = count;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = in.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public void close() throws IOException {
            in.close();
        }
    }
}
