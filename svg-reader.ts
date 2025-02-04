import { XMLParser } from 'fast-xml-parser'
import { Point, ViewBox } from './types'
import type { promises } from 'node:fs'

const DEFAULT_HEIGHT = 1000
const DEFAULT_WIDTH = 1000

export class SVGReadError extends Error {
  constructor(message: string = 'An error occurred while reading the SVG.') {
    super(message)
    this.name = 'SVGReadError'
  }

  public static buildErrorMessage(filepath: string, error: unknown): string {
    return `Failed to read SVG ${filepath}: ${
      error instanceof Error ? error.message : 'Unknown error'
    }`
  }
}

export interface SVGElement {
  paths: Array<{
    d: string
    fill?: string
    style?: string
  }>
  viewBox: ViewBox
  translate: Point
}

export class SVGReader {
  private static parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ''
  })

  private static parseViewBox(svg: any): { viewBox: ViewBox; translate: Point } {
    // Pull the viewBox from the SVG element.
    if (svg.viewBox) {
      const [x, y, width, height] = svg.viewBox.split(/[\s,]+/).map(Number)
      return {
        viewBox: { width, height },
        translate: { x, y }
      }
    }

    // Fallback to width/height.
    const width = parseFloat(svg.width) || DEFAULT_WIDTH
    const height = parseFloat(svg.height) || DEFAULT_HEIGHT
    return {
      viewBox: { width, height },
      translate: { x: 0, y: 0 }
    }
  }

  private static findPaths(g: any): Array<{ d: string; fill?: string; style?: string }> {
    const paths: Array<{ d: string; fill?: string; style?: string }> = []

    if (Array.isArray(g.path)) {
      for (const path of g.path) {
        // The `d` attribute defines a path to be drawn:
        // https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d
        if (path.d) {
          paths.push({
            d: path.d,
            fill: path.fill || g.fill,
            style: path.style
          })
        }
      }
    }

    return paths
  }

  public static parseContent(content: string): SVGElement {
    const parsed = this.parser.parse(content)

    if (!parsed.svg) {
      throw new SVGReadError('No SVG element found in file contents.')
    }

    const { viewBox, translate } = this.parseViewBox(parsed.svg)
    const paths = this.findPaths(parsed.svg.g)

    return {
      paths,
      viewBox,
      translate
    }
  }

  public static async readFile(fs: typeof promises, filepath: string): Promise<SVGElement> {
    try {
      const content = await fs.readFile(filepath, { encoding: 'utf8' })
      return this.parseContent(content)
    } catch (error) {
      throw new SVGReadError(SVGReadError.buildErrorMessage(filepath, error))
    }
  }
}
