package com.streambert.tv;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Message;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Fullscreen WebView that plays the embed URLs the UI's &lt;tv-webview&gt;
 * elements ask for (the desktop app shows them in an Electron &lt;webview&gt;).
 *
 * <p>Blocks the desktop app's ad/tracker hosts and all popups, injects
 * assets/player-inject.js into every frame to track and control the video, and
 * maps the remote: OK play/pause, Left/Right seek, Up/Down pointer mode (a
 * virtual cursor that taps the page, for source menus and play overlays).
 */
final class PlayerController {
    interface Listener {
        void onPlayerEvent(int id, String type, JSONObject detail);

        void onPlayerClosedByUser(int id);

        void onPlayerHidden();

        void onExecResult(int callId, String json);
    }

    static final String DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
    /** Plain web page opened via openExternal / a link: no element to report to. */
    private static final int BROWSER_ID = -1;
    private static final int SEEK_SECONDS = 10;
    private static final long SEEK_REPEAT_MS = 220;
    private static final long PROGRESS_STALE_MS = 4000;

    private final Activity activity;
    private final Listener listener;
    private final FrameLayout container;
    private final CursorView cursor;
    private final TextView hint;
    private final Set<String> blockedHosts;
    private final String injectScript;
    private WebView web;
    private String defaultUa;

    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    private int currentId;
    private boolean showing;
    private boolean cursorMode;
    private long lastSeekAt;

    private volatile JSONObject progress;
    private volatile long progressAt;

    PlayerController(Activity activity, FrameLayout root, Listener listener) {
        this.activity = activity;
        this.listener = listener;
        blockedHosts = readHostList("blocklist.txt");
        injectScript = readAsset("player-inject.js");

        container = new FrameLayout(activity);
        container.setBackgroundColor(Color.BLACK);
        container.setVisibility(View.GONE);
        root.addView(container, matchParent());

        cursor = new CursorView(activity);
        cursor.setVisibility(View.GONE);
        container.addView(cursor, matchParent());

        hint = new TextView(activity);
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        hint.setBackgroundColor(0xCC000000);
        int pad = dp(10);
        hint.setPadding(pad * 2, pad, pad * 2, pad);
        hint.setAlpha(0f);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = dp(28);
        container.addView(hint, lp);
    }

    boolean isShowing() {
        return showing;
    }

    // ── Called from the UI (MainActivity.Bridge) ───────────────────────────

    void open(int id, String url, String userAgent) {
        if (web == null) createWebView();
        currentId = id;
        progress = null;
        web.getSettings().setUserAgentString(
                userAgent != null && !userAgent.isEmpty() ? userAgent : defaultUa);
        web.loadUrl(url);
        show();
        boolean browser = id == BROWSER_ID;
        setCursorMode(browser);
        showHint(browser
                ? "Arrows move the pointer  ·  OK clicks  ·  BACK closes"
                : "OK play/pause  ·  ◀ ▶ seek 10s  ·  ▲ ▼ pointer  ·  BACK close");
    }

    void openBrowser(String url) {
        open(BROWSER_ID, url, DESKTOP_UA);
    }

    void close(int id) {
        if (showing && id == currentId) hide(false);
    }

    void exec(int id, int callId, String code) {
        if (!showing || id != currentId || web == null) {
            listener.onExecResult(callId, null);
            return;
        }
        web.evaluateJavascript(code, result -> listener.onExecResult(callId, result));
    }

    /** Latest playing video across all frames, in queryVideoProgress's shape. */
    String progressJson() {
        JSONObject p = progress;
        if (p == null || SystemClock.uptimeMillis() - progressAt > PROGRESS_STALE_MS) return "null";
        if (p.optBoolean("paused")) return "null";
        return p.toString();
    }

    void onPause() {
        if (web == null) return;
        if (showing) command("pause", 0);
        web.onPause();
    }

    void onResume() {
        if (web != null) web.onResume();
    }

    void destroy() {
        if (web != null) web.destroy();
        web = null;
    }

    // ── Remote control ─────────────────────────────────────────────────────

    boolean onKey(KeyEvent e) {
        int code = e.getKeyCode();
        boolean down = e.getAction() == KeyEvent.ACTION_DOWN;
        boolean first = down && e.getRepeatCount() == 0;

        if (code == KeyEvent.KEYCODE_BACK) {
            if (!down && !e.isCanceled()) {
                if (customView != null) exitFullscreen();
                else if (cursorMode && currentId != BROWSER_ID) setCursorMode(false);
                else hide(true);
            }
            return true;
        }
        switch (code) {
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                if (first) command("play", 0);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                if (first) command("pause", 0);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                if (first) playPause();
                return true;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                if (down) seek(-SEEK_SECONDS);
                return true;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                if (down) seek(SEEK_SECONDS);
                return true;
            default:
                break;
        }

        if (cursorMode) {
            int step = dp(10) + Math.min(e.getRepeatCount(), 15) * dp(3);
            switch (code) {
                case KeyEvent.KEYCODE_DPAD_UP:
                    if (down) moveCursor(0, -step);
                    return true;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    if (down) moveCursor(0, step);
                    return true;
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    if (down) moveCursor(-step, 0);
                    return true;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    if (down) moveCursor(step, 0);
                    return true;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    if (first) tap(cursor.getCursorX(), cursor.getCursorY());
                    return true;
                default:
                    return false;
            }
        }

        switch (code) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                if (first) playPause();
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (down) seek(-SEEK_SECONDS);
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                if (down) seek(SEEK_SECONDS);
                return true;
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_MENU:
                if (first) {
                    setCursorMode(true);
                    showHint("Pointer: arrows move  ·  OK clicks  ·  BACK returns to playback");
                }
                return true;
            default:
                return false;
        }
    }

    private boolean hasVideo() {
        return progress != null && SystemClock.uptimeMillis() - progressAt < PROGRESS_STALE_MS;
    }

    private void playPause() {
        // Before playback starts there's no <video> yet, just the embed's own
        // play overlay: tap the middle of the screen instead.
        if (hasVideo()) command("toggle", 0);
        else tap(container.getWidth() / 2f, container.getHeight() / 2f);
    }

    private void seek(int seconds) {
        long now = SystemClock.uptimeMillis();
        if (now - lastSeekAt < SEEK_REPEAT_MS) return;
        lastSeekAt = now;
        command("seek", seconds);
    }

    private void command(String cmd, int arg) {
        if (web == null) return;
        web.evaluateJavascript("window.__stbtvCommand && window.__stbtvCommand("
                + JSONObject.quote(cmd) + "," + arg + ")", null);
    }

    private void moveCursor(int dx, int dy) {
        cursor.moveBy(dx, dy, container.getWidth(), container.getHeight());
        // At the top/bottom edge, scroll the page instead
        if (web != null && customView == null) {
            if (dy < 0 && cursor.getCursorY() <= 0) web.scrollBy(0, dy);
            if (dy > 0 && cursor.getCursorY() >= container.getHeight() - 1) web.scrollBy(0, dy);
        }
    }

    private void tap(float x, float y) {
        View target = customView != null ? customView : web;
        if (target == null) return;
        // Chromium ignores pointers without a tool type, so describe a finger
        MotionEvent.PointerProperties[] props = {new MotionEvent.PointerProperties()};
        props[0].id = 0;
        props[0].toolType = MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords[] coords = {new MotionEvent.PointerCoords()};
        coords[0].x = x;
        coords[0].y = y;
        coords[0].pressure = 1f;
        coords[0].size = 1f;
        long t = SystemClock.uptimeMillis();
        MotionEvent downEv = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, 1, props, coords,
                0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        MotionEvent upEv = MotionEvent.obtain(t, t + 60, MotionEvent.ACTION_UP, 1, props, coords,
                0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
        target.dispatchTouchEvent(downEv);
        target.dispatchTouchEvent(upEv);
        downEv.recycle();
        upEv.recycle();
    }

    private void setCursorMode(boolean on) {
        cursorMode = on;
        if (on && cursor.getVisibility() != View.VISIBLE) {
            cursor.center(container.getWidth(), container.getHeight());
        }
        cursor.setVisibility(on ? View.VISIBLE : View.GONE);
        cursor.bringToFront();
        hint.bringToFront();
    }

    private void showHint(String text) {
        hint.setText(text);
        hint.animate().cancel();
        hint.setAlpha(1f);
        hint.animate().alpha(0f).setStartDelay(4500).setDuration(600).start();
    }

    // ── Visibility ─────────────────────────────────────────────────────────

    private void show() {
        showing = true;
        container.setVisibility(View.VISIBLE);
        container.bringToFront();
        web.requestFocus();
        activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void hide(boolean byUser) {
        int id = currentId;
        exitFullscreen();
        showing = false;
        currentId = 0;
        progress = null;
        setCursorMode(false);
        // about:blank stops playback and frees the page
        if (web != null) web.loadUrl("about:blank");
        container.setVisibility(View.GONE);
        activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (byUser && id > 0) listener.onPlayerClosedByUser(id);
        else listener.onPlayerHidden();
    }

    private void exitFullscreen() {
        if (customView == null) return;
        container.removeView(customView);
        customView = null;
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    private void emit(String type, JSONObject detail) {
        if (showing && currentId > 0) listener.onPlayerEvent(currentId, type, detail);
    }

    // ── WebView setup ──────────────────────────────────────────────────────

    private void createWebView() {
        web = new WebView(activity);
        web.setBackgroundColor(Color.BLACK);
        container.addView(web, 0, matchParent());

        WebSettings s = web.getSettings();
        defaultUa = WebSettings.getDefaultUserAgent(activity).replace("; wv", "");
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // Popups are created as windows and refused in onCreateWindow
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        Set<String> allFrames = Collections.singleton("*");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "StreambertTV", allFrames,
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> onFrameMessage(message.getData()));
        }
        boolean docStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (docStart) WebViewCompat.addDocumentStartJavaScript(web, injectScript, allFrames);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isBlocked(request.getUrl())) return null;
                if (BuildConfig.DEBUG) Log.d(MainActivity.TAG, "blocked " + request.getUrl().getHost());
                return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                // intent://, market:// etc. would leave the app
                if (!"http".equals(scheme) && !"https".equals(scheme)) return true;
                if (isBlocked(url)) return true;
                if (request.isForMainFrame()) emit("will-navigate", detail("url", url.toString()));
                return false;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                if (!"about:blank".equals(url)) emit("did-start-loading", detail("url", url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if ("about:blank".equals(url)) return;
                if (!docStart) view.evaluateJavascript(injectScript, null);
                emit("dom-ready", detail("url", url));
                emit("did-finish-load", detail("url", url));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                JSONObject d = detail("validatedURL", request.getUrl().toString());
                try {
                    d.put("errorCode", error.getErrorCode());
                    d.put("errorDescription", String.valueOf(error.getDescription()));
                    d.put("isMainFrame", true);
                } catch (JSONException ignored) {
                }
                emit("did-fail-load", d);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w(MainActivity.TAG, "player renderer gone");
                container.removeView(web);
                web.destroy();
                web = null;
                if (showing) hide(true);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                return false; // ad popups
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                exitFullscreen();
                customView = view;
                customViewCallback = callback;
                container.addView(view, 1, matchParent());
                cursor.bringToFront();
                hint.bringToFront();
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }

            @Override
            public Bitmap getDefaultVideoPoster() {
                // Otherwise WebView draws a grey placeholder before playback
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
        });
    }

    private void onFrameMessage(String data) {
        if (data == null) return;
        try {
            JSONObject msg = new JSONObject(data);
            if (!"progress".equals(msg.optString("t"))) return;
            msg.remove("t");
            // Several frames can report (ads, previews): keep the longest video
            // unless the current one went quiet.
            long now = SystemClock.uptimeMillis();
            JSONObject cur = progress;
            if (cur == null || now - progressAt > PROGRESS_STALE_MS
                    || msg.optDouble("duration") >= cur.optDouble("duration") * 0.9) {
                progress = msg;
                progressAt = now;
            }
        } catch (JSONException ignored) {
        }
    }

    /** blocklist.txt: "ads.com" matches that host only, "*.ads.com" its subdomains. */
    private boolean isBlocked(Uri url) {
        String host = url.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        if (blockedHosts.contains(host)) return true;
        for (int dot = host.indexOf('.'); dot >= 0; dot = host.indexOf('.', dot + 1)) {
            if (blockedHosts.contains("*" + host.substring(dot))) return true;
        }
        return false;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private static JSONObject detail(String key, String value) {
        JSONObject o = new JSONObject();
        try {
            o.put(key, value);
        } catch (JSONException ignored) {
        }
        return o;
    }

    private static FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private Set<String> readHostList(String name) {
        Set<String> hosts = new HashSet<>();
        for (String line : readAsset(name).split("\n")) {
            String h = line.trim();
            if (!h.isEmpty()) hosts.add(h);
        }
        return hosts;
    }

    private String readAsset(String name) {
        StringBuilder sb = new StringBuilder();
        try (InputStream in = activity.getAssets().open(name);
             BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) sb.append(line).append('\n');
        } catch (IOException e) {
            Log.e(MainActivity.TAG, "missing asset " + name, e);
        }
        return sb.toString();
    }
}
