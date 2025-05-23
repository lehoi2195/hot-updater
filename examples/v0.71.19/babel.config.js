module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    'hot-updater/babel-plugin',
    [
      'module:react-native-dotenv',
      {
        envName: 'APP_ENV',
        moduleName: '@env',
        allowlist: ['HOT_UPDATER_SUPABASE_URL', 'HOT_UPDATER_SENTRY_DSN'],
        path: '.env',
      },
    ],
  ],
};
