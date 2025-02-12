import { describe, expect, it } from '@jest/globals'
import { promises as fsPromises } from 'node:fs'
import path from 'path'
import { convertSVGtoKCL } from '../src/main-new'
import { KCLOptions } from '../src/types/kcl'

const options: KCLOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'transforms')

describe('SVG to KCL Conversion', () => {
  it('should correctly convert basic_transform.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_transform.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'basic_transform.kcl')

    // Run the conversion.
    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  // it('should correctly convert skew.svg to KCL', async () => {
  //   const inputPath = path.join(dataDir, 'skew.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKCLPath = path.join(dataDir, 'skew.kcl')

  //   // Run the conversion.
  //   await convertSVGtoKCL(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKCL.trim())
  // })

  // it('should correctly convert group_transform.svg to KCL', async () => {
  //   const inputPath = path.join(dataDir, 'group_transform.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKCLPath = path.join(dataDir, 'group_transform.kcl')

  //   // Run the conversion.
  //   await convertSVGtoKCL(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKCL.trim())
  // })

  // it('should correctly convert nested_group_transform.svg to KCL', async () => {
  //   const inputPath = path.join(dataDir, 'nested_group_transform.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKCLPath = path.join(dataDir, 'nested_group_transform.kcl')

  //   // Run the conversion.
  //   await convertSVGtoKCL(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKCL.trim())
  // })

  // it('should correctly convert matrix_transform.svg to KCL', async () => {
  //   const inputPath = path.join(dataDir, 'matrix_transform.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKCLPath = path.join(dataDir, 'matrix_transform.kcl')

  //   // Run the conversion.
  //   await convertSVGtoKCL(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKCL.trim())
  // })

  // it('should correctly convert mixed_transforms.svg to KCL', async () => {
  //   const inputPath = path.join(dataDir, 'mixed_transforms.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKCLPath = path.join(dataDir, 'mixed_transforms.kcl')

  //   // Run the conversion.
  //   await convertSVGtoKCL(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKCL.trim())
  // })

  // it('should correctly convert project_payload.svg to KCL', async () => {
  //   const inputPath = path.join(dataDir, 'project_payload.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKCLPath = path.join(dataDir, 'project_payload.kcl')

  //   // Run the conversion.
  //   await convertSVGtoKCL(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKCL.trim())
  // })
})
