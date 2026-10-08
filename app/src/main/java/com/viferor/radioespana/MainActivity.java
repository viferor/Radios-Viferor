package com.viferor.radioespana;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.Intent;
import android.webkit.CookieManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.content.SharedPreferences;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.graphics.Bitmap;
import org.json.JSONObject;
import android.view.Window;

public class MainActivity extends Activity {
    private static final String START_URL = "https://radiosviferor.vercel.app/";
    private static final String APP_HOST = "radiosviferor.vercel.app";
    public static final String EXTRA_PODCAST_FEED_URL = "podcastFeedUrl";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int FILE_SAVE_REQUEST = 1002;
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1003;
    private static final String NOTIFICATION_CHANNEL_ID = "general";
    private static final String PREFS_NAME = "radio_viferor_prefs";
    private static final String PREF_PODCAST_SUBS = "podcast_subscriptions_json";
    private static final String PREF_PLAYBACK_SECTION = "playback_section";
    private PodcastMediaController podcastMediaController;
    private static MainActivity activeInstance;

    private WebView webView;
    // El puente «Android» solo responde mientras el WebView muestra la app.
    private volatile boolean bridgeTrusted = false;
    private ValueCallback<Uri[]> filePathCallback;
    private String pendingSaveContent;
    private String pendingSaveMime;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        activeInstance = this;
        requestWindowFeature(Window.FEATURE_NO_TITLE);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setDatabaseEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUserAgentString(settings.getUserAgentString() + " RadiosViferor/" + appVersionName());

        webView.setWebViewClient(new AppWebViewClient());
        createNotificationChannel();
        PodcastNotificationScheduler.schedule(this);
        podcastMediaController = PodcastMediaController.get(this);
        webView.addJavascriptInterface(new AndroidBridge(), "Android");
        webView.setWebChromeClient(new RadioChromeClient());
        webView.loadUrl(START_URL);
        String initialAction = getIntent() == null ? null : getIntent().getAction();
        if (initialAction != null) webView.postDelayed(() -> handleMediaControlAction(initialAction), 1500);
        handleNotificationIntent(getIntent());
        handleWidgetOpenIntent(getIntent());
    }

    @Override
    protected void onDestroy() {
        if (activeInstance == this) activeInstance = null;
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            try { webView.loadUrl("about:blank"); } catch (Exception ignored) {}
            try { webView.stopLoading(); } catch (Exception ignored) {}
            try { webView.destroy(); } catch (Exception ignored) {}
            webView = null;
        }
        if (podcastMediaController != null) {
            try { podcastMediaController.release(); } catch (Exception ignored) {}
            podcastMediaController = null;
        }
        super.onDestroy();
    }

    public static boolean dispatchMediaActionToActive(String action) {
        MainActivity a = activeInstance;
        if (a == null || a.webView == null) return false;
        a.runOnUiThread(() -> a.handleMediaControlAction(action));
        return true;
    }

    private String appVersionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }

    static boolean isAppUrl(String url) {
        try {
            Uri u = Uri.parse(url);
            return "https".equalsIgnoreCase(u.getScheme()) && APP_HOST.equalsIgnoreCase(u.getHost());
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Solo se navega dentro de la app. Cualquier otro enlace se abre fuera (navegador,
     * app correspondiente), para que una página ajena nunca tenga acceso al puente.
     */
    private class AppWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            return handleNavigation(request.getUrl() == null ? "" : request.getUrl().toString());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(url);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            bridgeTrusted = isAppUrl(url);
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            bridgeTrusted = isAppUrl(url);
            super.doUpdateVisitedHistory(view, url, isReload);
        }
    }

    private boolean handleNavigation(String url) {
        if (isAppUrl(url)) return false;
        if ("about:blank".equals(url)) return false;
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo abrir el enlace", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private class RadioChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view,
                                         ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;

            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/json",
                    "text/json",
                    "text/plain",
                    "text/xml",
                    "application/xml",
                    "application/octet-stream"
            });

            try {
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
            } catch (Exception e) {
                // Some Android file managers do not advertise application/json.
                intent.setType("*/*");
                startActivityForResult(intent, FILE_CHOOSER_REQUEST);
            }
            return true;
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null) handleMediaControlAction(intent.getAction());
        handleNotificationIntent(intent);
        handleWidgetOpenIntent(intent);
    }

    private void handleWidgetOpenIntent(Intent intent) {
        if (intent == null || webView == null) return;
        String section = intent.getStringExtra("openSection");
        if (section == null || section.isEmpty()) {
            section = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREF_PLAYBACK_SECTION, "radio");
        }
        final String js = "podcast".equalsIgnoreCase(section)
                ? "window.switchToPodcasts&&window.switchToPodcasts();"
                : "window.switchToRadios&&window.switchToRadios();";
        webView.postDelayed(() -> webView.evaluateJavascript(js, null), 1800);
        webView.postDelayed(() -> webView.evaluateJavascript(js, null), 3500);
        intent.removeExtra("openSection");
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        String feedUrl = intent.getStringExtra(EXTRA_PODCAST_FEED_URL);
        // Compatibilidad con notificaciones creadas por versiones anteriores.
        if (feedUrl == null || feedUrl.isEmpty()) feedUrl = intent.getStringExtra("podcastEpisodeUrl");
        if (feedUrl == null || feedUrl.isEmpty() || webView == null) return;
        final String js = "window.openPodcastFromNotification && window.openPodcastFromNotification(" + JSONObject.quote(feedUrl) + ");";
        webView.postDelayed(() -> { if (webView != null) webView.evaluateJavascript(js, null); }, 1200);
        intent.removeExtra(EXTRA_PODCAST_FEED_URL);
        intent.removeExtra("podcastEpisodeUrl");
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // La WebView y sus elementos multimedia se mantienen vivos al girar el dispositivo.
    }


    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) {
                NotificationChannel channel = new NotificationChannel(
                        NOTIFICATION_CHANNEL_ID,
                        "Radios Viferor",
                        NotificationManager.IMPORTANCE_DEFAULT
                );
                channel.setDescription("Notificaciones de Radios Viferor");
                nm.createNotificationChannel(channel);
            }
        }
    }

    private boolean areNotificationsEnabledNative() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            // areNotificationsEnabled() was introduced in API 24.
            // Keep minSdk 23 and treat API 23 as enabled here; Android 6
            // does not expose a per-app notification switch through this API.
            return true;
        }
        NotificationManager nm = getSystemService(NotificationManager.class);
        return nm == null || nm.areNotificationsEnabled();
    }

    private void notifyWebNotificationPermission(boolean granted) {
        if (webView == null) return;
        String js = "window.onAndroidNotificationPermissionResult && window.onAndroidNotificationPermissionResult(" + (granted ? "true" : "false") + ");";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    private void requestNotificationPermissionNative() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                notifyWebNotificationPermission(true);
                return;
            }
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        } else {
            openNotificationSettingsNative();
        }
    }

    private void openNotificationSettingsNative() {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName());
            startActivity(intent);
        } catch (Exception e) {
            Intent intent = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        }
    }

    public void evalPodcastJavascript(String js) {
        if (webView != null) webView.post(() -> webView.evaluateJavascript(js, null));
    }

    public void handleMediaControlAction(String action) {
        if (action == null) return;
        boolean podcast = "podcast".equalsIgnoreCase(getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREF_PLAYBACK_SECTION, "radio"));
        switch (action) {
            case PodcastMediaController.ACTION_WIDGET_PLAY:
                evalPodcastJavascript(podcast ? "window.viferorNativePodcastPlay&&window.viferorNativePodcastPlay();" : "window.viferorNativeRadioPlay&&window.viferorNativeRadioPlay();"); break;
            case PodcastMediaController.ACTION_WIDGET_PAUSE:
                evalPodcastJavascript(podcast ? "window.viferorNativePodcastPause&&window.viferorNativePodcastPause();" : "window.viferorNativeRadioPause&&window.viferorNativeRadioPause();"); break;
            case PodcastMediaController.ACTION_WIDGET_BACK: if (podcast) evalPodcastJavascript("window.viferorNativePodcastSeek&&window.viferorNativePodcastSeek(-15);"); break;
            case PodcastMediaController.ACTION_WIDGET_FORWARD: if (podcast) evalPodcastJavascript("window.viferorNativePodcastSeek&&window.viferorNativePodcastSeek(30);"); break;
            case PodcastMediaController.ACTION_WIDGET_PREV: if (podcast) evalPodcastJavascript("window.viferorNativePodcastPrevious&&window.viferorNativePodcastPrevious();"); break;
            case PodcastMediaController.ACTION_WIDGET_NEXT: if (podcast) evalPodcastJavascript("window.viferorNativePodcastNext&&window.viferorNativePodcastNext();"); break;
        }
    }

    private class AndroidBridge {
        @JavascriptInterface
        public void setPlaybackSection(String section) {
            if (!bridgeTrusted) return;
            String safe = "podcast".equalsIgnoreCase(section) ? "podcast" : "radio";
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString(PREF_PLAYBACK_SECTION, safe).apply();
        }

        @JavascriptInterface
        public void startRadioMedia(String station, String track, String artwork, boolean playing) {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString(PREF_PLAYBACK_SECTION, "radio").apply();
                if (podcastMediaController != null) podcastMediaController.startRadio(station, track, artwork, playing);
            });
        }

        @JavascriptInterface
        public void updateRadioMedia(String station, String track, boolean playing) {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> { if (podcastMediaController != null) podcastMediaController.updateRadio(station, track, playing); });
        }

        /** Lo que suena en la radio, por partes (APK 1.8+). */
        @JavascriptInterface
        public void updateRadioNowPlaying(String station, String artist, String title, String program, String artwork, boolean playing) {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> {
                if (podcastMediaController != null)
                    podcastMediaController.updateRadioNowPlaying(station, artist, title, program, artwork, playing);
            });
        }

        @JavascriptInterface
        public void stopRadioMedia() {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> { if (podcastMediaController != null) podcastMediaController.stopRadio(); });
        }

        @JavascriptInterface
        public void startPodcastMedia(String title, String subtitle, String artwork, double durationSec, double positionSec, boolean playing) {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
                }
                if (podcastMediaController != null) podcastMediaController.start(title, subtitle, artwork, (long)Math.max(0,durationSec*1000), (long)Math.max(0,positionSec*1000), playing);
            });
        }

        @JavascriptInterface
        public void updatePodcastMedia(double durationSec, double positionSec, boolean playing) {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> { if (podcastMediaController != null) podcastMediaController.update((long)Math.max(0,durationSec*1000), (long)Math.max(0,positionSec*1000), playing); });
        }

        @JavascriptInterface
        public void stopPodcastMedia() {
            if (!bridgeTrusted) return; runOnUiThread(() -> { if (podcastMediaController != null) podcastMediaController.stop(); }); }

        @JavascriptInterface
        public void reloadApp(String url) {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> {
                try {
                    webView.clearCache(true);
                    webView.clearHistory();
                    String target = (url == null || url.isEmpty() || !isAppUrl(url)) ? START_URL : url;
                    // Force a network reload when applying a web update; otherwise
                    // Android WebView can keep the previous index/scripts cached.
                    webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
                    webView.loadUrl(target);
                    webView.postDelayed(() -> webView.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT), 3000);
                    Toast.makeText(MainActivity.this, "Aplicación actualizada", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "No se pudo actualizar: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }

        @JavascriptInterface
        public void sharePodcast(String title, String url) {
            if (!bridgeTrusted) return;
            try {
                String safeTitle = (title == null || title.trim().isEmpty()) ? "Podcast" : title.trim();
                String safeUrl = (url == null) ? "" : url.trim();
                if (safeUrl.isEmpty()) {
                    Toast.makeText(MainActivity.this, "Este podcast no tiene un enlace para compartir", Toast.LENGTH_SHORT).show();
                    return;
                }
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_SUBJECT, safeTitle);
                send.putExtra(Intent.EXTRA_TEXT, safeTitle + " — Radios Viferor\n" + safeUrl);
                startActivity(Intent.createChooser(send, "Compartir podcast"));
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "No se pudo compartir el podcast", Toast.LENGTH_SHORT).show();
            }
        }

        @JavascriptInterface
        public void syncPodcastSubscriptions(String subscriptionsJson) {
            if (!bridgeTrusted) return;
            try {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit().putString(PREF_PODCAST_SUBS, subscriptionsJson == null ? "[]" : subscriptionsJson).apply();
                PodcastNotificationScheduler.schedule(MainActivity.this);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public boolean areNotificationsEnabled() {
            if (!bridgeTrusted) return false;
            return areNotificationsEnabledNative();
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> requestNotificationPermissionNative());
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            if (!bridgeTrusted) return;
            runOnUiThread(() -> openNotificationSettingsNative());
        }

        @JavascriptInterface
        public void saveTextFile(String filename, String content, String mimeType) {
            if (!bridgeTrusted) return;
            pendingSaveContent = content == null ? "" : content;
            pendingSaveMime = (mimeType == null || mimeType.isEmpty()) ? "application/octet-stream" : mimeType;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(pendingSaveMime);
            intent.putExtra(Intent.EXTRA_TITLE, filename == null || filename.isEmpty() ? "archivo.txt" : filename);
            try {
                startActivityForResult(intent, FILE_SAVE_REQUEST);
            } catch (Exception e) {
                Toast.makeText(MainActivity.this, "No se pudo abrir el selector de guardado", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) {
            boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED);
            notifyWebNotificationPermission(granted);
            if (granted && podcastMediaController != null) podcastMediaController.refreshNotification();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_SAVE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                    if (out == null) throw new IllegalStateException("No se pudo abrir el archivo");
                    out.write((pendingSaveContent == null ? "" : pendingSaveContent).getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    Toast.makeText(MainActivity.this, "Archivo guardado correctamente", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Error al guardar: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            }
            pendingSaveContent = null;
            pendingSaveMime = null;
            return;
        }
        if (requestCode != FILE_CHOOSER_REQUEST) return;
        if (filePathCallback == null) return;
        Uri[] results = null;
        if (resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) results = new Uri[]{uri};
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    @Override
    public void onBackPressed() {
        // La navegación la gestiona la web. En la pantalla principal la web responde
        // false y la app pasa a segundo plano (sin cerrarse: la radio sigue sonando).
        if (webView == null) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return window.handleAndroidBack ? window.handleAndroidBack() : false;}catch(e){return false;}})()",
                value -> {
                    if (!"true".equals(value)) moveTaskToBack(true);
                });
    }
}
