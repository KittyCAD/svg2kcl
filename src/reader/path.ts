import { RawSVGElement } from '../types/svg'
import { GeometricElementType, Path, FillRule } from '../types/geometric'
import { SVGPathParser } from '../parsers/path'
import { parseTransform } from '../parsers/transform'

export class PathReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathReadError'
  }
}

export interface RawPathData {
  d: string
  fillRule?: FillRule
  transform?: string
}

export class PathReader {
  private pathParser: SVGPathParser

  constructor() {
    this.pathParser = new SVGPathParser()
  }

  public readAttributes(element: RawSVGElement): RawPathData {
    if (element.type !== GeometricElementType.Path) {
      throw new PathReadError('Element is not a path')
    }

    const d = element.attributes['d']
    if (!d) {
      throw new PathReadError('Path element missing "d" attribute')
    }

    let fillRule: FillRule | undefined
    const fillRuleAttr = element.attributes['fill-rule']
    if (fillRuleAttr) {
      if (fillRuleAttr === FillRule.NonZero || fillRuleAttr === FillRule.EvenOdd) {
        fillRule = fillRuleAttr
      } else {
        throw new PathReadError(`Invalid fill-rule: ${fillRuleAttr}`)
      }
    }
    const transform = element.attributes['transform']

    return {
      d,
      fillRule,
      transform
    }
  }

  public readStyleAttributes(element: RawSVGElement): Partial<RawPathData> {
    const style = element.attributes['style']
    if (!style) {
      return {}
    }

    const result: Partial<RawPathData> = {}

    const styles = style.split(';').reduce((acc, style) => {
      const [key, value] = style.split(':').map((s) => s.trim())
      if (key && value) {
        acc[key] = value
      }
      return acc
    }, {} as Record<string, string>)

    if (styles['fill-rule']) {
      const fillRule = styles['fill-rule']
      if (fillRule === FillRule.NonZero || fillRule === FillRule.EvenOdd) {
        result.fillRule = fillRule
      } else {
        throw new PathReadError(`Invalid fill-rule in style: ${fillRule}`)
      }
    }

    return result
  }

  public read(element: RawSVGElement): Path {
    const rawData = this.readAttributes(element)
    const styleData = this.readStyleAttributes(element)
    const mergedData = {
      ...rawData,
      ...styleData
    }

    // Parse the transform if present.
    const transformResult = parseTransform(mergedData.transform)
    const transform = transformResult ? transformResult.matrix : null

    // Parse the path data using our parser.
    const parsedPath = this.pathParser.parsePath(mergedData.d, transform, mergedData.fillRule)

    return {
      type: GeometricElementType.Path,
      commands: parsedPath.commands,
      fillRule: parsedPath.fillRule,
      transform: transform ? { matrix: transform } : undefined
    }
  }
}
