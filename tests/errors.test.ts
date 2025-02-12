import { describe, expect, it } from '@jest/globals'
import path from 'path'
import { convertSvgtoKcl } from '../src/main'
import { KclOptions } from '../src/types/kcl'

const options: KclOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'errors')

describe('Validation of SVG', () => {
  it('elliptical arc should be barked at', async () => {
    const inputPath = path.join(dataDir, 'elliptical_arc.svg')
    const outputPath = path.join(dataDir, 'output.kcl')

    // Run the conversion and expect an error to be thrown.
    await expect(convertSvgtoKcl(inputPath, outputPath, options)).rejects.toThrow(
      'Unsupported path command:'
    )
  })

  it('elliptse should be barked at', async () => {
    const inputPath = path.join(dataDir, 'ellipse.svg')
    const outputPath = path.join(dataDir, 'output.kcl')

    // Run the conversion and expect an error to be thrown.
    await expect(convertSvgtoKcl(inputPath, outputPath, options)).rejects.toThrow(
      'Unsupported shape type:'
    )
  })
})
