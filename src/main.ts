import { promises as fs } from 'node:fs'
import { SvgReader } from './reader/base'
import { KclOptions } from './types/kcl'
import { KclWriter } from './writer/base'
import { Converter } from './writer/converter'

export async function convertSvgToKcl(
  input: File | string,
  outputPath: string,
  options: KclOptions = {}
): Promise<string> {
  // Read SVG content.
  const content = typeof input === 'string' ? await fs.readFile(input, 'utf8') : await input.text()

  // Parse.
  const svgReader = new SvgReader()
  const svg = svgReader.readString(content)

  // Convert.
  const converter = new Converter(options, svg.viewBox)
  const convertedElements = converter.convertElements(svg.elements)

  // Write.
  const writer = new KclWriter()
  const result = await writer.formatAndWrite(convertedElements, outputPath)

  return result
}

async function main() {
  const inputFile = './tests/data/project_payload.svg'
  const outputFile = './output.kcl'

  const options: KclOptions = {
    centerOnViewBox: true // Center the output on the Svg viewBox.
  }

  try {
    await convertSvgToKcl(inputFile, outputFile, options)
    console.log(`Successfully converted ${inputFile} to ${outputFile}`)
  } catch (error) {
    console.error('Conversion failed:', error instanceof Error ? error.message : error)
  }
}

// main()
