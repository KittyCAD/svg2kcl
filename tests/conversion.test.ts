import { promises as fsPromises } from 'node:fs'
import { convertSVGtoKCL } from '../main'
import path from 'path'
import { describe, it, expect } from '@jest/globals'

describe('SVG to KCL Conversion', () => {
  it('should correctly convert basic_transform.svg to KCL', async () => {
    const inputPath = path.join(__dirname, 'data', 'basic_transform.svg')
    const outputPath = path.join(__dirname, 'data', 'output.kcl')
    const expectedKCLPath = path.join(__dirname, 'data', 'basic_transform.kcl')

    // Run the conversion.
    await convertSVGtoKCL(inputPath, outputPath, false)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  it('should correctly convert project_payload.svg to KCL', async () => {
    const inputPath = path.join(__dirname, 'data', 'project_payload.svg')
    const outputPath = path.join(__dirname, 'data', 'output.kcl')
    const expectedKCLPath = path.join(__dirname, 'data', 'project_payload.kcl')

    // Run the conversion.
    await convertSVGtoKCL(inputPath, outputPath, false)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })
})
