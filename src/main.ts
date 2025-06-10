import { promises as fs } from 'node:fs'
import { SvgReader } from './reader/base'
import { KclOptions } from './types/kcl'
import { KclWriter } from './writer/base'
import { Converter } from './converter/converter'

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
  // Get command line arguments.
  const args = process.argv.slice(2)

  if (args.length < 1) {
    console.log('Usage: ts-node main.ts <inputFile> [outputFile] [--center]')
    console.log('Example: ts-node main.ts ./input.svg ./output.kcl --center')
    process.exit(1)
  }

  // Separate flags from file arguments.
  const flags = args.filter((arg) => arg.startsWith('--'))
  const fileArgs = args.filter((arg) => !arg.startsWith('--'))

  const inputFile = fileArgs[0]
  // Default output file is input filename with .kcl extension.
  const outputFile = fileArgs[1] || inputFile.replace(/\.[^/.]+$/, '') + '.kcl'

  const options: KclOptions = {
    centerOnViewBox: flags.includes('--center')
  }

  try {
    await convertSvgToKcl(inputFile, outputFile, options)
    console.log(`Successfully converted ${inputFile} to ${outputFile}`)
  } catch (error) {
    console.error('Conversion failed:', error instanceof Error ? error.message : error)
  }
}

// Run the main function if this file is executed directly.
const isMainModule = import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main()
}

// if (require.main === module) {
//   // This code only runs when the file is executed directly.
//   main()
// }
