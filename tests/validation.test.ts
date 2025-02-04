import { promises as fsPromises } from 'node:fs'
import { convertSVGtoKCL } from '../main'
import path from 'path'
import { describe, it, expect } from '@jest/globals'

describe('Validation of SVG', () => {
  it('elliptical arc should be barked at', async () => {
    const inputPath = path.join(__dirname, 'data', 'elliptical_arc.svg')
    const outputPath = path.join(__dirname, 'data', 'output.kcl')

    // Run the conversion and expect an error to be thrown.
    await expect(convertSVGtoKCL(inputPath, outputPath, false)).rejects.toThrow(
      'Failed to parse SVG paths: Unsupported SVG commands found in the input.'
    )
  })
})
