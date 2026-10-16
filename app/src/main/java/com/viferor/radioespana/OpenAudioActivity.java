package com.viferor.radioespana;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * Recibe «Abrir con…» / «Compartir» de archivos de audio y listas M3U desde otras apps
 * (gestor de archivos, WhatsApp, Telegram…) y se lo pasa a la ventana principal de la app,
 * sin abrir una segunda copia de la app dentro de la otra.
 */
public class OpenAudioActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        Uri uri = null;
        String type = null;
        if (in != null) {
            type = in.getType();
            if (Intent.ACTION_SEND.equals(in.getAction())) {
                Object s = in.getParcelableExtra(Intent.EXTRA_STREAM);
                if (s instanceof Uri) uri = (Uri) s;
            } else {
                uri = in.getData();
            }
        }
        if (uri != null) {
            Intent out = new Intent(this, MainActivity.class);
            out.setAction(MainActivity.ACTION_OPEN_AUDIO);
            out.setDataAndType(uri, type);
            out.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try {
                startActivity(out);
            } catch (Exception ignored) {}
        }
        finish();
    }
}
