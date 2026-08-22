module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // jsxImportSource lets NativeWind rewrite className on RN primitives.
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // NOTE: the Reanimated/worklets Babel plugin is injected by babel-preset-expo
    // automatically on SDK 50+. Adding it by hand here would double-apply it.
  };
};
