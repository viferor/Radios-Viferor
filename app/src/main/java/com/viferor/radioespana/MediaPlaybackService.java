package com.viferor.radioespana;

import android.app.*;
import android.content.*;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.*;
import android.text.TextUtils;
import java.util.Locale;

public class MediaPlaybackService extends Service {
    public static final String ACTION_UPDATE = "com.viferor.radioespana.MEDIA_UPDATE";
    public static final String ACTION_PLAY_PAUSE = "com.viferor.radioespana.MEDIA_PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.viferor.radioespana.MEDIA_NEXT";
    public static final String ACTION_PREV = "com.viferor.radioespana.MEDIA_PREV";
    public static final String ACTION_SEEK = "com.viferor.radioespana.MEDIA_SEEK";
    public static final String ACTION_STOP = "com.viferor.radioespana.MEDIA_STOP";
    public static final String EXTRA_TITLE="title", EXTRA_SUBTITLE="subtitle", EXTRA_TYPE="type", EXTRA_PLAYING="playing", EXTRA_DURATION="duration", EXTRA_POSITION="position", EXTRA_DELTA="delta";
    private static final String CHANNEL="media_playback";
    private static final int NOTIFICATION_ID=8101;
    private MediaSession session;
    private String title="Radios Viferor", subtitle="";
    private boolean playing=false;
    private long duration=0, position=0;

    @Override public void onCreate(){super.onCreate();createChannel();
        session=new MediaSession(this,"RadiosViferor");
        session.setCallback(new MediaSession.Callback(){
            @Override public void onPlay(){send(ACTION_PLAY_PAUSE);}
            @Override public void onPause(){send(ACTION_PLAY_PAUSE);}
            @Override public void onSkipToNext(){send(ACTION_NEXT);}
            @Override public void onSkipToPrevious(){send(ACTION_PREV);}
            @Override public void onSeekTo(long p){ Intent i=new Intent(ACTION_SEEK); i.setPackage(getPackageName()); i.putExtra(EXTRA_POSITION,p); sendToApp(i); }
        });
        session.setActive(true);
    }
    private void send(String action){Intent i=new Intent(action);i.setPackage(getPackageName());sendToApp(i);}
    private void sendToApp(Intent i){sendBroadcast(i);}
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null){String a=intent.getAction();
            if(ACTION_UPDATE.equals(a)){title=intent.getStringExtra(EXTRA_TITLE);subtitle=intent.getStringExtra(EXTRA_SUBTITLE);playing=intent.getBooleanExtra(EXTRA_PLAYING,false);duration=intent.getLongExtra(EXTRA_DURATION,0);position=intent.getLongExtra(EXTRA_POSITION,0);updateNotification();}
            else if(ACTION_STOP.equals(a)){stopForeground(true);stopSelf();return START_NOT_STICKY;}
            else if(ACTION_PLAY_PAUSE.equals(a)||ACTION_NEXT.equals(a)||ACTION_PREV.equals(a)){send(a);}
            else if(ACTION_SEEK.equals(a)){Intent i=new Intent(ACTION_SEEK);i.setPackage(getPackageName());if(intent.hasExtra(EXTRA_DELTA)) i.putExtra(EXTRA_DELTA,intent.getLongExtra(EXTRA_DELTA,0)); else i.putExtra(EXTRA_POSITION,intent.getLongExtra(EXTRA_POSITION,0));sendToApp(i);}
        }
        if(session!=null) updatePlaybackState();
        return START_STICKY;
    }
    private void updatePlaybackState(){int state=playing?PlaybackState.STATE_PLAYING:PlaybackState.STATE_PAUSED;long actions=PlaybackState.ACTION_PLAY|PlaybackState.ACTION_PAUSE|PlaybackState.ACTION_PLAY_PAUSE|PlaybackState.ACTION_SKIP_TO_NEXT|PlaybackState.ACTION_SKIP_TO_PREVIOUS; if(duration>0)actions|=PlaybackState.ACTION_SEEK_TO|PlaybackState.ACTION_FAST_FORWARD|PlaybackState.ACTION_REWIND;session.setPlaybackState(new PlaybackState.Builder().setActions(actions).setState(state,position,1f).build());}
    private void updateNotification(){
        getSharedPreferences(MediaWidgetProvider.PREF,0).edit().putString("title",title==null?"Radios Viferor":title).putString("subtitle",subtitle==null?"":subtitle).apply();
        MediaWidgetProvider.refresh(this);
        updatePlaybackState();Intent open=new Intent(this,MainActivity.class);open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);PendingIntent content=PendingIntent.getActivity(this,8100,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Action prev=new Notification.Action.Builder(android.R.drawable.ic_media_previous,"Anterior",broadcast(ACTION_PREV,8102)).build();
        Notification.Action play=new Notification.Action.Builder(playing?android.R.drawable.ic_media_pause:android.R.drawable.ic_media_play,playing?"Pausar":"Reproducir",broadcast(ACTION_PLAY_PAUSE,8103)).build();
        Notification.Action next=new Notification.Action.Builder(android.R.drawable.ic_media_next,"Siguiente",broadcast(ACTION_NEXT,8104)).build();
        Notification.Builder b=new Notification.Builder(this,CHANNEL).setSmallIcon(R.mipmap.ic_launcher).setContentTitle(TextUtils.isEmpty(title)?"Radios Viferor":title).setContentText(subtitle).setContentIntent(content).setOngoing(playing).setOnlyAlertOnce(true).setShowWhen(false).setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0,1,2)).addAction(prev).addAction(play).addAction(next);
        if(Build.VERSION.SDK_INT>=26)startForeground(NOTIFICATION_ID,b.build());
    }
    private PendingIntent broadcast(String action,int req){Intent i=new Intent(this,MediaControlReceiver.class);i.setAction(action);return PendingIntent.getBroadcast(this,req,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private void createChannel(){if(Build.VERSION.SDK_INT>=26){NotificationManager nm=getSystemService(NotificationManager.class);if(nm!=null)nm.createNotificationChannel(new NotificationChannel(CHANNEL,"Reproductor multimedia",NotificationManager.IMPORTANCE_LOW));}}
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){if(session!=null){session.setActive(false);session.release();}super.onDestroy();}
}
