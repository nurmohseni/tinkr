module.exports = {
  extends: [
    'billyct',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  globals: {
    // inlined by vite, see vite.config.mjs
    __APP_VERSION__: 'readonly',
  },
  settings: {
    react: {
      version: '16.14',
    },
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
  },
}
