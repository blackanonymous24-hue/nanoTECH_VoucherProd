module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      // Obligatoire avec expo-router + react-native-reanimated (sinon crash au démarrage APK)
      "react-native-reanimated/plugin",
    ],
  };
};
