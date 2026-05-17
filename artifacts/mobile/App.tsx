import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Platform,
  StatusBar,
  BackHandler,
  Alert,
  AppState,
  PanResponder,
  type AppStateStatus,
} from "react-native";
import { WebView, type WebViewNavigation, type WebViewMessageEvent } from "react-native-webview";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import Constants from "expo-constants";
import * as SplashScreen from "expo-splash-screen";

SplashScreen.preventAutoHideAsync().catch(() => {});

const DEFAULT_WEB_URL = "https://nanovoucher.com";
const extraUrl = (Constants.expoConfig?.extra as { webAppUrl?: string } | undefined)?.webAppUrl?.trim();
const PROD_URL = process.env.EXPO_PUBLIC_WEB_APP_URL?.trim() || extraUrl || DEFAULT_WEB_URL;
const WEBVIEW_USER_AGENT = "nanoTECH-VouchersBills-Mobile/1.0";
const RELOAD_SPINNER_TIMEOUT = 8000;

/** Zone sensible au bord gauche pour le geste « retour » (glisser → droite). */
const EDGE_BACK_WIDTH = 28;
const EDGE_BACK_SWIPE_MIN = 56;

const WEB_APK_APP_STATE_EVENT = "vouchernet-apk-app-state";

function WebAppShell() {
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExplicitReloadRef = useRef(false);
  const canGoBackRef = useRef(false);

  const webTopInset = insets.top;
  const webBottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 40 : 0);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const clearReloadTimer = () => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
  };

  const startReloadTimer = () => {
    clearReloadTimer();
    reloadTimerRef.current = setTimeout(() => {
      setIsLoading(false);
      isExplicitReloadRef.current = false;
    }, RELOAD_SPINNER_TIMEOUT);
  };

  useEffect(() => () => clearReloadTimer(), []);

  const goBackInWebView = useCallback(() => {
    if (!canGoBackRef.current) return false;
    webViewRef.current?.goBack();
    return true;
  }, []);

  const edgeBackPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) => evt.nativeEvent.pageX <= EDGE_BACK_WIDTH,
        onMoveShouldSetPanResponder: (evt, g) =>
          evt.nativeEvent.pageX <= EDGE_BACK_WIDTH + 24 &&
          g.dx > 12 &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
        onPanResponderRelease: (_, g) => {
          if (g.dx >= EDGE_BACK_SWIPE_MIN) goBackInWebView();
        },
      }),
    [goBackInWebView],
  );

  const injectApkPresenceToWeb = useCallback((state: AppStateStatus) => {
    const away = state !== "active";
    webViewRef.current?.injectJavaScript(`
      window.dispatchEvent(new CustomEvent("${WEB_APK_APP_STATE_EVENT}", { detail: ${away} }));
      true;
    `);
  }, []);

  const injectWebSafeArea = useCallback(() => {
    const top = Math.round(webTopInset);
    const bottom = Math.round(webBottomInset);
    webViewRef.current?.injectJavaScript(`
      (function () {
        document.documentElement.classList.add("native-app");
        document.documentElement.style.setProperty("--apk-safe-top", "${top}px");
        document.documentElement.style.setProperty("--apk-safe-bottom", "${bottom}px");
      })();
      true;
    `);
  }, [webTopInset, webBottomInset]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", injectApkPresenceToWeb);
    return () => sub.remove();
  }, [injectApkPresenceToWeb]);

  const handleNavigationStateChange = (state: WebViewNavigation) => {
    canGoBackRef.current = state.canGoBack;
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => goBackInWebView());
    return () => subscription.remove();
  }, [goBackInWebView]);

  const handleLoadEnd = useCallback(() => {
    injectApkPresenceToWeb(AppState.currentState);
    injectWebSafeArea();
    if (isExplicitReloadRef.current) {
      clearReloadTimer();
      setIsLoading(false);
      isExplicitReloadRef.current = false;
    }
  }, [injectApkPresenceToWeb, injectWebSafeArea]);

  useEffect(() => {
    injectWebSafeArea();
  }, [injectWebSafeArea]);

  const handleRefresh = () => {
    setHasError(false);
    isExplicitReloadRef.current = true;
    setIsLoading(true);
    startReloadTimer();
    webViewRef.current?.reload();
  };

  const printChunksRef = useRef<Map<string, { parts: string[]; received: number; total: number; title: string }>>(new Map());

  const doPrint = useCallback(async (html: string, title: string) => {
    if (Platform.OS === "ios") {
      await Print.printAsync({ html });
    } else {
      try {
        await Print.printAsync({ html });
      } catch {
        const canShare = await Sharing.isAvailableAsync();
        if (!canShare) {
          Alert.alert(
            "Impression",
            "Aucun service d'impression disponible sur cet appareil. Installez un service d'impression Android ou activez-en un dans les paramètres.",
          );
          return;
        }
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "Imprimer ou enregistrer",
          UTI: "com.adobe.pdf",
        });
      }
    }
  }, []);

  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === "print_chunk") {
        const { chunkId, index, total, title, data: chunk } = data as {
          chunkId: string; index: number; total: number; title: string; data: string;
        };
        if (!printChunksRef.current.has(chunkId)) {
          printChunksRef.current.set(chunkId, { parts: new Array(total).fill(""), received: 0, total, title });
        }
        const entry = printChunksRef.current.get(chunkId)!;
        entry.parts[index] = chunk;
        entry.received += 1;
        if (entry.received === entry.total) {
          printChunksRef.current.delete(chunkId);
          await doPrint(entry.parts.join(""), entry.title);
        }
        return;
      }

      if (data.type !== "print" || typeof data.html !== "string") return;
      await doPrint(data.html as string, data.title as string);
    } catch {
      Alert.alert("Impression", "Impossible de lancer l'impression.");
    }
  }, [doPrint]);

  const webChromeStyle = {
    paddingTop: webTopInset,
    paddingBottom: webBottomInset,
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" translucent={Platform.OS === "android"} />

      {hasError ? (
        <View style={[styles.errorContainer, webChromeStyle]}>
          <Feather name="wifi-off" size={48} color="#475569" />
          <Text style={styles.errorTitle}>Connexion impossible</Text>
          <Text style={styles.errorText}>Vérifiez votre connexion internet et réessayez.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRefresh}>
            <Feather name="refresh-cw" size={16} color="#fff" />
            <Text style={styles.retryText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.webviewWrap, webChromeStyle]}>
          <WebView
            ref={webViewRef}
            source={{ uri: PROD_URL }}
            style={styles.webview}
            onNavigationStateChange={handleNavigationStateChange}
            onLoadEnd={handleLoadEnd}
            onMessage={handleMessage}
            onError={() => { setHasError(true); setIsLoading(false); clearReloadTimer(); isExplicitReloadRef.current = false; }}
            onHttpError={() => { setIsLoading(false); clearReloadTimer(); isExplicitReloadRef.current = false; }}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            cacheEnabled
            startInLoadingState={false}
            userAgent={WEBVIEW_USER_AGENT}
          />
          <View style={styles.edgeBackLayer} pointerEvents="box-none">
            <View style={styles.edgeBackStrip} {...edgeBackPan.panHandlers} />
          </View>
        </View>
      )}

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#60a5fa" />
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <WebAppShell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  webviewWrap: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  webview: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  edgeBackLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  edgeBackStrip: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE_BACK_WIDTH,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  errorContainer: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  errorTitle: {
    color: "#f1f5f9",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 8,
  },
  errorText: {
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#2563eb",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
  },
  retryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
