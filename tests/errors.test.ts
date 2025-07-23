import { describe, expect, it } from 'vitest'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { convertSvgToKcl } from '../src/main'
import { KclOptions } from '../src/types/kcl'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const options: KclOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'errors')

describe('Validation of SVG', () => {
  it('elliptical arc should be barked at', async () => {
    const inputPath = path.join(dataDir, 'elliptical_arc.svg')
    const outputPath = path.join(dataDir, 'output.kcl')

    // Run the conversion and expect an error to be thrown.
    await expect(convertSvgToKcl(inputPath, outputPath, options)).rejects.toThrow(
      'Unsupported path command:'
    )
  })

  it('ellipse should be barked at', async () => {
    const inputPath = path.join(dataDir, 'ellipse.svg')
    const outputPath = path.join(dataDir, 'output.kcl')

    // Run the conversion and expect an error to be thrown.
    await expect(convertSvgToKcl(inputPath, outputPath, options)).rejects.toThrow(
      'Unsupported shape type:'
    )
  })
})
