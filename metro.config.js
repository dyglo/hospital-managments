// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// React Native 0.88 needs package exports; Firebase also uses .cjs entry points.
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs'];

module.exports = config;
