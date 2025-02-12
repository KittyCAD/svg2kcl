import { describe, expect, it } from '@jest/globals'
import { promises as fsPromises } from 'node:fs'
import path from 'path'
import { convertSvgtoKcl } from '../src/main'
import { KclOptions } from '../src/types/kcl'

const options: KclOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'examples')

describe('Svg to Kcl Conversion', () => {
  it('should correctly convert project_payload.svg to Kcl', async () => {
    const inputPath = path.join(dataDir, 'project_payload.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'project_payload.kcl')

    // Run the conversion.
    await convertSvgtoKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })
})
