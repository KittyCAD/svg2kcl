import { promises as fs } from 'node:fs'
import { SVGReader } from './reader/base'
import { KCLOptions } from './types/kcl'
import { KCLWriter } from './writer/base'

export async function convertSVGtoKCL(
  input: File | string,
  outputPath: string | null,
  options: KCLOptions = {}
): Promise<string> {
  // Read SVG content.
  const content = typeof input === 'string' ? await fs.readFile(input, 'utf8') : await input.text()

  // Parse and convert.
  const svgReader = new SVGReader()
  const svg = svgReader.readString(content)

  const writer = new KCLWriter(svg, options)
  const result = writer.write()

  // Write to file if outputPath provided.
  if (outputPath) {
    await fs.writeFile(outputPath, result, 'utf8')
  }

  return result
}

async function main() {
  const inputFile = './tests/data/project_payload.svg'
  const outputFile = './output.kcl'

  const options: KCLOptions = {
    centerOnViewBox: true // Center the output on the SVG viewBox.
  }

  try {
    await convertSVGtoKCL(inputFile, outputFile, options)
    console.log(`Successfully converted ${inputFile} to ${outputFile}`)
  } catch (error) {
    console.error('Conversion failed:', error instanceof Error ? error.message : error)
  }
}

// main()
