import { describe, expect, it } from '@jest/globals'
import { promises as fsPromises } from 'node:fs'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import { convertSvgToKcl } from '../src/main'
import { KclOptions } from '../src/types/kcl'

// const __filename = fileURLToPath(import.meta.url)
// const __dirname = dirname(__filename)

const options: KclOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'elements')

describe('SVG Basic Elements to KCL Conversion', () => {
  it('should correctly convert basic_rectangle.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_rectangle.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'basic_rectangle.kcl')

    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert basic_circle.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_circle.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'basic_circle.kcl')

    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert basic_line.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_line.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'basic_line.kcl')

    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert basic_polyline.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_polyline.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'basic_polyline.kcl')

    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert basic_polygon.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'basic_polygon.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'basic_polygon.kcl')

    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    expect(actualKcl.trim()).toBe(expectedKcl.trim())
  })

  describe('Svg Group Elements to KCL Conversion', () => {
    it('should correctly convert basic_group.svg to KCL', async () => {
      const inputPath = path.join(dataDir, 'basic_group.svg')
      const outputPath = path.join(dataDir, 'output.kcl')
      const expectedKclPath = path.join(dataDir, 'basic_group.kcl')

      await convertSvgToKcl(inputPath, outputPath, options)
      const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
      const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

      expect(actualKcl.trim()).toBe(expectedKcl.trim())
    })

    it('should correctly convert nested_group.svg to KCL', async () => {
      const inputPath = path.join(dataDir, 'nested_group.svg')
      const outputPath = path.join(dataDir, 'output.kcl')
      const expectedKclPath = path.join(dataDir, 'nested_group.kcl')

      await convertSvgToKcl(inputPath, outputPath, options)
      const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
      const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

      expect(actualKcl.trim()).toBe(expectedKcl.trim())
    })
  })

  describe('Svg Complex Cases to KCL Conversion', () => {
    it('should correctly convert mixed_elements.svg to KCL', async () => {
      const inputPath = path.join(dataDir, 'mixed_elements.svg')
      const outputPath = path.join(dataDir, 'output.kcl')
      const expectedKclPath = path.join(dataDir, 'mixed_elements.kcl')

      await convertSvgToKcl(inputPath, outputPath, options)
      const actualKcl = await fsPromises.readFile(outputPath, 'utf8')
      const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

      expect(actualKcl.trim()).toBe(expectedKcl.trim())
    })

    it('should throw error for polyline with less than 2 points', async () => {
      const inputPath = path.join(dataDir, 'invalid_polyline.svg')
      const outputPath = path.join(dataDir, 'output.kcl')

      await expect(convertSvgToKcl(inputPath, outputPath, options)).rejects.toThrow(
        'Polyline must have at least 2 points'
      )
    })

    it('should throw error for polygon with less than 3 points', async () => {
      const inputPath = path.join(dataDir, 'invalid_polygon.svg')
      const outputPath = path.join(dataDir, 'output.kcl')

      await expect(convertSvgToKcl(inputPath, outputPath, options)).rejects.toThrow(
        'Polygon must have at least 3 points'
      )
    })
  })
})
