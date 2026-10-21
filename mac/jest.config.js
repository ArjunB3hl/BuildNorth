module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // The screen walk renders the whole app many times.
  testTimeout: 30000,
};
