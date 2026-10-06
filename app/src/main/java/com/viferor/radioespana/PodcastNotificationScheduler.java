package com.viferor.radioespana;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

public final class PodcastNotificationScheduler {
    private static final int REQUEST_CODE = 7408;
    private static final long INTERVAL = 6L * 60L * 60L * 1000L;
    private PodcastNotificationScheduler() {}

    public static void schedule(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(context, PodcastNotificationReceiver.class);
        PendingIntent pi = PendingIntent.getBroadcast(context, REQUEST_CODE, i,
                PendingIntent.FLAG_UPDATE_CURRENT | (android.os.Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        am.cancel(pi);
        am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                SystemClock.elapsedRealtime() + 60_000L, INTERVAL, pi);
    }
}
