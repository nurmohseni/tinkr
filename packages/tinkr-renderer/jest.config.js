module.exports = {
  // the shortcuts are read off a KeyboardEvent
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.jsx?$': 'esbuild-jest',
  },
  // jotai and nanoid ship ES modules only, and jotai's exports map is newer than
  // this jest can read, so the transform and the subpath resolution are set by
  // hand here
  moduleNameMapper: {
    '^jotai/(.*)$': '<rootDir>/../../node_modules/jotai/dist/$1.js',
  },
  // react-intl and the formatjs packages it is built from ship ES modules only
  transformIgnorePatterns: [
    '/node_modules/(?!(jotai|jotai-immer|nanoid|react-intl|@formatjs|intl-messageformat|hoist-non-react-statics)/)',
  ],
}
