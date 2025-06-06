import { SvgPathParser } from '../parsers/path'
import { FillRule } from '../types/base'
import { ElementType, PathElement } from '../types/elements'
import { RawSvgElement } from '../types/svg'
import { Transform } from '../utils/transform'

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
  private pathParser: SvgPathParser

  constructor() {
    this.pathParser = new SvgPathParser()
  }

  public readAttributes(element: RawSvgElement): RawPathData {
    if (element.type !== ElementType.Path) {
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

  public readStyleAttributes(element: RawSvgElement): Partial<RawPathData> {
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

  public read(element: RawSvgElement): PathElement {
    const rawData = this.readAttributes(element)
    const styleData = this.readStyleAttributes(element)
    const mergedData = {
      ...rawData,
      ...styleData
    }

    // Parse the transform if present.
    const transform = mergedData.transform
      ? Transform.fromString(mergedData.transform)
      : new Transform()

    // Parse the path data using our parser.
    const parsedPath = this.pathParser.parsePath(mergedData.d, transform, mergedData.fillRule)

    return {
      type: ElementType.Path,
      commands: parsedPath.commands,
      fillRule: parsedPath.fillRule,
      transform: transform
    }
  }
}
