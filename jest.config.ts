import type { Config } from 'jest'

export default async (): Promise<Config> => {
  return {
    verbose: false,
    testEnvironment: 'node',
    preset: 'ts-jest/presets/default-esm',
    extensionsToTreatAsEsm: ['.ts', '.tsx'], // Ensure Jest treats TypeScript files as ES modules.
    transform: {
      '^.+\\.tsx?$': [
        'ts-jest',
        {
          useESM: true, // Ensure ts-jest transpiles TS files as ES modules.
          tsconfig: 'tsconfig.json'
        }
      ]
    },
    moduleNameMapper: {
      '^(\\.{1,2}/.*)\\.js$': '$1' // Workaround for Jest's module resolution.
    }
  }
}
