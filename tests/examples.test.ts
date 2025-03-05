import { describe, expect, it, jest } from '@jest/globals'
import { promises as fsPromises } from 'node:fs'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { convertSvgToKcl } from '../src/main'
import { KclOptions } from '../src/types/kcl'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

jest.setTimeout(30000)

const options: KclOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'examples')

describe('SVG to KCL Conversion', () => {
  it('should correctly convert project_payload.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'project_payload.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'project_payload.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })
})
