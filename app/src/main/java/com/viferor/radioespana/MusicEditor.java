package com.viferor.radioespana;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.Process;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.channels.FileChannel;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Cambia el nombre del archivo y las etiquetas ID3 (MP3) de una canción del móvil.
 *
 *  - Android 11+: MediaStore.createWriteRequest → Android pide permiso para modificarla.
 *  - Android 10: si Android lo exige, pide permiso (RecoverableSecurityException).
 *  - Android 9 o anterior: permiso WRITE_EXTERNAL_STORAGE.
 *
 * Responde con window.onAndroidMusicEdited(reqId, {ok, error, file, tags}).
 */
final class MusicEditor {
    static final int EDIT_REQUEST = 1007;
    static final int WRITE_PERMISSION_REQUEST = 1008;

    interface JsSink { void run(String js); }

    private final Activity activity;
    private final JsSink js;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String reqId;
    private long id;
    private String newName;
    private Map<String, String> tags;
    private boolean retried;

    MusicEditor(Activity activity, JsSink js) {
        this.activity = activity;
        this.js = js;
    }

    private static Uri uriOf(long id) {
        return ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
    }

    void start(String reqId, String idStr, String json) {
        if (this.reqId != null) {
            reply(reqId, false, "Ya se está guardando otra canción", null, false);
            return;
        }
        try {
            long v = Long.parseLong(String.valueOf(idStr).replaceAll("\\D", ""));
            JSONObject o = new JSONObject(json == null ? "{}" : json);
            String file = o.optString("file", "").trim();
            Map<String, String> t = new HashMap<>();
            JSONObject jt = o.optJSONObject("tags");
            if (jt != null) {
                for (String k : Id3Editor.KEYS) if (jt.has(k)) t.put(k, jt.optString(k, ""));
            }
            if (file.isEmpty() && t.isEmpty()) {
                reply(reqId, true, null, null, false);
                return;
            }
            this.reqId = reqId;
            this.id = v;
            this.newName = file.isEmpty() ? null : file;
            this.tags = t;
            this.retried = false;
        } catch (Exception e) {
            reply(reqId, false, "Datos no válidos", null, false);
            return;
        }
        try {
            Uri u = uriOf(id);
            if (Build.VERSION.SDK_INT >= 30) {
                boolean can = activity.checkUriPermission(u, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED;
                if (can) work();
                else {
                    PendingIntent pi = MediaStore.createWriteRequest(activity.getContentResolver(), Collections.singletonList(u));
                    activity.startIntentSenderForResult(pi.getIntentSender(), EDIT_REQUEST, null, 0, 0, 0);
                }
            } else if (Build.VERSION.SDK_INT == 29) {
                work();
            } else if (activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                activity.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, WRITE_PERMISSION_REQUEST);
            } else {
                work();
            }
        } catch (Exception e) {
            finish(false, e.getMessage() == null ? "No se pudo modificar" : e.getMessage(), null, false);
        }
    }

    boolean onActivityResult(int requestCode, int resultCode) {
        if (requestCode != EDIT_REQUEST) return false;
        if (reqId == null) return true;
        if (resultCode == Activity.RESULT_OK) work();
        else finish(false, "cancelled", null, false);
        return true;
    }

    boolean onRequestPermissionsResult(int requestCode, int[] grantResults) {
        if (requestCode != WRITE_PERMISSION_REQUEST) return false;
        if (reqId == null) return true;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) work();
        else finish(false, "permission", null, false);
        return true;
    }

    /** El trabajo con el archivo, en segundo plano. */
    private void work() {
        new Thread(() -> {
            ContentResolver cr = activity.getContentResolver();
            Uri u = uriOf(id);
            boolean tagsDone = false;
            try {
                String data = null, display = null, mime = null;
                try (Cursor c = cr.query(u, new String[]{MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.MIME_TYPE}, null, null, null)) {
                    if (c == null || !c.moveToFirst()) throw new IllegalStateException("La canción ya no está en el móvil");
                    data = c.getString(0);
                    display = c.getString(1);
                    mime = c.getString(2);
                }
                if (!tags.isEmpty()) {
                    String name = display != null ? display : data != null ? new File(data).getName() : "";
                    boolean mp3 = "audio/mpeg".equalsIgnoreCase(mime) || name.toLowerCase().endsWith(".mp3");
                    if (!mp3) throw new IllegalStateException("Las etiquetas solo se pueden cambiar en archivos MP3");
                    writeTags(cr, u, data);
                    tagsDone = true;
                }
                String finalName = display;
                if (newName != null && !newName.equals(display)) finalName = rename(cr, u, data, display);
                String path = data;
                try (Cursor c = cr.query(u, new String[]{MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.DISPLAY_NAME}, null, null, null)) {
                    if (c != null && c.moveToFirst()) {
                        path = c.getString(0);
                        if (c.getString(1) != null) finalName = c.getString(1);
                    }
                }
                final String fn = finalName;
                final boolean td = tagsDone;
                // Que MediaStore vuelva a leer el archivo (título, artista… nuevos).
                if (path != null) {
                    final boolean[] sent = {false};
                    Runnable done = () -> {
                        if (sent[0]) return;
                        sent[0] = true;
                        finish(true, null, fn, td);
                    };
                    MediaScannerConnection.scanFile(activity, new String[]{path}, null, (p, uri) -> main.post(done));
                    main.postDelayed(done, 5000);
                } else {
                    main.post(() -> finish(true, null, fn, td));
                }
            } catch (SecurityException se) {
                if (Build.VERSION.SDK_INT == 29 && se instanceof RecoverableSecurityException && !retried) {
                    retried = true;
                    IntentSender sender = ((RecoverableSecurityException) se).getUserAction().getActionIntent().getIntentSender();
                    main.post(() -> {
                        try {
                            activity.startIntentSenderForResult(sender, EDIT_REQUEST, null, 0, 0, 0);
                        } catch (IntentSender.SendIntentException ex) {
                            finish(false, "permission", null, false);
                        }
                    });
                } else {
                    final boolean td = tagsDone;
                    main.post(() -> finish(false, "permission", null, td));
                }
            } catch (Exception e) {
                final String msg = e.getMessage() == null ? "No se pudo guardar" : e.getMessage();
                final boolean td = tagsDone;
                main.post(() -> finish(false, msg, null, td));
            }
        }, "music-edit").start();
    }

    private void writeTags(ContentResolver cr, Uri u, String data) throws Exception {
        File tmpDir = activity.getCacheDir();
        if (Build.VERSION.SDK_INT >= 29) {
            try (ParcelFileDescriptor pfd = cr.openFileDescriptor(u, "rw")) {
                if (pfd == null) throw new IllegalStateException("No se pudo abrir el archivo");
                try (FileInputStream fis = new FileInputStream(pfd.getFileDescriptor());
                     FileOutputStream fos = new FileOutputStream(pfd.getFileDescriptor())) {
                    Id3Editor.write(fis.getChannel(), fos.getChannel(), tags, tmpDir);
                }
            }
        } else {
            if (data == null) throw new IllegalStateException("No se encuentra el archivo");
            try (RandomAccessFile raf = new RandomAccessFile(data, "rw"); FileChannel c = raf.getChannel()) {
                Id3Editor.write(c, c, tags, tmpDir);
            }
        }
    }

    private String rename(ContentResolver cr, Uri u, String data, String display) throws Exception {
        String ext = "";
        String base = display != null ? display : data != null ? new File(data).getName() : "";
        int dot = base.lastIndexOf('.');
        if (dot > 0) ext = base.substring(dot);
        String want = newName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        if (want.isEmpty() || want.equals(".")) throw new IllegalStateException("Nombre no válido");
        if (!ext.isEmpty() && !want.toLowerCase().endsWith(ext.toLowerCase())) want = want + ext;
        if (want.length() > 200) want = want.substring(0, 200 - ext.length()) + ext;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Audio.Media.DISPLAY_NAME, want);
            if (cr.update(u, cv, null, null) <= 0) throw new IllegalStateException("Android no ha permitido cambiar el nombre");
        } else {
            if (data == null) throw new IllegalStateException("No se encuentra el archivo");
            File from = new File(data);
            File to = new File(from.getParentFile(), want);
            if (to.exists()) throw new IllegalStateException("Ya hay un archivo con ese nombre");
            if (!from.renameTo(to)) throw new IllegalStateException("No se pudo cambiar el nombre");
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Audio.Media.DATA, to.getAbsolutePath());
            cv.put(MediaStore.Audio.Media.DISPLAY_NAME, want);
            try { cr.update(u, cv, null, null); } catch (Exception ignored) {}
            MediaScannerConnection.scanFile(activity, new String[]{from.getAbsolutePath()}, null, null);
        }
        return want;
    }

    private void finish(boolean ok, String error, String file, boolean tagsDone) {
        String r = reqId;
        reqId = null;
        reply(r, ok, error, file, tagsDone);
    }

    private void reply(String r, boolean ok, String error, String file, boolean tagsDone) {
        try {
            JSONObject o = new JSONObject();
            o.put("ok", ok);
            if (error != null) o.put("error", error);
            if (file != null) o.put("file", file);
            o.put("tags", tagsDone);
            js.run("window.onAndroidMusicEdited && window.onAndroidMusicEdited(" + new JSONArray().put(r == null ? "" : r) + "[0]," + o + ");");
        } catch (Exception ignored) {}
    }
}
