import { describe, expect, it } from '@jest/globals'
import path from 'path'
import { convertSVGtoKCL } from '../src/main-new'
import { KCLOptions } from '../src/types/kcl'

const options: KCLOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'errors')

describe('Validation of SVG', () => {
  it('elliptical arc should be barked at', async () => {
    const inputPath = path.join(dataDir, 'elliptical_arc.svg')
    const outputPath = path.join(dataDir, 'output.kcl')

    // Run the conversion and expect an error to be thrown.
    await expect(convertSVGtoKCL(inputPath, outputPath, options)).rejects.toThrow(
      'Unsupported SVG commands found in the input.'
    )
  })
})
