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

    // Disable native iOS callouts/selection so long-press can be repurposed.
    document.documentElement.style.webkitTouchCallout = 'none';
    document.documentElement.style.webkitUserSelect = 'none';
    document.documentElement.style.userSelect = 'none';
    document.body.style.webkitTouchCallout = 'none';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.userSelect = 'none';

    // Long-press to right-click: simulate a DOM contextmenu event on touch hold.
    (function() {
      if (window.__t3LongPressContextMenuInstalled) return;
      window.__t3LongPressContextMenuInstalled = true;

      var LONG_PRESS_MS = 500;
      var MOVE_THRESHOLD_PX = 12;
      var CLICK_SUPPRESS_MS = 750;
      var activePress = null;
      var suppressClicksUntil = 0;

      function getTouchById(touchList, identifier) {
        if (!touchList) return null;
        for (var i = 0; i < touchList.length; i += 1) {
          if (touchList[i].identifier === identifier) return touchList[i];
        }
        return null;
      }

      function clearPress(press) {
        if (!press) return;
        press.cancelled = true;
        if (press.timer) {
          clearTimeout(press.timer);
          press.timer = null;
        }
        if (activePress === press) {
          activePress = null;
        }
      }

      function heldLongEnough(press) {
        return Boolean(press) && (Date.now() - press.startTime >= LONG_PRESS_MS);
      }

      function shouldSuppressMouseEvent() {
        return Date.now() < suppressClicksUntil;
      }

      function suppressEvent(event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) {
          event.stopImmediatePropagation();
        }
      }

      function dispatchContextMenu(press) {
        if (!press || press.cancelled || press.moved || press.longPressFired) return;
        if (press.endTime && press.endTime - press.startTime < LONG_PRESS_MS) return;

        press.longPressFired = true;
        suppressClicksUntil = Date.now() + CLICK_SUPPRESS_MS;

        var target =
          document.elementFromPoint(press.lastClientX, press.lastClientY) ||
          press.target;
        if (!target) return;

        var eventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          detail: 0,
          button: 2,
          buttons: 2,
          which: 3,
          clientX: press.lastClientX,
          clientY: press.lastClientY,
          screenX: press.lastScreenX,
          screenY: press.lastScreenY,
        };

        var contextMenuEvent;
        try {
          contextMenuEvent = new MouseEvent('contextmenu', eventInit);
        } catch (error) {
          contextMenuEvent = document.createEvent('MouseEvents');
          contextMenuEvent.initMouseEvent(
            'contextmenu',
            true,
            true,
            window,
            0,
            press.lastScreenX,
            press.lastScreenY,
            press.lastClientX,
            press.lastClientY,
            false,
            false,
            false,
            false,
            2,
            null
          );
        }

        target.dispatchEvent(contextMenuEvent);
      }

      document.addEventListener('click', function(event) {
        if (shouldSuppressMouseEvent()) {
          suppressEvent(event);
        }
      }, { capture: true, passive: false });

      document.addEventListener('touchstart', function(event) {
        if (!event.changedTouches || event.changedTouches.length === 0) return;
        if (event.touches.length !== 1) {
          clearPress(activePress);
          return;
        }

        clearPress(activePress);

        var touch = event.changedTouches[0];
        var press = {
          identifier: touch.identifier,
          target: event.target,
          startTime: Date.now(),
          endTime: 0,
          startX: touch.clientX,
          startY: touch.clientY,
          lastClientX: touch.clientX,
          lastClientY: touch.clientY,
          lastScreenX: touch.screenX,
          lastScreenY: touch.screenY,
          moved: false,
          cancelled: false,
          longPressFired: false,
          timer: null,
        };

        press.timer = setTimeout(function() {
          dispatchContextMenu(press);
          if (press.endTime || press.cancelled || press.moved) {
            clearPress(press);
          }
        }, LONG_PRESS_MS);

        activePress = press;
      }, { capture: true, passive: false });

      document.addEventListener('touchmove', function(event) {
        var press = activePress;
        if (!press) return;

        var touch =
          getTouchById(event.touches, press.identifier) ||
          getTouchById(event.changedTouches, press.identifier);
        if (!touch) return;

        press.lastClientX = touch.clientX;
        press.lastClientY = touch.clientY;
        press.lastScreenX = touch.screenX;
        press.lastScreenY = touch.screenY;

        var deltaX = touch.clientX - press.startX;
        var deltaY = touch.clientY - press.startY;
        if ((deltaX * deltaX) + (deltaY * deltaY) > (MOVE_THRESHOLD_PX * MOVE_THRESHOLD_PX)) {
          press.moved = true;
          clearPress(press);
          return;
        }

        if (press.longPressFired) {
          suppressEvent(event);
        }
      }, { capture: true, passive: false });

      document.addEventListener('touchend', function(event) {
        var press = activePress;
        if (!press) return;

        var touch = getTouchById(event.changedTouches, press.identifier);
        if (!touch) return;

        press.lastClientX = touch.clientX;
        press.lastClientY = touch.clientY;
        press.lastScreenX = touch.screenX;
        press.lastScreenY = touch.screenY;
        press.endTime = Date.now();

        if (press.longPressFired || heldLongEnough(press)) {
          suppressClicksUntil = Date.now() + CLICK_SUPPRESS_MS;
          suppressEvent(event);
        }

        // Do not clear the timer here; let the timeout decide whether the hold qualified.
        if (press.longPressFired || press.endTime - press.startTime < LONG_PRESS_MS) {
          activePress = null;
        }
      }, { capture: true, passive: false });

      document.addEventListener('touchcancel', function(event) {
        if (activePress && heldLongEnough(activePress)) {
          suppressClicksUntil = Date.now() + CLICK_SUPPRESS_MS;
          suppressEvent(event);
        }
        clearPress(activePress);
      }, { capture: true, passive: false });
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
  container: { flex: 1, backgroundColor: "#000" },
  webview: { flex: 1, backgroundColor: "#000" },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  loadingText: { color: "#555", marginTop: 12, fontSize: 14 },
  loadingBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "#111",
  },
  loadingBarInner: {
    height: 1,
    width: "30%",
    backgroundColor: "#fff",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
    padding: 40,
  },
  errorText: { color: "#f87171", fontSize: 15, textAlign: "center" },
  retryButton: {
    marginTop: 20,
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  retryText: { color: "#000", fontSize: 15, fontWeight: "600" },
  errorBanner: {
    backgroundColor: "#1a0000",
    borderBottomWidth: 1,
    borderBottomColor: "#2d0a0a",
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  errorBannerText: { color: "#f87171", fontSize: 13 },
  retryInlineText: { color: "#fff", fontSize: 13, fontWeight: "500" },
  headerRight: { flexDirection: "row", gap: 24, paddingRight: 8 },
  headerButton: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  headerButtonText: { color: "#fff", fontSize: 14, fontWeight: "400" },
});
