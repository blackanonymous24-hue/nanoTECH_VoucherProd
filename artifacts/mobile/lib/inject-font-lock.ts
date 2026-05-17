/** Script injecté dans la WebView (prod ou dev) — indépendant du déploiement web. */
export const INJECT_LOCK_FONT_SCALE = `
(function () {
  function lock() {
    var root = document.documentElement;
    if (!root) return;
    root.classList.add("native-app", "font-scale-locked");
    root.style.setProperty("-webkit-text-size-adjust", "none", "important");
    root.style.setProperty("text-size-adjust", "none", "important");
    root.style.setProperty("font-size", "16px", "important");
    if (document.body) {
      document.body.style.setProperty("font-size", "16px", "important");
    }
    var st = document.getElementById("vn-apk-font-lock");
    if (!st) {
      st = document.createElement("style");
      st.id = "vn-apk-font-lock";
      st.textContent = "html,body,html.native-app,html.font-scale-locked{font-size:16px!important;-webkit-text-size-adjust:none!important;text-size-adjust:none!important}";
      (document.head || root).appendChild(st);
    }
  }
  lock();
  document.addEventListener("DOMContentLoaded", lock);
  window.addEventListener("load", lock);
})();
true;
`;
