/**
 * WebView screen — loads the remote t3code web UI.
 * This is the main interaction screen where users chat with AI agents.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { WebView, type WebViewNavigation } from "react-native-webview";
import {
  loadConnections,
  touchConnection,
  type ServerConnection,
} from "../../src/lib/connections";
import { getT3WebUrl, getT3AuthInjectionJs, validateSession } from "../../src/lib/api";

export default function ConnectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);
  const [conn, setConn] = useState<ServerConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    (async () => {
      const conns = await loadConnections();
      const found = conns.find((c) => c.id === id);
      if (!found) {
        setError("Connection not found");
        return;
      }

      // Validate session before loading
      const sessionValid = await validateSession(found);
      if (!sessionValid) {
        setError("Session expired or revoked. Re-pair this device.");
        return;
      }

      setConn(found);
      await touchConnection(found.id);
    })();
  }, [id]);

  const handleNavigationChange = useCallback(
    (navState: WebViewNavigation) => {
      setCanGoBack(navState.canGoBack);
    },
    []
  );

  const handleError = useCallback(() => {
    setError("Failed to load t3code. Is the server running?");
    setLoading(false);
  }, []);

  const handleReload = () => {
    setError(null);
    setLoading(true);
    webViewRef.current?.reload();
  };

  // Injected before page content loads — persists through SPA navigation
  const injectedJsBeforeLoad = `
    (function() {
      var viewportContent = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';

      function ensureViewportMeta() {
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.name = 'viewport';
          (document.head || document.documentElement).appendChild(meta);
        }
        if (meta.getAttribute('content') !== viewportContent) {
          meta.setAttribute('content', viewportContent);
        }
      }

      function isEditableTarget(target) {
        if (!target || !(target instanceof Element)) return false;
        return Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable]:not([contenteditable="false"])'));
      }

      function enforceNoZoom() {
        ensureViewportMeta();
        if (document.documentElement) {
          document.documentElement.style.webkitTextSizeAdjust = '100%';
        }
      }

      function enforceEditableNoZoom(target) {
        if (!isEditableTarget(target)) return;
        enforceNoZoom();

        // iOS can re-apply page zoom on editable focus after the focus event fires.
        [0, 50, 150, 300].forEach(function(delay) {
          setTimeout(function() {
            enforceNoZoom();
            if (window.visualViewport && window.visualViewport.scale && window.visualViewport.scale !== 1) {
              window.scrollTo(window.scrollX, window.scrollY);
            }
          }, delay);
        });
      }

      enforceNoZoom();

      var rootObserver = new MutationObserver(function() {
        enforceNoZoom();
      });
      rootObserver.observe(document.documentElement, { childList: true, subtree: true });

      var headObserver = new MutationObserver(function() {
        enforceNoZoom();
      });
      if (document.head) {
        headObserver.observe(document.head, { childList: true, subtree: true, attributes: true });
      }

      var style = document.createElement('style');
      style.textContent = [
        'html { -webkit-text-size-adjust: 100% !important; }',
        'input, textarea, select, [contenteditable], [contenteditable] * { font-size: 16px !important; }',
        '* { touch-action: manipulation; }',
        '[data-testid="new-thread-button"] { opacity: 1 !important; }',
      ].join('\\n');
      (document.head || document.documentElement).appendChild(style);

      document.addEventListener('focusin', function(event) {
        enforceEditableNoZoom(event.target);
      }, true);

      window.addEventListener('resize', enforceNoZoom, true);
      window.addEventListener('orientationchange', enforceNoZoom, true);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', enforceNoZoom, true);
      }

      document.addEventListener('touchmove', function(event) {
        if (event.touches.length > 1) event.preventDefault();
      }, { passive: false });

      document.addEventListener('gesturestart', function(event) {
        event.preventDefault();
      }, { passive: false });
    })();
    true;
  `;

  // JavaScript injected after page load
  const authJs = conn ? getT3AuthInjectionJs(conn) : "";
  const injectedJs = `
    ${authJs}

    // Add dark background immediately
    document.body.style.backgroundColor = '#0a0a0a';

    // Disable default iOS callout (select/copy) but keep our custom handler
    document.body.style.webkitTouchCallout = 'none';
    document.body.style.webkitUserSelect = 'none';

    // Long-press to right-click: simulate contextmenu event on long touch
    (function() {
      var timer = null;
      var touchTarget = null;
      var LONG_PRESS_MS = 500;

      document.addEventListener('touchstart', function(e) {
        touchTarget = e.target;
        timer = setTimeout(function() {
          if (!touchTarget) return;
          var touch = e.changedTouches[0];
          var evt = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: touch.clientX,
            clientY: touch.clientY,
            screenX: touch.screenX,
            screenY: touch.screenY,
          });
          touchTarget.dispatchEvent(evt);
          // Prevent the subsequent click
          touchTarget.addEventListener('click', function stop(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            touchTarget.removeEventListener('click', stop, true);
          }, { capture: true, once: true });
        }, LONG_PRESS_MS);
      }, { passive: true });

      document.addEventListener('touchmove', function() {
        clearTimeout(timer);
        touchTarget = null;
      }, { passive: true });

      document.addEventListener('touchend', function() {
        clearTimeout(timer);
        touchTarget = null;
      }, { passive: true });

      document.addEventListener('touchcancel', function() {
        clearTimeout(timer);
        touchTarget = null;
      }, { passive: true });
    })();

    true;
  `;

  if (error && !conn) {
    return (
      <>
        <Stack.Screen options={{ title: "Error" }} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => router.back()}
          >
            <Text style={styles.retryText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  if (!conn) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  const webUrl = getT3WebUrl(conn);

  return (
    <>
      <Stack.Screen
        options={{
          title: conn.name,
          headerBackTitle: "Servers",
          headerBackButtonDisplayMode: "default",
          headerRight: () => (
            <View style={styles.headerRight}>
              <TouchableOpacity
                onPress={handleReload}
                style={styles.headerButton}
              >
                <Text style={styles.headerButtonText}>Reload</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: "/browse/[id]",
                    params: { id: conn.id },
                  })
                }
                style={styles.headerButton}
              >
                <Text style={styles.headerButtonText}>Files</Text>
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <View style={styles.container}>
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{error}</Text>
            <TouchableOpacity onPress={handleReload}>
              <Text style={styles.retryInlineText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
        <WebView
          ref={webViewRef}
          source={{
            uri: webUrl,
            headers: conn.authToken
              ? { Authorization: `Bearer ${conn.authToken}` }
              : undefined,
          }}
          style={styles.webview}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={handleError}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode === 401) {
              Alert.alert(
                "Authentication Required",
                "The t3code server requires an auth token. Edit this connection to add one.",
                [
                  { text: "Go Back", onPress: () => router.back() },
                  {
                    text: "Edit",
                    onPress: () =>
                      router.push({
                        pathname: "/add",
                        params: {
                          editId: conn.id,
                          editName: conn.name,
                          editHost: conn.host,
                          editT3Port: String(conn.t3Port),
                          editCompanionPort: String(conn.companionPort),
                          editAuthToken: conn.authToken || "",
                        },
                      }),
                  },
                ]
              );
            }
          }}
          onNavigationStateChange={handleNavigationChange}
          injectedJavaScriptBeforeContentLoaded={injectedJsBeforeLoad}
          injectedJavaScript={injectedJs}
          javaScriptEnabled
          domStorageEnabled
          allowsBackForwardNavigationGestures={false}
          allowsInlineMediaPlayback
          scrollEnabled={true}
          mediaPlaybackRequiresUserAction={false}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text style={styles.loadingText}>
                Connecting to {conn.host}...
              </Text>
            </View>
          )}
          originWhitelist={[`http://${conn.host}:*`, `https://${conn.host}:*`]}
        />
        {loading && (
          <View style={styles.loadingBar}>
            <View style={styles.loadingBarInner} />
          </View>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  webview: { flex: 1, backgroundColor: "#0a0a0a" },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
  },
  loadingText: { color: "#6b7280", marginTop: 12, fontSize: 14 },
  loadingBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "#1a1a1a",
  },
  loadingBarInner: {
    height: 2,
    width: "30%",
    backgroundColor: "#3b82f6",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0a0a0a",
    padding: 40,
  },
  errorText: { color: "#ef4444", fontSize: 16, textAlign: "center" },
  retryButton: {
    marginTop: 20,
    backgroundColor: "#3b82f6",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  errorBanner: {
    backgroundColor: "#7f1d1d",
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorBannerText: { color: "#fca5a5", fontSize: 13 },
  retryInlineText: { color: "#3b82f6", fontSize: 13, fontWeight: "600" },
  headerRight: { flexDirection: "row", gap: 12 },
  headerButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerButtonText: { color: "#3b82f6", fontSize: 14, fontWeight: "500" },
});
