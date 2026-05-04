import { useState, useEffect } from "react";

/**
 * Returns true when the current browser tab is visible and the window is not minimized.
 * Uses the Page Visibility API (document.visibilityState / visibilitychange).
 *
 * Used to:
 * - Pause all MikroTik API requests when the tab is hidden / browser minimized
 * - Close SSE connections when hidden (frees server-side poller slots)
 * - Resume everything automatically when the tab becomes active again
 *
 * Covers all cases:
 *   - Tab switched to background        → hidden
 *   - Browser window minimized          → hidden
 *   - Multiple tabs: inactive tab       → hidden
 *   - Tab active / window foregrounded  → visible
 */
export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState<boolean>(
    typeof document !== "undefined" ? !document.hidden : true,
  );

  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}
