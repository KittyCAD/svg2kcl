import { promises as fs } from 'node:fs'
import { SvgReader } from './reader/base'
import { KclOptions } from './types/kcl'
import { KclWriter } from './writer/base'

export async function convertSvgToKcl(
  input: File | string,
  outputPath: string | null,
  options: KclOptions = {}
): Promise<string> {
  // Read SVG content.
  const content = typeof input === 'string' ? await fs.readFile(input, 'utf8') : await input.text()

  // Parse and convert.
  const svgReader = new SvgReader()
  const svg = svgReader.readString(content)

  const writer = new KclWriter(svg, options)
  const result = writer.write()

  // Write to file if outputPath provided.
  if (outputPath) {
    await fs.writeFile(outputPath, result, 'utf8')
  }

  return result
}

async function main() {
  const inputFile = process.argv[2]
  const outputFile = './output.kcl'

  const options: KclOptions = {
    centerOnViewBox: true // Center the output on the Svg viewBox.
  }

  try {
    await convertSvgToKcl(inputFile, outputFile, options)
    console.log(`Successfully converted ${inputFile} to ${outputFile}`)
  } catch (error) {
    console.error('Conversion failed:', error)
  }
}

main()
