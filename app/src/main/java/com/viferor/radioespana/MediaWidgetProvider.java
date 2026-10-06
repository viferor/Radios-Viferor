package com.viferor.radioespana;
import android.app.*;import android.appwidget.*;import android.content.*;import android.widget.RemoteViews;
public class MediaWidgetProvider extends AppWidgetProvider {
 static final String PREF="media_widget_state";
 @Override public void onUpdate(Context c,AppWidgetManager m,int[] ids){for(int id:ids)update(c,m,id);}
 static void update(Context c,AppWidgetManager m,int id){RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.media_widget);android.content.SharedPreferences p=c.getSharedPreferences(PREF,0);v.setTextViewText(R.id.widgetTitle,p.getString("title","Radios Viferor"));v.setTextViewText(R.id.widgetSub,p.getString("subtitle","Sin reproducción"));
   bind(c,v,R.id.widgetPrev,MediaPlaybackService.ACTION_PREV,0);bind(c,v,R.id.widgetBack,MediaPlaybackService.ACTION_SEEK,-15000);bind(c,v,R.id.widgetPlay,MediaPlaybackService.ACTION_PLAY_PAUSE,0);bind(c,v,R.id.widgetForward,MediaPlaybackService.ACTION_SEEK,15000);bind(c,v,R.id.widgetNext,MediaPlaybackService.ACTION_NEXT,0);m.updateAppWidget(id,v);}
 static void bind(Context c,RemoteViews v,int id,String action,long delta){Intent i=new Intent(c,MediaControlReceiver.class).setAction(action);if(delta!=0)i.putExtra(MediaPlaybackService.EXTRA_DELTA,delta);v.setOnClickPendingIntent(id,PendingIntent.getBroadcast(c,9000+id,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));}
 public static void refresh(Context c){AppWidgetManager m=AppWidgetManager.getInstance(c);ComponentName n=new ComponentName(c,MediaWidgetProvider.class);for(int id:m.getAppWidgetIds(n))update(c,m,id);}
}
