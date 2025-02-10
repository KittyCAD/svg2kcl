import { promises as fsPromises } from 'node:fs'
import { SVGReader } from './svg-reader'
import { SVGParser } from './svg-parser'
import { KCLWriter } from './kcl-writer'

export async function convertSVGtoKCL(
  inputPath: string,
  outputPath: string,
  centerOnViewBox: boolean = false
): Promise<void> {
  // Read the SVG file to our SVGContents format.
  const svgContents = await SVGReader.readFile(fsPromises, inputPath)

  // Parse SVG paths.
  const parser = new SVGParser()
  const parsedPaths = parser.parse(svgContents)

  // Generate KCL output.
  const writer = new KCLWriter(svgContents.viewBox, {
    centerOnViewBox: centerOnViewBox
  })

  // Process each path.
  parsedPaths.forEach((path) => writer.processPath(path))

  // Get final KCL content.
  const kclContent = writer.generateOutput()

  // Write to output file.
  await fsPromises.writeFile(outputPath, kclContent, 'utf8')

  console.log(`Successfully converted ${inputPath} to ${outputPath}`)
}

// Usage with hardcoded paths
const inputFile = './tests/data/project_payload.svg'
const outputFile = './output.kcl'

convertSVGtoKCL(inputFile, outputFile, true)
