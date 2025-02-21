import { describe, expect, it } from '@jest/globals'
import { promises as fsPromises } from 'node:fs'
import path from 'path'
import { convertSvgToKcl } from '../src/main'
import { KclOptions } from '../src/types/kcl'

const options: KclOptions = {
  centerOnViewBox: false
}

const dataDir = path.join(__dirname, 'data', 'fillrule')

describe('SVG Fill Rule Tests NonZero', () => {
  it('should correctly convert nonzero_basic.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'nonzero_basic.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'nonzero_basic.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    //   // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert nonzero_complex.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'nonzero_complex.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'nonzero_complex.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKcl.trim())
  })

  it('should handle overlapping subpaths with nonzero winding', async () => {
    const inputPath = path.join(dataDir, 'simple_path_overlap_nonzero.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'simple_path_overlap_nonzero.kcl')

    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert self_intersecting.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'self_intersecting.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'self_intersecting.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKcl.trim())
  })

  it('should correctly convert bowtie.svg to KCL', async () => {
    const inputPath = path.join(dataDir, 'bowtie.svg')
    const outputPath = path.join(dataDir, 'output.kcl')
    const expectedKclPath = path.join(dataDir, 'bowtie.kcl')

    // Run the conversion.
    await convertSvgToKcl(inputPath, outputPath, options)
    const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
    const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

    // Compare output with expected result.
    expect(actualKCL.trim()).toBe(expectedKcl.trim())
  })

  // it('should correctly convert winding_order.svg to KCL', async () => {
  //   // https://oreillymedia.github.io/Using_SVG/extras/ch06-fill-rule.html
  //   const inputPath = path.join(dataDir, 'winding_order.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKclPath = path.join(dataDir, 'winding_order.kcl')

  //   // Run the conversion.
  //   await convertSvgToKcl(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKcl.trim())
  // })

  // it('should correctly convert winding_order_evenodd.svg to KCL', async () => {
  //   // https://oreillymedia.github.io/Using_SVG/extras/ch06-fill-rule.html
  //   const inputPath = path.join(dataDir, 'winding_order_evenodd.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKclPath = path.join(dataDir, 'winding_order_evenodd.kcl')

  //   // Run the conversion.
  //   await convertSvgToKcl(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKcl.trim())
  // })

  // it('should correctly convert basic_path.svg to KCL', async () => {
  //   const inputPath = path.join(dataDir, 'basic_path.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKclPath = path.join(dataDir, 'basic_path.kcl')

  //   // Run the conversion.
  //   await convertSvgToKcl(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKcl.trim())
  // })

  // it('should correctly convert compound_path_nonzero.svg to KCL', async () => {
  //   const inputPath = path.join(dataDir, 'compound_path_nonzero.svg')
  //   const outputPath = path.join(dataDir, 'output.kcl')
  //   const expectedKclPath = path.join(dataDir, 'compound_path_nonzero.kcl')

  //   // Run the conversion.
  //   await convertSvgToKcl(inputPath, outputPath, options)
  //   const actualKCL = await fsPromises.readFile(outputPath, 'utf8')
  //   const expectedKcl = await fsPromises.readFile(expectedKclPath, 'utf8')

  //   // Compare output with expected result.
  //   expect(actualKCL.trim()).toBe(expectedKcl.trim())
  // })
})
