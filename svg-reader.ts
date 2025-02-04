import { XMLParser } from 'fast-xml-parser'
import { Point, ViewBox } from './types'
import type { promises } from 'node:fs'
import { Matrix } from './transform'

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

// Simple Matrix class for transform calculations

export interface SVGPath {
  d: string
  fill?: string
  style?: string
  transform?: Matrix | null
}

export interface SVGContents {
  paths: SVGPath[]
  viewBox: ViewBox
  translate: Point
}

interface ParsedPath {
  d?: string
  fill?: string
  style?: string
  transform?: string
}

interface ParsedGroup {
  path?: ParsedPath | ParsedPath[]
  g?: ParsedGroup | ParsedGroup[]
  transform?: string
}

interface ParsedSVG {
  svg?: {
    viewBox?: string
    width?: string | number
    height?: string | number
    g?: ParsedGroup
  }
}

export class SVGReader {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ''
  })

  private static parseTransform(transformStr: string | undefined): Matrix | null {
    if (!transformStr) return null

    let matrix = new Matrix()
    const transformRegex = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([-\d\s,.e]+)\)/g
    let match

    while ((match = transformRegex.exec(transformStr)) !== null) {
      const [_, type, valuesStr] = match
      const values = valuesStr
        .trim()
        .split(/[\s,]+/)
        .map(Number)

      console.log(`Parsing transform: ${type} with values: ${values}`) // Add this line for debugging

      switch (type) {
        case 'translate':
          const tx = values[0] || 0
          const ty = values[1] || 0
          console.log(`Applying translate: tx=${tx}, ty=${ty}`) // Add this line for debugging
          matrix = matrix.translate(tx, ty)
          break

        case 'scale':
          const sx = values[0] || 1
          const sy = values.length > 1 ? values[1] : sx
          matrix = matrix.scale(sx, sy)
          break

        case 'rotate':
          const angle = values[0] || 0
          const cx = values[1] || 0
          const cy = values[2] || 0

          if (cx !== 0 || cy !== 0) {
            matrix = matrix.translate(cx, cy).rotate(angle).translate(-cx, -cy)
          } else {
            matrix = matrix.rotate(angle)
          }
          break

        case 'skewX':
          matrix = matrix.skewX(values[0] || 0)
          break

        case 'skewY':
          matrix = matrix.skewY(values[0] || 0)
          break

        case 'matrix':
          if (values.length === 6) {
            matrix = matrix.multiply(
              new Matrix(values[0], values[1], values[2], values[3], values[4], values[5])
            )
          }
          break
      }
    }

    return matrix
  }

  private static findPaths(g: ParsedGroup): SVGPath[] {
    const paths: SVGPath[] = []

    // Get group transform if it exists
    const groupTransform = this.parseTransform(g.transform)

    // Handle direct paths
    if (Array.isArray(g.path)) {
      paths.push(
        ...g.path
          .filter((p: ParsedPath): p is Required<Pick<ParsedPath, 'd'>> & ParsedPath => !!p.d)
          .map((p: ParsedPath) => {
            let finalTransform: Matrix | null = null
            const pathTransform = this.parseTransform(p.transform)

            if (groupTransform && pathTransform) {
              finalTransform = groupTransform.multiply(pathTransform)
            } else {
              finalTransform = groupTransform || pathTransform || null
            }

            return {
              d: p.d!,
              fill: undefined,
              style: p.style,
              transform: finalTransform
            }
          })
      )
    } else if (g.path?.d) {
      const pathTransform = this.parseTransform(g.path.transform)
      const finalTransform =
        groupTransform && pathTransform
          ? groupTransform.multiply(pathTransform)
          : groupTransform || pathTransform || null

      paths.push({
        d: g.path.d,
        fill: undefined,
        style: g.path.style,
        transform: finalTransform
      })
    }

    // Recursively process nested groups
    if (Array.isArray(g.g)) {
      for (const nestedGroup of g.g) {
        // For nested groups, we need to combine transforms
        if (groupTransform && nestedGroup.transform) {
          nestedGroup.transform = `${g.transform} ${nestedGroup.transform}`
        } else if (groupTransform) {
          nestedGroup.transform = g.transform
        }
        paths.push(...this.findPaths(nestedGroup))
      }
    } else if (g.g) {
      // Handle single nested group
      const nestedGroup = g.g
      if (groupTransform && nestedGroup.transform) {
        nestedGroup.transform = `${g.transform} ${nestedGroup.transform}`
      } else if (groupTransform) {
        nestedGroup.transform = g.transform
      }
      paths.push(...this.findPaths(nestedGroup))
    }

    return paths
  }

  public static parseContent(content: string): SVGContents {
    const parsed = this.xmlParser.parse(content) as ParsedSVG

    if (!parsed.svg) {
      throw new SVGReadError('No SVG element found in file contents.')
    }

    const paths = parsed.svg.g ? this.findPaths(parsed.svg.g) : []

    return {
      paths,
      viewBox: { width: 0, height: 0 },
      translate: { x: 0, y: 0 }
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
