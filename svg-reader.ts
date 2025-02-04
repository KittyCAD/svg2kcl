import { XMLParser } from 'fast-xml-parser'
import { Point, ViewBox } from './types'
import type { promises } from 'node:fs'
import { Matrix, TransformType } from './transform'

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
    // Reads an SVG transform string and returns a matrix object that describes
    // the transformation.

    // Early out.
    if (!transformStr) return null

    let matrix = new Matrix()
    const regex = /(translate|scale|rotate|matrix|skewX|skewY)\s*\(([-\d\s,.e]+)\)/g
    let match

    while ((match = regex.exec(transformStr)) !== null) {
      const [, type, valuesStr] = match
      const values = valuesStr.split(/[\s,]+/).map(Number)

      switch (type as TransformType) {
        case TransformType.Translate: {
          const [tx = 0, ty = 0] = values
          matrix = matrix.translate(tx, ty)
          break
        }
        case TransformType.Scale: {
          const [sx = 1, sy = sx] = values
          matrix = matrix.scale(sx, sy)
          break
        }
        case TransformType.Rotate: {
          const [angle = 0, cx = 0, cy = 0] = values
          matrix =
            cx || cy
              ? matrix.translate(cx, cy).rotate(angle).translate(-cx, -cy)
              : matrix.rotate(angle)
          break
        }
        case TransformType.SkewX: {
          matrix = matrix.skewX(values[0] || 0)
          break
        }
        case TransformType.SkewY: {
          matrix = matrix.skewY(values[0] || 0)
          break
        }
        case TransformType.Matrix:
          if (values.length === 6) {
            matrix = matrix.multiply(new Matrix(...values))
          }
          break
      }
    }

    return matrix
  }

  private static combineTransforms(parent: Matrix | null, child: Matrix | null): Matrix | null {
    if (parent && child) return parent.multiply(child)
    return parent || child || null
  }

  private static processPath(p: ParsedPath, groupTransform: Matrix | null): SVGPath | null {
    if (!p.d) return null

    const pathTransform = this.parseTransform(p.transform)
    const finalTransform = groupTransform
      ? pathTransform
        ? groupTransform.multiply(pathTransform)
        : groupTransform
      : pathTransform || null

    return {
      d: p.d,
      fill: p.fill,
      style: p.style,
      transform: finalTransform
    }
  }

  private static findPaths(g: ParsedGroup, inheritedTransform: Matrix | null = null): SVGPath[] {
    const paths: SVGPath[] = []

    // Compute the group's transform.
    const groupTransform = this.parseTransform(g.transform)
    const combinedTransform = this.combineTransforms(inheritedTransform, groupTransform)

    // Process paths in this group.
    if (g.path) {
      const pathArray = Array.isArray(g.path) ? g.path : [g.path]
      for (const path of pathArray) {
        const processedPath = this.processPath(path, combinedTransform)
        if (processedPath) paths.push(processedPath)
      }
    }

    // Process nested groups.
    if (g.g) {
      const nestedGroups = Array.isArray(g.g) ? g.g : [g.g]
      for (const nestedGroup of nestedGroups) {
        paths.push(...this.findPaths(nestedGroup, combinedTransform))
      }
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
