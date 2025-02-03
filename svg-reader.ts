import { JSDOM } from 'jsdom'
import { Point, ViewBox } from './types'
import type { PathLike } from 'node:fs'
import type { promises } from 'node:fs'

export class SVGReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SVGReadError'
  }
}

export interface SVGElement {
  paths: Array<{
    d: string
    fill?: string
    transform?: DOMMatrix | null
  }>
  viewBox: ViewBox
  translate: Point
}

export class SVGReader {
  /**
   * Parse SVG content from a string
   * @param content SVG file content as string
   * @returns Parsed SVG element data
   * @throws SVGReadError if parsing fails
   */
  public static parseContent(content: string): SVGElement {
    try {
      const dom = new JSDOM(content)
      const svg = dom.window.document.querySelector('svg')

      if (!svg) {
        throw new SVGReadError('No SVG element found in content')
      }

      // Initialize base translation
      const translate: Point = { x: 0, y: 0 }

      // Get viewBox dimensions
      const width = svg.width?.baseVal.valueInSpecifiedUnits ?? 0
      const height = svg.height?.baseVal.valueInSpecifiedUnits ?? 0
      const viewBox: ViewBox = { width, height }

      // Extract paths and their attributes
      const paths: Array<{ d: string; fill?: string; transform?: DOMMatrix | null }> = []

      function traverseElements(element: Element) {
        for (const child of Array.from(element.children)) {
          if (child.tagName === 'g') {
            // Handle group transforms
            const svgChild = child as SVGGraphicsElement
            if (svgChild.transform?.baseVal.length > 0) {
              translate.x += svgChild.transform.baseVal[0].matrix.e ?? 0
              translate.y += svgChild.transform.baseVal[0].matrix.f ?? 0
            }
            traverseElements(child)
          } else if (child.tagName === 'path') {
            const svgPath = child as SVGPathElement
            const pathData = svgPath.getAttribute('d')
            if (pathData) {
              paths.push({
                d: pathData,
                fill: svgPath.getAttribute('fill') ?? undefined,
                transform: svgPath.transform?.baseVal[0]?.matrix ?? null
              })
            }
          }
        }
      }

      traverseElements(svg)

      return {
        paths,
        viewBox,
        translate
      }
    } catch (error) {
      if (error instanceof SVGReadError) {
        throw error
      }
      throw new SVGReadError(`Failed to parse SVG content: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Read and parse an SVG file using the provided file system API
   * @param fs File system API that provides readFile
   * @param filepath Path to the SVG file
   * @returns Parsed SVG element data
   * @throws SVGReadError if reading or parsing fails
   */
  public static async readFile(fs: typeof promises, filepath: string): Promise<SVGElement> {
    try {
      const content = await fs.readFile(filepath, { encoding: 'utf8' })
      if (typeof content !== 'string') {
        throw new SVGReadError('File content must be string')
      }
      return this.parseContent(content)
    } catch (error) {
      throw new SVGReadError(
        `Failed to read SVG file ${filepath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}
