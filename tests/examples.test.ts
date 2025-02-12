import { describe, expect, it } from '@jest/globals'
import { promises as fsPromises } from 'node:fs'
import path from 'path'
import { convertSVGtoKCL } from '../src/main'
import { KCLOptions } from '../src/types/kcl'

const options: KCLOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'examples')

describe('SVG to KCL Conversion', () => {
  it('should correctly convert project_payload.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'project_payload.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'project_payload.kcl')

    // Run the conversion.
    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })
})
