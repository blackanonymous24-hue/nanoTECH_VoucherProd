/**
 * Force fontScale = 1.0 pour toute l’app Android (WebView incluse).
 * Sans cela, textZoom={100} ne suffit pas toujours quand la taille de police
 * système est élevée (Paramètres > Affichage > Taille de police).
 */
const { withMainApplication } = require("@expo/config-plugins");

const ATTACH_MARKER = "vn-disable-font-scaling";

function withDisableFontScaling(config) {
  return withMainApplication(config, (mod) => {
    let src = mod.modResults.contents;
    if (src.includes(ATTACH_MARKER)) {
      return mod;
    }

    if (!src.includes("import android.content.Context")) {
      src = src.replace(
        /^package .+$/m,
        (line) => `${line}\nimport android.content.Context`,
      );
    }
    if (!src.includes("import android.content.res.Configuration")) {
      src = src.replace(
        /^package .+$/m,
        (line) => `${line}\nimport android.content.res.Configuration`,
      );
    }

    const isKotlin = src.includes("class MainApplication") && src.includes("fun ");
    if (isKotlin) {
      if (!src.includes("override fun attachBaseContext")) {
        src = src.replace(
          /class MainApplication\s*:\s*Application\(\),\s*ReactApplication\s*\{/,
          `class MainApplication : Application(), ReactApplication {
  // ${ATTACH_MARKER}
  override fun attachBaseContext(base: Context) {
    val configuration = Configuration(base.resources.configuration)
    configuration.fontScale = 1.0f
    val context = base.createConfigurationContext(configuration)
    super.attachBaseContext(context)
  }`,
        );
      }
    } else {
      if (!src.includes("attachBaseContext")) {
        src = src.replace(
          /public class MainApplication extends Application implements ReactApplication\s*\{/,
          `public class MainApplication extends Application implements ReactApplication {
  // ${ATTACH_MARKER}
  @Override
  protected void attachBaseContext(Context base) {
    Configuration configuration = new Configuration(base.getResources().getConfiguration());
    configuration.fontScale = 1.0f;
  Context context = base.createConfigurationContext(configuration);
    super.attachBaseContext(context);
  }`,
        );
      }
    }

    mod.modResults.contents = src;
    return mod;
  });
}

module.exports = withDisableFontScaling;
