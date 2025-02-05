import { XMLParser } from 'fast-xml-parser'
import { ViewBox, FillRule } from './types'
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
  fillRule?: FillRule
  transform?: Matrix | null
}

export interface SVGContents {
  paths: SVGPath[]
  viewBox: ViewBox
  defaultFillRule?: FillRule
}

interface ParsedPath {
  d?: string
  fillRule?: FillRule
  transform?: string
}

interface ParsedGroup {
  path?: ParsedPath | ParsedPath[]
  g?: ParsedGroup | ParsedGroup[]
  transform?: string
  fillRule?: FillRule
}

interface ParsedSVG {
  svg?: {
    viewBox?: string
    width?: string | number
    height?: string | number
    g?: ParsedGroup
    style?: string
  }
}

export class SVGReader {
  private static xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ''
  })

  private static parseViewBox(viewBoxStr: string | undefined): ViewBox {
    const defaultViewBox = { xMin: 0, yMin: 0, width: 0, height: 0 }
    if (!viewBoxStr) return defaultViewBox

    const values = viewBoxStr.split(/\s+/).map(Number)
    if (values.length !== 4 || values.some(isNaN)) {
      return defaultViewBox
    }

    const [xMin, yMin, width, height] = values
    return { xMin, yMin, width, height }
  }

  private static extractFillRule(cssContent: string): FillRule {
    const fillRuleMatch = /\bpath\s*{[^}]*fill-rule\s*:\s*([^;\s}]+)[^}]*}/i.exec(cssContent)
    const extractedValue = fillRuleMatch?.[1]?.toLowerCase()

    // Validate the extracted value matches our enum.
    if (extractedValue === FillRule.NonZero || extractedValue === FillRule.EvenOdd) {
      return extractedValue
    }

    // Default to evenodd if no valid fill-rule is found.
    return FillRule.EvenOdd
  }

  private static parseTransform(transformStr: string | undefined): Matrix | null {
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

  private static findPaths(
    g: ParsedGroup | ParsedGroup[],
    inheritedFillRule?: FillRule,
    inheritedTransform: Matrix | null = null
  ): SVGPath[] {
    const groups = Array.isArray(g) ? g : [g]
    return groups.flatMap((group) =>
      this.processGroup(group, inheritedFillRule, inheritedTransform)
    )
  }

  private static processPath(
    p: ParsedPath,
    groupTransform: Matrix | null,
    fillRule?: FillRule
  ): SVGPath | null {
    if (!p.d) return null

    const pathTransform = this.parseTransform(p.transform)
    const finalTransform = groupTransform
      ? pathTransform
        ? groupTransform.multiply(pathTransform)
        : groupTransform
      : pathTransform || null

    return {
      d: p.d,
      fillRule: p.fillRule || fillRule,
      transform: finalTransform
    }
  }

  private static combineTransforms(parent: Matrix | null, child: Matrix | null): Matrix | null {
    if (parent && child) return parent.multiply(child)
    return parent || child || null
  }

  private static processGroup(
    group: ParsedGroup,
    inheritedFillRule?: FillRule,
    inheritedTransform: Matrix | null = null
  ): SVGPath[] {
    const paths: SVGPath[] = []
    const groupFillRule = group.fillRule || inheritedFillRule

    // Compute this group's transform combined with inherited transform.
    const groupTransform = this.parseTransform(group.transform)
    const combinedTransform = this.combineTransforms(inheritedTransform, groupTransform)

    // Process paths in this group.
    if (group.path) {
      const pathArray = Array.isArray(group.path) ? group.path : [group.path]
      for (const path of pathArray) {
        const processedPath = this.processPath(path, combinedTransform, groupFillRule)
        if (processedPath) paths.push(processedPath)
      }
    }

    // Process nested groups
    if (group.g) {
      const nestedGroups = Array.isArray(group.g) ? group.g : [group.g]
      for (const nestedGroup of nestedGroups) {
        paths.push(...this.processGroup(nestedGroup, groupFillRule, combinedTransform))
      }
    }

    return paths
  }

  public static parseContent(content: string): SVGContents {
    const parsed = this.xmlParser.parse(content) as ParsedSVG

    if (!parsed.svg) {
      throw new SVGReadError('No SVG element found in file contents.')
    }

    const viewBox = this.parseViewBox(parsed.svg.viewBox)
    const defaultFillRule = parsed.svg.style
      ? this.extractFillRule(parsed.svg.style)
      : FillRule.EvenOdd
    const paths = parsed.svg.g ? this.findPaths(parsed.svg.g, defaultFillRule) : []

    return {
      paths,
      viewBox,
      defaultFillRule
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
