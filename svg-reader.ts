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

export interface Transform {
  type: 'translate' | 'scale' | 'rotate' | 'matrix' | 'skewX' | 'skewY'
  values: number[]
}

export interface SVGPath {
  d: string
  fill?: string
  style?: string
  transform?: Transform[]
}

export interface SVGContents {
  paths: SVGPath[]
  viewBox: ViewBox
  translate: Point
}

export class SVGReader {
  private static parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ''
  })

  private static parseTransform(transformStr?: string): Transform[] {
    // Handle empty transform string.
    if (!transformStr) return []

    // Grab transforms and their params.
    const transformRegex = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([-\d\s,.e]+)\)/g

    // Build array of transform objects.
    const transforms: Transform[] = []
    let match

    while ((match = transformRegex.exec(transformStr)) !== null) {
      const [_, type, valuesStr] = match
      const values = valuesStr
        .trim()
        .split(/[\s,]+/)
        .map(Number)

      // Validate and normalize transform values.
      switch (type) {
        case 'translate':
          // Translate(tx [ty]) - if ty is not provided, it is assumed to be 0.
          if (values.length === 1) values.push(0)
          break
        case 'scale':
          // Scale(sx [sy]) - if sy is not provided, it is assumed to be equal to sx.
          if (values.length === 1) values.push(values[0])
          break
        case 'rotate':
          // Rotate(angle [cx cy]) - if cx,cy are not provided, assume rotation around origin.
          if (values.length === 1) values.push(0, 0)
          break
        case 'skewX':
        case 'skewY':
          // SkewX/Y(angle) - single angle value.
          break
        case 'matrix':
          // Matrix(a b c d e f) - must have exactly 6 values.
          if (values.length !== 6) continue
          break
      }

      transforms.push({ type: type as Transform['type'], values })
    }

    return transforms
  }

  private static parseViewBox(svg: any): { viewBox: ViewBox; translate: Point } {
    if (svg.viewBox) {
      const [x, y, width, height] = svg.viewBox.split(/[\s,]+/).map(Number)
      return {
        viewBox: { width, height },
        translate: { x, y }
      }
    }

    const width = parseFloat(svg.width) || DEFAULT_WIDTH
    const height = parseFloat(svg.height) || DEFAULT_HEIGHT
    return {
      viewBox: { width, height },
      translate: { x: 0, y: 0 }
    }
  }

  private static findPaths(g: any, parentTransforms: Transform[] = []): SVGPath[] {
    const paths: SVGPath[] = []

    // Handle group transforms.
    const groupTransforms = this.parseTransform(g.transform)
    const currentTransforms = [...parentTransforms, ...(groupTransforms || [])]

    // Actually pull paths.
    if (Array.isArray(g.path)) {
      for (const path of g.path) {
        if (path.d) {
          const pathTransforms = this.parseTransform(path.transform)
          paths.push({
            d: path.d,
            fill: path.fill || g.fill,
            style: path.style,
            transform: [...currentTransforms, ...(pathTransforms || [])]
          })
        }
      }
    }

    // Recursively process nested groups.
    if (Array.isArray(g.g)) {
      for (const nestedGroup of g.g) {
        paths.push(...this.findPaths(nestedGroup, currentTransforms))
      }
    } else if (g.g) {
      // Handle single nested group.
      paths.push(...this.findPaths(g.g, currentTransforms))
    }

    return paths
  }

  public static parseContent(content: string): SVGContents {
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

  public static async readFile(fs: typeof promises, filepath: string): Promise<SVGContents> {
    try {
      const content = await fs.readFile(filepath, { encoding: 'utf8' })
      return this.parseContent(content)
    } catch (error) {
      throw new SVGReadError(SVGReadError.buildErrorMessage(filepath, error))
    }
  }
}
