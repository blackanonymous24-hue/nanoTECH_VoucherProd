import { useCallback, useEffect, useState } from "react";
import { AppState, PixelRatio, type AppStateStatus } from "react-native";

/** Compense la taille de police système Android dans la WebView (textZoom). */
export function useWebViewTextZoom(): number {
  const compute = useCallback((): number => {
    const scale = PixelRatio.getFontScale();
    if (!Number.isFinite(scale) || scale <= 1) return 100;
    return Math.max(50, Math.min(100, Math.round(100 / scale)));
  }, []);

  const [textZoom, setTextZoom] = useState(compute);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") setTextZoom(compute());
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [compute]);

  return textZoom;
}
