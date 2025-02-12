import { describe, expect, it } from '@jest/globals'
import { promises as fsPromises } from 'node:fs'
import path from 'path'
import { convertSvgToKcl } from '../src/main'
import { KclOptions } from '../src/types/kcl'

const options: KclOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'transforms')

describe('Svg to KCL Conversion', () => {
  it('should correctly convert basic_transform.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_transform.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'basic_transform.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert skew.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'skew.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'skew.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert group_transform.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'group_transform.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'group_transform.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert nested_group_transform.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'nested_group_transform.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'nested_group_transform.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert matrix_transform.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'matrix_transform.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'matrix_transform.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert mixed_transforms.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'mixed_transforms.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'mixed_transforms.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })
})
