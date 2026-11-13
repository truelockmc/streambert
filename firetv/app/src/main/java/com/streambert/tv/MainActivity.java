package com.streambert.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.CookieManager;

public class MainActivity extends Activity {
    private static final String PLAYER_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    private WebView webView;
    private WebView playerWeb;
    private TextView status;
    private boolean showingError;
    private boolean playerVisible;
    private volatile boolean textFieldFocused;
    private boolean keyboardOpen;
    private boolean syncingKeyboard;
    private EditText keyboardField;
    private String playerHost;
    private long lastSeekAt;
    private boolean tapVidSrcOnLoad;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setGravity(Gravity.CENTER);
        status.setTextSize(22);
        status.setBackgroundColor(Color.BLACK);
        status.setPadding(80, 48, 80, 48);
        status.setVisibility(View.GONE);

        root.addView(
                webView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(
                status,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        playerWeb = new WebView(this);
        playerWeb.setBackgroundColor(Color.BLACK);
        playerWeb.setVisibility(View.GONE);
        configurePlayer(playerWeb);
        root.addView(
                playerWeb,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT));
        keyboardField = buildKeyboardField();
        FrameLayout.LayoutParams keyboardParams =
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.WRAP_CONTENT,
                        Gravity.TOP);
        root.addView(keyboardField, keyboardParams);
        setContentView(root);
        getWindow()
                .setSoftInputMode(
                        WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                                | WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN);

        WebView.setWebContentsDebuggingEnabled(true);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        String agent = settings.getUserAgentString();
        if (agent != null) settings.setUserAgentString(agent.replace(" Mobile", ""));

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
        cookies.setAcceptThirdPartyCookies(playerWeb, true);
        webView.addJavascriptInterface(new PlayerBridge(), "StreambertTv");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (!showingError) status.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(
                    WebView view, WebResourceRequest request, WebResourceError error) {
                if (request == null || !request.isForMainFrame()) return;
                showOffline();
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus();
        webView.loadUrl(getString(R.string.start_url));
    }

    private void showOffline() {
        showingError = true;
        status.setText(R.string.offline_message);
        status.setVisibility(View.VISIBLE);
    }

    private void retry() {
        showingError = false;
        status.setVisibility(View.GONE);
        webView.loadUrl(getString(R.string.start_url));
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (showingError && event.getAction() == KeyEvent.ACTION_DOWN && isSelect(code)) {
            retry();
            return true;
        }
        if (code == KeyEvent.KEYCODE_BACK) {
            if (keyboardOpen) {
                if (event.getAction() == KeyEvent.ACTION_DOWN) hideKeyboard();
                return true;
            }
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                if (playerVisible) closePlayer(true);
                else injectKey("Escape", 4);
            }
            return true;
        }
        if (keyboardOpen) {
            if (code == KeyEvent.KEYCODE_DPAD_DOWN || code == KeyEvent.KEYCODE_DPAD_UP) {
                if (event.getAction() == KeyEvent.ACTION_DOWN) {
                    hideKeyboard();
                    injectKey(
                            code == KeyEvent.KEYCODE_DPAD_DOWN ? "ArrowDown" : "ArrowUp",
                            code == KeyEvent.KEYCODE_DPAD_DOWN ? 40 : 38);
                }
                return true;
            }
            return keyboardField.dispatchKeyEvent(event);
        }
        if (playerVisible) {
            if (event.getAction() != KeyEvent.ACTION_DOWN) return true;
            if (code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_MEDIA_REWIND) {
                playerCommand("back");
                return true;
            }
            if (code == KeyEvent.KEYCODE_DPAD_RIGHT || code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) {
                playerCommand("fwd");
                return true;
            }
            if (isSelect(code)) {
                if (isVidSrc(playerHost)) tapPlayerCenter();
                else playerCommand("select");
                return true;
            }
            if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                    || code == KeyEvent.KEYCODE_MEDIA_PLAY
                    || code == KeyEvent.KEYCODE_MEDIA_PAUSE) {
                playerCommand("pause");
                return true;
            }
            // Up and down stay here so the embed cannot treat them as a seek.
            if (isDpad(code)) return true;
            return playerWeb.dispatchKeyEvent(event);
        }
        if (textFieldFocused && isFieldKey(event)) return webView.dispatchKeyEvent(event);
        String key = remoteKey(code);
        if (key != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) injectKey(key, jsKeyCode(code));
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private static boolean isFieldKey(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_DPAD_LEFT
                || code == KeyEvent.KEYCODE_DPAD_RIGHT
                || code == KeyEvent.KEYCODE_DEL
                || code == KeyEvent.KEYCODE_FORWARD_DEL
                || code == KeyEvent.KEYCODE_SPACE) {
            return true;
        }
        return event.getUnicodeChar() != 0;
    }

    private EditText buildKeyboardField() {
        EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setImeOptions(EditorInfo.IME_ACTION_DONE);
        field.setBackgroundColor(Color.parseColor("#141414"));
        field.setTextColor(Color.WHITE);
        field.setHintTextColor(Color.parseColor("#8a8a8a"));
        field.setHint("Type here");
        field.setPadding(48, 28, 48, 28);
        field.setTextSize(22);
        field.setVisibility(View.GONE);
        field.setFocusable(true);
        field.setFocusableInTouchMode(true);
        field.setOnEditorActionListener(
                (view, actionId, event) -> {
                    if (actionId == EditorInfo.IME_ACTION_DONE) {
                        hideKeyboard();
                        return true;
                    }
                    return false;
                });
        field.addTextChangedListener(
                new TextWatcher() {
                    @Override
                    public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

                    @Override
                    public void onTextChanged(CharSequence s, int start, int before, int count) {}

                    @Override
                    public void afterTextChanged(Editable s) {
                        if (!syncingKeyboard) pushKeyboardText(s.toString());
                    }
                });
        return field;
    }

    private void showKeyboard(String value) {
        keyboardOpen = true;
        textFieldFocused = true;
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow()
                .setSoftInputMode(
                        WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                                | WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        if (!keyboardField.isShown()) {
            syncingKeyboard = true;
            keyboardField.setText(value == null ? "" : value);
            keyboardField.setSelection(keyboardField.getText().length());
            syncingKeyboard = false;
            keyboardField.setVisibility(View.VISIBLE);
        }
        keyboardField.requestFocus();
        keyboardField.post(
                () -> {
                    InputMethodManager imm =
                            (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
                    if (imm != null) {
                        imm.showSoftInput(keyboardField, InputMethodManager.SHOW_FORCED);
                    }
                });
    }

    private void hideKeyboard() {
        if (!keyboardOpen && keyboardField.getVisibility() != View.VISIBLE) return;
        keyboardOpen = false;
        textFieldFocused = false;
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(keyboardField.getWindowToken(), 0);
        keyboardField.setVisibility(View.GONE);
        webView.requestFocus();
    }

    private void pushKeyboardText(String value) {
        String quoted;
        try {
            quoted = JSONObject.quote(value);
        } catch (Exception error) {
            quoted = "\"\"";
        }
        webView.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('streambert:keyboard-text',{detail:"
                        + quoted
                        + "}))",
                null);
    }

    private void showKeyboard() {
        showKeyboard("");
    }

    private static boolean isSelect(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER
                || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_BUTTON_A;
    }

    private static String remoteKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP:
                return "ArrowUp";
            case KeyEvent.KEYCODE_DPAD_DOWN:
                return "ArrowDown";
            case KeyEvent.KEYCODE_DPAD_LEFT:
                return "ArrowLeft";
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return "ArrowRight";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
                return "Enter";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                return "MediaPlayPause";
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                return "MediaRewind";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                return "MediaFastForward";
            case KeyEvent.KEYCODE_MENU:
                return "ContextMenu";
            default:
                return null;
        }
    }

    private static int jsKeyCode(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP:
                return 38;
            case KeyEvent.KEYCODE_DPAD_DOWN:
                return 40;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                return 37;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return 39;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                return 179;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                return 227;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                return 228;
            case KeyEvent.KEYCODE_MENU:
                return 93;
            default:
                return 13;
        }
    }

    private void injectPlayerNav(String key) {
        if (key == null) return;
        String dir =
                "ArrowUp".equals(key) ? "up"
                        : "ArrowDown".equals(key) ? "down"
                        : "ArrowLeft".equals(key) ? "left"
                        : "ArrowRight".equals(key) ? "right"
                        : "Enter".equals(key) ? "enter" : "";
        if (dir.isEmpty()) return;
        playerWeb.evaluateJavascript(
                "(function(dir){"
                        + "var prev=window.__sbEl;"
                        + "if(prev&&prev.style)prev.style.outline='';"
                        + "if(dir==='enter'){if(prev&&document.contains(prev))prev.click();return;}"
                        + "var nodes=[].slice.call(document.querySelectorAll('button,a,input,select,textarea,label,[role=\"button\"],[role=\"radio\"],[role=\"option\"],[role=\"menuitem\"],[role=\"tab\"],li'));"
                        + "var vw=window.innerWidth,vh=window.innerHeight;"
                        + "var items=nodes.filter(function(el){"
                        + "var s=getComputedStyle(el);if(s.display==='none'||s.visibility==='hidden')return false;"
                        + "var r=el.getBoundingClientRect();"
                        + "if(r.width<16||r.height<16)return false;"
                        + "if(r.width>vw*0.92&&r.height>vh*0.45)return false;"
                        + "return r.bottom> -40&&r.top<vh+40;});"
                        + "items=items.filter(function(el){return !items.some(function(o){return o!==el&&el.contains(o);});});"
                        + "if(!items.length)return;"
                        + "var from=(prev&&document.contains(prev))?prev:null;"
                        + "var fr=from?from.getBoundingClientRect():{left:vw/2,right:vw/2,top:vh/2,bottom:vh/2,width:0,height:0};"
                        + "var best=null,score=1e15;"
                        + "items.forEach(function(el){if(el===from)return;var r=el.getBoundingClientRect();"
                        + "var dx=(r.left+r.width/2)-(fr.left+fr.width/2);var dy=(r.top+r.height/2)-(fr.top+fr.height/2);"
                        + "var ok=dir==='down'?r.top>=fr.bottom-12:dir==='up'?r.bottom<=fr.top+12:dir==='right'?r.left>=fr.right-12:r.right<=fr.left+12;"
                        + "if(!ok)return;var primary=dir==='down'?dy:dir==='up'?-dy:dir==='right'?dx:-dx;if(primary<=0)return;"
                        + "var perp=dir==='down'||dir==='up'?Math.abs(dx):Math.abs(dy);var s2=primary+perp*2.2;if(s2<score){score=s2;best=el;}});"
                        + "if(!best)return;window.__sbEl=best;best.style.outline='3px solid #fff';best.style.outlineOffset='3px';"
                        + "best.scrollIntoView({block:'nearest',inline:'nearest'});"
                        + "})('"
                        + dir
                        + "')",
                null);
    }

    private void injectKey(String key, int keyCode) {
        webView.evaluateJavascript(
                "(function(){window.dispatchEvent(new KeyboardEvent('keydown',{key:'"
                        + key
                        + "',code:'"
                        + key
                        + "',keyCode:"
                        + keyCode
                        + ",which:"
                        + keyCode
                        + ",bubbles:true,cancelable:true}));})();",
                null);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configurePlayer(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUserAgentString(PLAYER_UA);
        view.addJavascriptInterface(new MatchBridge(), "StreambertMatch");
        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(
                    WebView opener, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // Vidrift calls window.open() on the first click. A null result
                // replaces the movie with "Remove sandboxing to enable playback."
                WebView popup = new WebView(opener.getContext());
                popup.getSettings().setJavaScriptEnabled(true);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                opener.postDelayed(() -> {
                    popup.stopLoading();
                    popup.destroy();
                }, 5000);
                return true;
            }
        });
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request == null || !request.isForMainFrame()) return false;
                String host = request.getUrl().getHost();
                if (host == null || playerHost == null) return false;
                if (host.equals(playerHost) || host.endsWith("." + playerHost)) return false;
                // Embed pages open ad tabs with window.location. Keep the movie on screen.
                Log.i("Streambert", "blocked player redirect " + host);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (tapVidSrcOnLoad && url != null && url.contains("vsembed.su")) {
                    tapVidSrcOnLoad = false;
                    // VidSrc waits on a play button inside a nested frame.
                    view.postDelayed(() -> tapPlayerCenter(), 1200);
                }
                injectPlayerChrome(view, url);
                injectEpisodeMatch(view, url);
                view.postDelayed(() -> injectPlayerChrome(view, url), 700);
                view.postDelayed(() -> injectEpisodeMatch(view, url), 700);
                view.postDelayed(() -> injectPlayerChrome(view, url), 2000);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
    }

    private static boolean isDpad(int code) {
        return code == KeyEvent.KEYCODE_DPAD_UP
                || code == KeyEvent.KEYCODE_DPAD_DOWN
                || code == KeyEvent.KEYCODE_DPAD_LEFT
                || code == KeyEvent.KEYCODE_DPAD_RIGHT;
    }

    private void openPlayer(String url) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
        if (keyboardOpen) hideKeyboard();
        playerHost = Uri.parse(url).getHost();
        tapVidSrcOnLoad = isVidSrc(playerHost);
        playerVisible = true;
        // Keep the show page hidden so its surface cannot cover the video,
        // but leave JavaScript running so a source change can reload this player.
        webView.setVisibility(View.GONE);
        webView.onResume();
        playerWeb.setVisibility(View.VISIBLE);
        playerWeb.bringToFront();
        keyboardField.bringToFront();
        playerWeb.onResume();
        playerWeb.loadUrl(url);
        playerWeb.requestFocus();
    }

    private static boolean isVidSrc(String host) {
        return host != null && (host.equals("vsembed.su") || host.endsWith(".vsembed.su"));
    }

    /** Hits the play button VidSrc puts in the middle of a nested frame. */
    private void tapPlayerCenter() {
        if (playerWeb == null) return;
        int x = playerWeb.getWidth() / 2;
        int y = playerWeb.getHeight() / 2;
        if (x <= 0 || y <= 0) return;
        long now = android.os.SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0);
        MotionEvent up = MotionEvent.obtain(now, now + 40, MotionEvent.ACTION_UP, x, y, 0);
        playerWeb.dispatchTouchEvent(down);
        playerWeb.dispatchTouchEvent(up);
        down.recycle();
        up.recycle();
    }

    /** Remote controls for the embed. The page's own D-pad handling seeks too far. */
    private void playerCommand(String action) {
        if ("back".equals(action) || "fwd".equals(action)) {
            long now = android.os.SystemClock.uptimeMillis();
            // One press of the D-pad arrives as a short burst of key events.
            if (now - lastSeekAt < 350) return;
            lastSeekAt = now;
        }
        String script =
                "(function(action){"
                        + "function shown(el){"
                        + "if(!el||!el.getClientRects().length)return false;"
                        + "var s=getComputedStyle(el);"
                        + "return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';"
                        + "}"
                        + "function skip(){"
                        + "var nodes=document.querySelectorAll('button');"
                        + "for(var i=0;i<nodes.length;i++){"
                        + "var label=(nodes[i].textContent||'').replace(/\\s+/g,' ').trim();"
                        + "if(/^skip intro$/i.test(label)&&shown(nodes[i]))return nodes[i];"
                        + "}"
                        + "return null;"
                        + "}"
                        + "function seek(delta){"
                        + "var video=document.querySelector('video');"
                        + "if(!video)return;"
                        + "var next=video.currentTime+delta;"
                        + "if(next<0)next=0;"
                        + "if(video.duration&&next>video.duration)next=Math.max(0,video.duration-0.5);"
                        + "video.currentTime=next;"
                        + "}"
                        + "function toggle(){"
                        + "var video=document.querySelector('video');"
                        + "if(!video)return;"
                        + "if(video.paused)video.play();else video.pause();"
                        + "}"
                        + "if(action==='back')seek(-10);"
                        + "else if(action==='fwd')seek(10);"
                        + "else if(action==='pause')toggle();"
                        + "else if(action==='select'){var button=skip();if(button)button.click();else toggle();}"
                        + "})("
                        + JSONObject.quote(action)
                        + ");";
        playerWeb.evaluateJavascript(script, null);
    }

    private void closePlayer(boolean notifyPage) {
        if (!playerVisible && playerWeb.getVisibility() != View.VISIBLE) return;
        playerVisible = false;
        playerHost = null;
        playerWeb.stopLoading();
        playerWeb.loadUrl("about:blank");
        playerWeb.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.onResume();
        webView.requestFocus();
        if (notifyPage) {
            webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('streambert:tv-back',{cancelable:true}))",
                    null);
        }
    }

    /** The player page asks for another source when its files are the wrong episode. */
    public class MatchBridge {
        @android.webkit.JavascriptInterface
        public void failover() {
            runOnUiThread(() -> webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('streambert:source-mismatch'))",
                    null));
        }
    }

    /** Ask the app page for the episode check and run it in the player page. */
    private void injectEpisodeMatch(WebView view, String url) {
        if (view == null || url == null || !url.contains("vidrift")) return;
        webView.evaluateJavascript(
                "(function(){return window.__sbEpisodeMatchSource||''})()",
                value -> {
                    if (value == null || value.length() < 2 || "null".equals(value)) return;
                    String src;
                    try {
                        src = new JSONArray("[" + value + "]").getString(0);
                    } catch (Exception error) {
                        return;
                    }
                    if (src.isEmpty()) return;
                    view.evaluateJavascript(src, null);
                });
    }

    /** Same chrome removal the desktop player applies in siteTweaks.js. */
    private void injectPlayerChrome(WebView view, String url) {
        String css = playerChromeCss(url);
        if (css == null || view == null) return;
        String quoted = JSONObject.quote(css);
        view.evaluateJavascript(
                "(function(){var id='streambert-player-chrome';"
                        + "function apply(){if(document.getElementById(id))return;"
                        + "var s=document.createElement('style');s.id=id;"
                        + "(document.head||document.documentElement).appendChild(s);"
                        + "s.textContent="
                        + quoted
                        + ";}"
                        + "apply();"
                        + "if(!window.__sbChromeObs&&document.documentElement){"
                        + "window.__sbChromeObs=new MutationObserver(apply);"
                        + "window.__sbChromeObs.observe(document.documentElement,{childList:true,subtree:true});"
                        + "}"
                        + "})();",
                null);
    }

    private static String playerChromeCss(String url) {
        if (url == null) return null;
        String host = Uri.parse(url).getHost();
        if (host == null) return null;
        if ("aether.ist".equals(host) || host.endsWith(".aether.ist")) {
            return "div:has(> .top-content),"
                    + ".top-content,"
                    + "[id=\"__overlayRouter::episodes\"],"
                    + "[id=\"__overlayRouter::episodes\"] + button,"
                    + "a.tabbable[class*=\"cancelHover\"],"
                    + "button.tabbable.p-2.rounded-full:has(> span.text-xl > svg[width=\"18\"][height=\"18\"])"
                    + "{display:none !important;}";
        }
        if ("vidnest.fun".equals(host) || host.endsWith(".vidnest.fun")) {
            return ".popup-selector,#overlay-id{display:none !important;}";
        }
        if ("frembed.uno".equals(host) || host.endsWith(".frembed.uno")) {
            return ".popup-selector{display:none !important;}";
        }
        return null;
    }

    public class PlayerBridge {
        @android.webkit.JavascriptInterface
        public void openPlayer(String url) {
            runOnUiThread(() -> MainActivity.this.openPlayer(url));
        }

        @android.webkit.JavascriptInterface
        public void closePlayer() {
            runOnUiThread(() -> MainActivity.this.closePlayer(false));
        }

        @android.webkit.JavascriptInterface
        public void setTextFieldFocused(boolean focused) {
            textFieldFocused = focused;
        }

        @android.webkit.JavascriptInterface
        public void showKeyboard() {
            runOnUiThread(() -> MainActivity.this.showKeyboard(""));
        }

        @android.webkit.JavascriptInterface
        public void openKeyboard(String value) {
            runOnUiThread(() -> MainActivity.this.showKeyboard(value));
        }

        @android.webkit.JavascriptInterface
        public void hideKeyboard() {
            runOnUiThread(MainActivity.this::hideKeyboard);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (playerVisible) {
            webView.setVisibility(View.GONE);
            webView.onResume();
            playerWeb.setVisibility(View.VISIBLE);
            playerWeb.bringToFront();
            keyboardField.bringToFront();
            playerWeb.onResume();
            playerWeb.requestFocus();
            return;
        }
        webView.setVisibility(View.VISIBLE);
        webView.onResume();
        webView.requestFocus();
    }

    @Override
    protected void onPause() {
        if (playerWeb != null) playerWeb.onPause();
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (playerWeb != null) playerWeb.destroy();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
