module.exports = {
  // the shortcuts are read off a KeyboardEvent
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.jsx?$': 'esbuild-jest',
  },
  // jotai and nanoid ship ES modules only, and jotai's exports map is newer than
  // this jest can read, so the transform and the subpath resolution are set by
  // hand here
  moduleNameMapper: {
    '^jotai/(.*)$': '<rootDir>/../../node_modules/jotai/dist/$1.js',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(jotai|jotai-immer|nanoid)/)',
  ],
}
