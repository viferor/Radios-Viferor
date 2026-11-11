package com.viferor.radioespana;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import org.json.JSONArray;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Borra canciones del móvil (archivos de MediaStore) a petición de la web.
 *
 *  - Android 11+: MediaStore.createDeleteRequest → Android pide confirmación una vez para todas.
 *  - Android 10: se borra una a una; si Android lo exige, pide permiso (RecoverableSecurityException).
 *  - Android 9 o anterior: permiso WRITE_EXTERNAL_STORAGE y borrado directo.
 *
 * Al terminar comprueba cuáles ya no existen y avisa a la web con
 * window.onAndroidMusicDeleted(reqId, [ids borrados], error).
 */
final class MusicDeleter {
    static final int DELETE_REQUEST = 1005;
    static final int WRITE_PERMISSION_REQUEST = 1006;

    interface JsSink { void run(String js); }

    private final Activity activity;
    private final JsSink js;
    private String reqId;
    private List<Long> ids = new ArrayList<>();
    private int q29 = 0; // Android 10: índice de la que se está borrando

    MusicDeleter(Activity activity, JsSink js) {
        this.activity = activity;
        this.js = js;
    }

    /** "system" (Android pregunta), "app" (pregunta la app) o "none". */
    static String mode() {
        return Build.VERSION.SDK_INT >= 30 ? "system" : "app";
    }

    private static Uri uriOf(long id) {
        return ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
    }

    void start(String reqId, String idsCsv) {
        if (this.reqId != null) {
            finish(reqId, new ArrayList<>(), "Ya hay un borrado en curso");
            return;
        }
        List<Long> list = new ArrayList<>();
        for (String s : String.valueOf(idsCsv).split(",")) {
            try {
                long v = Long.parseLong(s.trim());
                if (v > 0 && !list.contains(v)) list.add(v);
            } catch (NumberFormatException ignored) {}
        }
        if (list.isEmpty()) {
            finish(reqId, new ArrayList<>(), "Nada que borrar");
            return;
        }
        this.reqId = reqId;
        this.ids = list;
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                List<Uri> uris = new ArrayList<>();
                for (long id : ids) uris.add(uriOf(id));
                PendingIntent pi = MediaStore.createDeleteRequest(activity.getContentResolver(), uris);
                activity.startIntentSenderForResult(pi.getIntentSender(), DELETE_REQUEST, null, 0, 0, 0);
            } else if (Build.VERSION.SDK_INT == 29) {
                q29 = 0;
                continue29();
            } else {
                if (activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                    activity.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, WRITE_PERMISSION_REQUEST);
                } else {
                    deleteLegacy();
                }
            }
        } catch (Exception e) {
            done(e.getMessage() == null ? "No se pudo borrar" : e.getMessage());
        }
    }

    private void continue29() {
        ContentResolver cr = activity.getContentResolver();
        while (q29 < ids.size()) {
            Uri u = uriOf(ids.get(q29));
            try {
                cr.delete(u, null, null);
                q29++;
            } catch (SecurityException se) {
                if (Build.VERSION.SDK_INT >= 29 && se instanceof RecoverableSecurityException) {
                    IntentSender sender = ((RecoverableSecurityException) se).getUserAction().getActionIntent().getIntentSender();
                    try {
                        activity.startIntentSenderForResult(sender, DELETE_REQUEST, null, 0, 0, 0);
                        return; // se sigue en onActivityResult
                    } catch (IntentSender.SendIntentException ex) {
                        q29++;
                    }
                } else {
                    q29++;
                }
            } catch (Exception e) {
                q29++;
            }
        }
        done(null);
    }

    private void deleteLegacy() {
        ContentResolver cr = activity.getContentResolver();
        for (long id : ids) {
            Uri u = uriOf(id);
            String path = null;
            try (Cursor c = cr.query(u, new String[]{MediaStore.Audio.Media.DATA}, null, null, null)) {
                if (c != null && c.moveToFirst()) path = c.getString(0);
            } catch (Exception ignored) {}
            try {
                if (path != null) {
                    File f = new File(path);
                    if (f.exists()) f.delete();
                }
            } catch (Exception ignored) {}
            try { cr.delete(u, null, null); } catch (Exception ignored) {}
        }
        done(null);
    }

    boolean onActivityResult(int requestCode, int resultCode) {
        if (requestCode != DELETE_REQUEST) return false;
        if (reqId == null) return true;
        if (Build.VERSION.SDK_INT == 29) {
            if (resultCode == Activity.RESULT_OK) continue29(); // reintenta la misma, ya con permiso
            else {
                q29++;
                continue29();
            }
            return true;
        }
        done(resultCode == Activity.RESULT_OK ? null : "cancelled");
        return true;
    }

    boolean onRequestPermissionsResult(int requestCode, int[] grantResults) {
        if (requestCode != WRITE_PERMISSION_REQUEST) return false;
        if (reqId == null) return true;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) deleteLegacy();
        else done("permission");
        return true;
    }

    /** Comprueba cuáles han desaparecido de verdad y avisa a la web. */
    private void done(String error) {
        List<Long> gone = new ArrayList<>();
        ContentResolver cr = activity.getContentResolver();
        for (long id : ids) {
            boolean exists = false;
            try (Cursor c = cr.query(uriOf(id), new String[]{MediaStore.Audio.Media._ID}, null, null, null)) {
                exists = c != null && c.moveToFirst();
            } catch (Exception ignored) {}
            if (!exists) gone.add(id);
        }
        String r = reqId;
        reqId = null;
        ids = new ArrayList<>();
        finish(r, gone, gone.isEmpty() ? error : null);
    }

    private void finish(String r, List<Long> gone, String error) {
        JSONArray arr = new JSONArray();
        for (long id : gone) arr.put(id);
        js.run("window.onAndroidMusicDeleted && window.onAndroidMusicDeleted(" + new JSONArray().put(r == null ? "" : r).toString() + "[0]," + arr + "," + (error == null ? "null" : new JSONArray().put(error).toString() + "[0]") + ");");
    }
}
