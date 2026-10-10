package com.viferor.radioespana;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Programa la comprobación periódica de episodios nuevos (cada 6 h, con red). */
public final class PodcastNotificationScheduler {
    private static final int JOB_ID = 7408;
    private static final long INTERVAL = 6L * 60L * 60L * 1000L;

    private PodcastNotificationScheduler() {
    }

    public static void schedule(Context context) {
        cancelLegacyAlarm(context);
        JobScheduler js = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js == null) return;
        // Si ya está programado no se vuelve a programar (reprogramar reinicia el periodo).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            if (js.getPendingJob(JOB_ID) != null) return;
        } else {
            for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == JOB_ID) return;
        }
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, PodcastCheckJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(INTERVAL)
                .setPersisted(true)
                .build();
        try {
            js.schedule(job);
        } catch (Exception ignored) {
        }
    }

    // Las versiones anteriores usaban una alarma con PodcastNotificationReceiver
    // (ya eliminado). Se cancela para que no quede apuntando a una clase inexistente.
    private static void cancelLegacyAlarm(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent().setComponent(
                    new ComponentName(context.getPackageName(), "com.viferor.radioespana.PodcastNotificationReceiver"));
            PendingIntent pi = PendingIntent.getBroadcast(context, 7408, i,
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        } catch (Exception ignored) {
        }
    }
}
