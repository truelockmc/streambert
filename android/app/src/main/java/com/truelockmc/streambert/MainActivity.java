package com.truelockmc.streambert;

import android.annotation.SuppressLint;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewParent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends BridgeActivity {

    private static final Set<String> BLOCKED_HOSTS = new HashSet<>();

    static {
        String[] hosts = {
            "www.google-analytics.com",
            "analytics.google.com",
            "googletagmanager.com",
            "www.googletagmanager.com",
            "googletagservices.com",
            "doubleclick.net",
            "adservice.google.com",
            "adservice.google.de",
            "pagead2.googlesyndication.com",
            "stats.g.doubleclick.net",
            "yt3.ggpht.com",
            "fonts.googleapis.com",
            "fonts.gstatic.com",
            "googleapis.com",
            "gstatic.com",
            "cdn.adx1.com",
            "intelligenceadx.com",
            "adsco.re",
            "mc.yandex.com",
            "mc.yandex.ru",
            "bvtpk.com",
            "my.rtmark.net",
            "b7510.com",
            "gt.unbrownunflat.com",
            "im.malocacomals.com",
            "users.videasy.net",
            "nf.sixmossin.com",
            "realizationnewestfangs.com",
            "acscdn.com",
            "lt.taloseempest.com",
            "pl26708123.profitableratecpm.com",
            "preferencenail.com",
            "protrafficinspector.com",
            "s10.histats.com",
            "weirdopt.com",
            "static.cloudflareinsights.com",
            "kettledroopingcontinuation.com",
            "wayfarerorthodox.com",
            "woxaglasuy.net",
            "adeptspiritual.com",
            "www.calculating-laugh.com",
            "amavhxdlofklxjg.xyz",
            "7jtjubf8p5kq7x3z2.u3qleufcm6vure326ktfpbj.cfd",
            "5mq.get64t9vqg8pnbex1y463o.rest",
            "usrpubtrk.com",
            "adexchangeclear.com",
            "rzjzjnavztycv.online",
            "tmstr4.cloudnestra.com",
            "tmstr4.neonhorizonworkshops.com",
        };

        for (String host : hosts) {
            BLOCKED_HOSTS.add(host);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        installPrivateWebViewControls();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void installPrivateWebViewControls() {
        Bridge activeBridge = getBridge();
        if (activeBridge == null || activeBridge.getWebView() == null) return;

        WebView webView = activeBridge.getWebView();
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        activeBridge.setWebViewClient(new StreambertWebViewClient(activeBridge));
        webView.setWebChromeClient(new StreambertWebChromeClient(activeBridge));
    }

    private static boolean isBlockedHost(Uri uri) {
        String host = normalizedHost(uri);
        if (host == null) return false;
        for (String blocked : BLOCKED_HOSTS) {
            if (host.equals(blocked) || host.endsWith("." + blocked)) return true;
        }
        return false;
    }

    private static boolean isAppUrl(Uri uri) {
        if (uri == null) return false;

        String scheme = lower(uri.getScheme());
        String host = normalizedHost(uri);

        if ("file".equals(scheme) || "capacitor".equals(scheme)) return true;
        if (!"http".equals(scheme) && !"https".equals(scheme)) return false;

        return "localhost".equals(host) ||
            "127.0.0.1".equals(host) ||
            "10.0.2.2".equals(host);
    }

    private static String normalizedHost(Uri uri) {
        return lower(uri != null ? uri.getHost() : null);
    }

    private static String lower(String value) {
        return value == null ? null : value.toLowerCase(Locale.US);
    }

    private static WebResourceResponse emptyResponse() {
        return new WebResourceResponse(
            "text/plain",
            "utf-8",
            new ByteArrayInputStream(new byte[0])
        );
    }

    private static class StreambertWebViewClient extends BridgeWebViewClient {
        StreambertWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (isBlockedHost(url)) return emptyResponse();
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();

            if (isBlockedHost(url)) return true;
            if (request.isForMainFrame() && !isAppUrl(url)) return true;

            return super.shouldOverrideUrlLoading(view, request);
        }
    }

    private static class StreambertWebChromeClient extends BridgeWebChromeClient {
        StreambertWebChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean onCreateWindow(
            WebView view,
            boolean isDialog,
            boolean isUserGesture,
            android.os.Message resultMsg
        ) {
            return false;
        }

        @Override
        public void onCloseWindow(WebView window) {
            if (window == null) return;

            ViewParent parent = window.getParent();
            if (parent instanceof ViewGroup) {
                ((ViewGroup) parent).removeView(window);
            }
            window.destroy();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(
            String origin,
            GeolocationPermissions.Callback callback
        ) {
            callback.invoke(origin, false, false);
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            String[] resources = request.getResources();
            for (String resource : resources) {
                if (
                    PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) ||
                    PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                ) {
                    request.deny();
                    return;
                }
            }

            super.onPermissionRequest(request);
        }
    }
}
