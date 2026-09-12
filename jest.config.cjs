module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { isolatedModules: true } }] },
  clearMocks: true,
};
