module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      // Obligatoire avec react-native-reanimated (doit être le dernier plugin)
      "react-native-reanimated/plugin",
    ],
  };
};
