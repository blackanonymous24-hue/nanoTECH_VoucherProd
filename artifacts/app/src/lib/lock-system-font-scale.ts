/** Empêche la taille de police système (accessibilité) de grossir le texte dans l’app. */
export function lockSystemFontScale(): void {
  const root = document.documentElement;
  root.classList.add("font-scale-locked");
  root.style.setProperty("-webkit-text-size-adjust", "none");
  root.style.setProperty("text-size-adjust", "none");
  root.style.fontSize = "16px";
  if (document.body) {
    document.body.style.fontSize = "16px";
  }
}

/** Script injecté dans la WebView APK avant le chargement du document. */
export const LOCK_SYSTEM_FONT_SCALE_JS = `
(function () {
  var r = document.documentElement;
  r.classList.add("native-app", "font-scale-locked");
  r.style.setProperty("-webkit-text-size-adjust", "none");
  r.style.textSizeAdjust = "none";
  r.style.fontSize = "16px";
})();
true;
`;
