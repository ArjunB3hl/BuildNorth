/* eslint-env jest */
// jest-expo stubs native modules with functions that return undefined; give expo-crypto
// real UUIDs so new items get unique ids in tests, as they do in the app.
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  randomUUID: () => require('crypto').randomUUID(),
}));
