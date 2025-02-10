import { promises as fs } from 'node:fs'
import { SVGReader } from './reader/base'
import { KCLWriter } from './writer/base'
import { KCLOptions } from './types/kcl'

async function convertSVGtoKCL(
  inputPath: string,
  outputPath: string,
  options: KCLOptions = {}
): Promise<void> {
  // Read and parse SVG.
  const svgReader = new SVGReader()
  const svg = await svgReader.readFile(inputPath)

  // Convert to KCL.
  const writer = new KCLWriter(svg, options)
  const kclContent = writer.write()

  // Write output file.
  await fs.writeFile(outputPath, kclContent, 'utf8')
}

async function main() {
  const inputFile = './tests/data/nested_group_transform.svg'
  const outputFile = './output.kcl'

  const options: KCLOptions = {
    centerOnViewBox: true // Center the output on the SVG viewBox
  }

  try {
    await convertSVGtoKCL(inputFile, outputFile, options)
    console.log(`Successfully converted ${inputFile} to ${outputFile}`)
  } catch (error) {
    console.error('Conversion failed:', error instanceof Error ? error.message : error)
  }
}

main()
