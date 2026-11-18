package com.viferor.radioespana;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.database.ContentObserver;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * «Buscar canciones nuevas» en «Mi música» (APK 1.18+).
 *
 * La biblioteca sale de MediaStore, y Android no siempre registra al momento la música
 * copiada al móvil (desde el PC, otra app, una tarjeta SD…). Aquí:
 *  · scan(carpetas): pide al escáner de Android que revise esas carpetas (o todo el
 *    almacenamiento) — registra las canciones nuevas, actualiza las cambiadas y quita
 *    las borradas — y avisa a la web con window.onAndroidMusicScan({ok, folders, ms}).
 *  · pickFolder(): selector de carpetas del sistema → window.onAndroidMusicFolder(ruta).
 *  · Vigila MediaStore: cualquier cambio en la música del móvil se avisa a la web con
 *    window.onAndroidMusicChanged() para que la biblioteca se refresque sola.
 */
final class MusicScanner {
    static final int API_VERSION = 1;
    static final int PICK_FOLDER_REQUEST = 7311;
    private static final String AUDIO_EXT = ".*\\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|wma|alac|aiff?|ape|mka|mp4|3gp|amr|dsf|dff|wv)$";

    interface Js {
        void run(String js);
    }

    private final Activity activity;
    private final Js js;
    private final Handler main = new Handler(Looper.getMainLooper());
    private ContentObserver observer;
    private volatile boolean scanning = false;
    private final Runnable notifyChanged = new Runnable() {
        @Override
        public void run() {
            js.run("try{window.onAndroidMusicChanged&&window.onAndroidMusicChanged()}catch(e){}");
        }
    };

    MusicScanner(Activity activity, Js js) {
        this.activity = activity;
        this.js = js;
    }

    // ------------------------------------------------------------ Vigilar cambios

    void startWatching() {
        if (observer != null) return;
        observer = new ContentObserver(main) {
            @Override
            public void onChange(boolean selfChange) {
                // Llegan a ráfagas (una por archivo): se avisa una vez cuando se calman.
                main.removeCallbacks(notifyChanged);
                main.postDelayed(notifyChanged, scanning ? 2500 : 1200);
            }
        };
        try {
            activity.getContentResolver().registerContentObserver(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, observer);
        } catch (Exception e) {
            observer = null;
        }
    }

    void stopWatching() {
        main.removeCallbacks(notifyChanged);
        if (observer == null) return;
        try {
            activity.getContentResolver().unregisterContentObserver(observer);
        } catch (Exception ignored) {}
        observer = null;
    }

    // ------------------------------------------------------------ Escanear

    /** Raíces del almacenamiento: interno y tarjetas SD. */
    List<String> storageRoots() {
        Set<String> out = new LinkedHashSet<>();
        out.add(Environment.getExternalStorageDirectory().getAbsolutePath());
        try {
            for (File f : activity.getExternalFilesDirs(null)) {
                if (f == null) continue;
                String p = f.getAbsolutePath();
                int i = p.indexOf("/Android/data/");
                if (i > 0) out.add(p.substring(0, i));
            }
        } catch (Exception ignored) {}
        return new ArrayList<>(out);
    }

    /** JSON con las raíces, para la web: [{path, name}]. */
    String rootsJson() {
        JSONArray a = new JSONArray();
        String primary = Environment.getExternalStorageDirectory().getAbsolutePath();
        for (String r : storageRoots()) {
            try {
                a.put(new JSONObject().put("path", r).put("name", r.equals(primary) ? "Memoria interna" : "Tarjeta SD (" + new File(r).getName() + ")"));
            } catch (Exception ignored) {}
        }
        return a.toString();
    }

    /** foldersJson: ["/storage/emulated/0/Music", …] o [] para todo el almacenamiento. */
    void scan(final String reqId, String foldersJson) {
        final List<String> dirs = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(foldersJson == null || foldersJson.isEmpty() ? "[]" : foldersJson);
            for (int i = 0; i < a.length(); i++) {
                String p = a.optString(i, "").trim();
                if (!p.isEmpty() && new File(p).isDirectory()) dirs.add(new File(p).getAbsolutePath());
            }
        } catch (Exception ignored) {}
        if (dirs.isEmpty()) dirs.addAll(storageRoots());
        scanning = true;
        final long t0 = System.currentTimeMillis();
        new Thread(() -> {
            String[] paths;
            if (Build.VERSION.SDK_INT >= 29) {
                // Android 10+: el escáner recorre la carpeta entera él solo (subcarpetas
                // incluidas) y además quita las canciones que ya no están.
                paths = dirs.toArray(new String[0]);
            } else {
                Set<String> files = new LinkedHashSet<>();
                for (String d : dirs) walk(new File(d), files, 0);
                files.addAll(missingUnder(dirs)); // borradas: el escáner las quita
                paths = files.toArray(new String[0]);
            }
            if (paths.length == 0) {
                done(reqId, dirs, t0, true);
                return;
            }
            final AtomicInteger left = new AtomicInteger(paths.length);
            final String[] p = paths;
            try {
                MediaScannerConnection.scanFile(activity.getApplicationContext(), p, null, (path, uri) -> {
                    if (left.decrementAndGet() == 0) done(reqId, dirs, t0, true);
                });
            } catch (Exception e) {
                done(reqId, dirs, t0, false);
                return;
            }
            // Por si algún fabricante no llama a todas las respuestas.
            main.postDelayed(() -> {
                if (left.get() > 0) {
                    left.set(-1000000);
                    done(reqId, dirs, t0, true);
                }
            }, 120000);
        }, "music-scan").start();
    }

    private void done(String reqId, List<String> dirs, long t0, boolean ok) {
        scanning = false;
        JSONObject o = new JSONObject();
        try {
            o.put("id", reqId == null ? "" : reqId).put("ok", ok).put("folders", new JSONArray(dirs)).put("ms", System.currentTimeMillis() - t0);
        } catch (Exception ignored) {}
        final String s = "try{window.onAndroidMusicScan&&window.onAndroidMusicScan(" + o + ")}catch(e){}";
        main.post(() -> js.run(s));
    }

    private static void walk(File dir, Set<String> out, int depth) {
        if (depth > 12 || dir == null) return;
        if (new File(dir, ".nomedia").exists()) return;
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            String n = f.getName();
            if (n.startsWith(".")) continue;
            if (f.isDirectory()) {
                if (depth == 0 && n.equals("Android")) continue;
                walk(f, out, depth + 1);
            } else if (n.toLowerCase(Locale.ROOT).matches(AUDIO_EXT)) out.add(f.getAbsolutePath());
        }
    }

    /** (Android 9 o menos) Canciones registradas en esas carpetas cuyo archivo ya no existe. */
    private List<String> missingUnder(List<String> dirs) {
        List<String> out = new ArrayList<>();
        try (Cursor c = activity.getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, new String[]{MediaStore.Audio.Media.DATA}, null, null, null)) {
            if (c == null) return out;
            while (c.moveToNext()) {
                String p = c.getString(0);
                if (p == null) continue;
                for (String d : dirs) {
                    if (p.startsWith(d + "/") && !new File(p).exists()) {
                        out.add(p);
                        break;
                    }
                }
            }
        } catch (Exception ignored) {}
        return out;
    }

    // ------------------------------------------------------------ Elegir carpeta

    void pickFolder() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Music"));
            } catch (Exception ignored) {}
        }
        try {
            activity.startActivityForResult(i, PICK_FOLDER_REQUEST);
        } catch (Exception e) {
            reportFolder(null, "No hay selector de carpetas en este móvil");
        }
    }

    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != PICK_FOLDER_REQUEST) return false;
        Uri tree = resultCode == Activity.RESULT_OK && data != null ? data.getData() : null;
        if (tree == null) {
            reportFolder(null, null);
            return true;
        }
        String path = treeToPath(tree);
        reportFolder(path, path == null ? "No se puede usar esa carpeta (elige una de la memoria interna o la tarjeta SD)" : null);
        return true;
    }

    /** content://…/tree/primary:Music/Rock → /storage/emulated/0/Music/Rock */
    static String treeToPath(Uri tree) {
        try {
            if (!"com.android.externalstorage.documents".equals(tree.getAuthority())) return null;
            String id = DocumentsContract.getTreeDocumentId(tree);
            int c = id.indexOf(':');
            if (c < 0) return null;
            String vol = id.substring(0, c), rel = id.substring(c + 1);
            String base = "primary".equalsIgnoreCase(vol) ? Environment.getExternalStorageDirectory().getAbsolutePath() : "/storage/" + vol;
            File f = rel.isEmpty() ? new File(base) : new File(base, rel);
            return f.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }

    private void reportFolder(String path, String error) {
        JSONObject o = new JSONObject();
        try {
            o.put("path", path == null ? "" : path).put("error", error == null ? "" : error);
        } catch (Exception ignored) {}
        final String s = "try{window.onAndroidMusicFolder&&window.onAndroidMusicFolder(" + o + ")}catch(e){}";
        main.post(() -> js.run(s));
    }
}
