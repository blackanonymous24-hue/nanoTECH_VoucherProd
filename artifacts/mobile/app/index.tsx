import React, { useRef, useState, useCallback, useEffect } from "react";
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
  type AppStateStatus,
} from "react-native";
import { WebView, WebViewNavigation, WebViewMessageEvent } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

/** URL du front web (Vite) chargé dans la WebView. Définir `EXPO_PUBLIC_WEB_APP_URL` pour la prod ou un LAN (voir DEVELOPMENT.md). */
const PROD_URL = process.env.EXPO_PUBLIC_WEB_APP_URL?.trim() || "http://127.0.0.1:4173";
const RELOAD_SPINNER_TIMEOUT = 8000;

/** Doit être identique à `APK_APP_STATE_EVENT` dans `artifacts/app/src/components/SessionLifecycle.tsx`. */
const WEB_APK_APP_STATE_EVENT = "vouchernet-apk-app-state";

export default function AppScreen() {
  const webViewRef = useRef<WebView>(null);
  const insets = useSafeAreaInsets();
  const [canGoBack, setCanGoBack] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(PROD_URL);

  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExplicitReloadRef = useRef(false);
  const canGoBackRef = useRef(false);

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

  useEffect(() => {
    return () => clearReloadTimer();
  }, []);

  const injectApkPresenceToWeb = useCallback((state: AppStateStatus) => {
    const away = state !== "active";
    webViewRef.current?.injectJavaScript(`
      window.dispatchEvent(new CustomEvent("${WEB_APK_APP_STATE_EVENT}", { detail: ${away} }));
      true;
    `);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      injectApkPresenceToWeb(nextState);
    });
    return () => sub.remove();
  }, [injectApkPresenceToWeb]);

  const handleNavigationStateChange = (state: WebViewNavigation) => {
    canGoBackRef.current = state.canGoBack;
    setCanGoBack(state.canGoBack);
    setCurrentUrl(state.url);
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  const handleLoadEnd = useCallback(() => {
    injectApkPresenceToWeb(AppState.currentState);
    if (isExplicitReloadRef.current) {
      clearReloadTimer();
      setIsLoading(false);
      isExplicitReloadRef.current = false;
    }
  }, [injectApkPresenceToWeb]);

  const handleBack = () => {
    webViewRef.current?.goBack();
  };

  const handleRefresh = () => {
    setHasError(false);
    isExplicitReloadRef.current = true;
    setIsLoading(true);
    startReloadTimer();
    webViewRef.current?.reload();
  };

  const handleHome = () => {
    isExplicitReloadRef.current = true;
    setIsLoading(true);
    startReloadTimer();
    webViewRef.current?.injectJavaScript(`window.location.href = '${PROD_URL}';`);
  };

  // Accumule les chunks pour les gros lots (> 500 KB par message)
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

      // ── Protocole chunked (gros lots) ──
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

      // ── Message direct (petits lots) ──
      if (data.type !== "print" || typeof data.html !== "string") return;
      await doPrint(data.html as string, data.title as string);
    } catch {
      Alert.alert("Impression", "Impossible de lancer l'impression.");
    }
  }, [doPrint]);

  const isVendorPortal = currentUrl.includes("/vendeur") || currentUrl.includes("/vendor-portal");

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerLeft}>
          {canGoBack && (
            <TouchableOpacity onPress={handleBack} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="arrow-left" size={20} color="#e2e8f0" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity onPress={handleHome} style={styles.headerTitle}>
          <View style={styles.logoRow}>
            <Feather name="wifi" size={18} color="#60a5fa" />
            <Text style={styles.titleText} numberOfLines={1}>
              {isVendorPortal ? "Portail Vendeur" : "nanoTECH Vouchers"}
            </Text>
          </View>
          {isVendorPortal && (
            <Text style={styles.subtitleText}>Vouchers</Text>
          )}
        </TouchableOpacity>

        <View style={styles.headerRight}>
          <TouchableOpacity onPress={handleRefresh} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="refresh-cw" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      </View>

      {/* WebView */}
      {hasError ? (
        <View style={styles.errorContainer}>
          <Feather name="wifi-off" size={48} color="#475569" />
          <Text style={styles.errorTitle}>Connexion impossible</Text>
          <Text style={styles.errorText}>Vérifiez votre connexion internet et réessayez.</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRefresh}>
            <Feather name="refresh-cw" size={16} color="#fff" />
            <Text style={styles.retryText}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: PROD_URL }}
          style={styles.webview}
          onNavigationStateChange={handleNavigationStateChange}
          onLoadEnd={handleLoadEnd}
          onMessage={handleMessage}
          onError={() => { setHasError(true); setIsLoading(false); clearReloadTimer(); isExplicitReloadRef.current = false; }}
          onHttpError={() => { setIsLoading(false); clearReloadTimer(); isExplicitReloadRef.current = false; }}
          allowsBackForwardNavigationGestures={Platform.OS === "ios"}
          pullToRefreshEnabled
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          cacheEnabled
          startInLoadingState={false}
          userAgent="nanoTECH-Vouchers-Mobile/1.0"
        />
      )}

      {/* Loading overlay — only for explicit reloads (max 8s) */}
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#60a5fa" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  header: {
    backgroundColor: "#0f172a",
    paddingBottom: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  headerLeft: {
    width: 40,
    alignItems: "flex-start",
  },
  headerRight: {
    width: 40,
    alignItems: "flex-end",
  },
  headerTitle: {
    flex: 1,
    alignItems: "center",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  titleText: {
    color: "#f1f5f9",
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  subtitleText: {
    color: "#60a5fa",
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  headerBtn: {
    padding: 4,
  },
  webview: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0f172a",
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
    fontFamily: "Inter_700Bold",
    marginTop: 8,
  },
  errorText: {
    color: "#94a3b8",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
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
    fontFamily: "Inter_600SemiBold",
  },
});
