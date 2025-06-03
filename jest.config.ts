import type { Config } from 'jest'

export default async (): Promise<Config> => {
  return {
    preset: 'ts-jest',
    testEnvironment: 'node',
    verbose: false,
    transformIgnorePatterns: ['node_modules/(?!(earcut|robust-point-in-polygon)/)'],
    transform: {
      '^.+\\.(ts|tsx)$': 'ts-jest',
      '^.+\\.(js|jsx)$': 'babel-jest'
    }
  }
}
