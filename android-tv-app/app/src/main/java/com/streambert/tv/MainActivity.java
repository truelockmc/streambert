package com.streambert.tv;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

/**
 * Hosts Streambert's React UI (built into assets/www by web/) in a WebView and
 * stands in for Electron's main process: window.electron (web/public/tv-shim.js)
 * calls the {@link Bridge} below, and embedded players run in the fullscreen
 * {@link PlayerController} overlay.
 */
public class MainActivity extends Activity implements PlayerController.Listener {
    static final String TAG = "StreambertTV";
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ASSET_HOST + "/assets/www/index.html";
    private static final long EXIT_WINDOW_MS = 2500;

    private WebView ui;
    private PlayerController player;
    private SharedPreferences secrets;
    private long exitArmedUntil;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        secrets = getSharedPreferences("secure", Context.MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        ui = new WebView(this);
        root.addView(ui, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        player = new PlayerController(this, root, this);
        setContentView(root);

        setUpUi();
        ui.loadUrl(START_URL);
        ui.requestFocus();
    }

    private void setUpUi() {
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        WebSettings s = ui.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        ui.setBackgroundColor(Color.BLACK);
        // Only our own bundle is ever loaded here (see shouldOverrideUrlLoading)
        // and the UI has no iframes, so the bridge isn't exposed to web content.
        ui.addJavascriptInterface(new Bridge(), "AndroidTV");

        ui.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (ASSET_HOST.equals(url.getHost())) return false;
                // Links out of the app (TMDB sign-up etc.) open in the player
                // overlay, which has a pointer mode for ordinary web pages.
                player.openBrowser(url.toString());
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(TAG, "UI renderer gone, restarting");
                recreate();
                return true;
            }
        });

        ui.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "ui: " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
    }

    private void js(String code) {
        ui.evaluateJavascript(code, null);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (player.isShowing()) {
            return player.onKey(e) || super.dispatchKeyEvent(e);
        }
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        switch (e.getKeyCode()) {
            case KeyEvent.KEYCODE_BACK:
                if (!down && !e.isCanceled()) js("window.__tvBack && window.__tvBack()");
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
                // Handled in JS so OK can open the keyboard on text fields
                // instead of submitting them as Enter.
                if (down && e.getRepeatCount() == 0) js("window.__tvOk && window.__tvOk()");
                return true;
            default:
                return super.dispatchKeyEvent(e);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        player.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        player.onResume();
    }

    @Override
    protected void onDestroy() {
        player.destroy();
        ui.destroy();
        super.onDestroy();
    }

    // ── PlayerController.Listener ──────────────────────────────────────────

    @Override
    public void onPlayerEvent(int id, String type, JSONObject detail) {
        js("window.__tvPlayer && __tvPlayer.event(" + id + "," + JSONObject.quote(type) + "," + detail + ")");
    }

    @Override
    public void onPlayerClosedByUser(int id) {
        ui.requestFocus();
        js("window.__tvPlayer && __tvPlayer.closed(" + id + ")");
    }

    @Override
    public void onPlayerHidden() {
        ui.requestFocus();
    }

    @Override
    public void onExecResult(int callId, String json) {
        js("window.__tvPlayer && __tvPlayer.result(" + callId + "," + (json == null ? "null" : json) + ")");
    }

    /** window.AndroidTV, called by web/public/tv-shim.js and web/*.js. */
    final class Bridge {
        @JavascriptInterface
        public String secureGet(String key) {
            String value = secrets.getString(key, null);
            // "apikey" is the TMDB token (src/utils/storage.js)
            if (value == null && "apikey".equals(key) && !BuildConfig.TMDB_TOKEN.isEmpty()) {
                return BuildConfig.TMDB_TOKEN;
            }
            return value;
        }

        @JavascriptInterface
        public void secureSet(String key, String value) {
            SharedPreferences.Editor ed = secrets.edit();
            if (value == null || value.isEmpty()) ed.remove(key);
            else ed.putString(key, value);
            ed.apply();
        }

        @JavascriptInterface
        public String appVersion() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public String desktopUserAgent() {
            return PlayerController.DESKTOP_UA;
        }

        @JavascriptInterface
        public void openPlayer(int id, String url, String userAgent) {
            runOnUiThread(() -> player.open(id, url, userAgent));
        }

        @JavascriptInterface
        public void closePlayer(int id) {
            runOnUiThread(() -> player.close(id));
        }

        @JavascriptInterface
        public void exec(int id, int callId, String code) {
            runOnUiThread(() -> player.exec(id, callId, code));
        }

        @JavascriptInterface
        public String progress() {
            return player.progressJson();
        }

        @JavascriptInterface
        public void openExternal(String url) {
            runOnUiThread(() -> player.openBrowser(url));
        }

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
        }

        @JavascriptInterface
        public void quit() {
            runOnUiThread(MainActivity.this::finish);
        }

        @JavascriptInterface
        public void showKeyboard() {
            runOnUiThread(() -> {
                ui.requestFocus();
                InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                if (imm != null) imm.showSoftInput(ui, InputMethodManager.SHOW_IMPLICIT);
            });
        }

        /** BACK found nothing to close or go back to: second press exits. */
        @JavascriptInterface
        public void backUnhandled() {
            runOnUiThread(() -> {
                long now = SystemClock.uptimeMillis();
                if (now < exitArmedUntil) {
                    finish();
                } else {
                    exitArmedUntil = now + EXIT_WINDOW_MS;
                    Toast.makeText(MainActivity.this, "Press BACK again to exit", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
