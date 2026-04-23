/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  roots: ['<rootDir>/src'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
};
