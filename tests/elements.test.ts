import { describe, expect, it } from '@jest/globals'
import { promises as fsPromises } from 'node:fs'
import path from 'path'
import { convertSVGtoKCL } from '../src/main-new'
import { KCLOptions } from '../src/types/kcl'

const options: KCLOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'elements')

describe('SVG Basic Elements to KCL Conversion', () => {
  // Actually a good test for fill rule.
  //   it('should correctly convert basic_path.svg to KCL', async () => {
  //     const inputPath = path.join(dataDir, 'basic_path.svg')
  //     const outputPath = path.join(dataDir, 'output.kcl')
  //     const expectedKCLPath = path.join(dataDir, 'basic_path.kcl')

  //     // Run the conversion
  //     await convertSVGtoKCL(inputPath, outputPath, options)
  //     const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //     const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

  //     // Compare output with expected result
  //     expect(actualKCL.trim()).toBe(expectedKCL.trim())
  //   })

  it('should correctly convert basic_rectangle.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_rectangle.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'basic_rectangle.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  it('should correctly convert basic_circle.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_circle.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'basic_circle.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  it('should correctly convert basic_line.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_line.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'basic_line.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  it('should correctly convert basic_polyline.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_polyline.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'basic_polyline.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  it('should correctly convert basic_polygon.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_polygon.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'basic_polygon.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })
})

describe('SVG Group Elements to KCL Conversion', () => {
  it('should correctly convert basic_group.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_group.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'basic_group.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  it('should correctly convert nested_group.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'nested_group.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'nested_group.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })
})

describe('SVG Complex Cases to KCL Conversion', () => {
  it('should correctly convert mixed_elements.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'mixed_elements.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'mixed_elements.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  it('should correctly convert compound_path.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'compound_path.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKCLPath = path.join(dataDir, 'compound_path.kcl')

    await convertSVGtoKCL(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKCL = await fsPromises.readFile(expectedKCLPath, 'utf8')

    expect(actualKCL.trim()).toBe(expectedKCL.trim())
  })

  it('should throw error for polyline with less than 2 points', async () => {
    const inputPath = path.join(dataDir, 'invalid_polyline.svg')
    const outputPath = path.join(dataDir, 'output.kcl')

    await expect(convertSVGtoKCL(inputPath, outputPath, options)).rejects.toThrow(
      'Polyline must have at least 2 points'
    )
  })

  it('should throw error for polygon with less than 3 points', async () => {
    const inputPath = path.join(dataDir, 'invalid_polygon.svg')
    const outputPath = path.join(dataDir, 'output.kcl')

    await expect(convertSVGtoKCL(inputPath, outputPath, options)).rejects.toThrow(
      'Polygon must have at least 3 points'
    )
  })
})
