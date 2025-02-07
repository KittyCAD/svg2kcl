import {
  KCLOperation,
  KCLOperationType,
  KCLOutput,
  KCLShape,
  StartSketchParams,
  LineToParams,
  BezierCurveParams,
  CircleParams,
  HoleParams
} from '../types/kcl'

export class FormatterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatterError'
  }
}

const INVERT_Y = true

export class Formatter {
  private formatPoint(point: [number, number]): string {
    if (INVERT_Y) {
      return `[${point[0]}, -${point[1]}]`
    }
    return `[${point[0]}, ${point[1]}]`
  }

  private isStartSketchParams(params: any): params is StartSketchParams {
    return params && 'point' in params
  }

  private isLineToParams(params: any): params is LineToParams {
    return params && 'point' in params
  }

  private isBezierCurveParams(params: any): params is BezierCurveParams {
    return params && 'control1' in params && 'control2' in params && 'to' in params
  }

  private isCircleParams(params: any): params is CircleParams {
    return params && 'radius' in params
  }

  private isHoleParams(params: any): params is HoleParams {
    return params && 'operations' in params && Array.isArray(params.operations)
  }

  private formatOperation(operation: KCLOperation): string {
    if (!operation.params && operation.type !== KCLOperationType.Close) {
      throw new FormatterError(`Missing parameters for operation type: ${operation.type}`)
    }

    switch (operation.type) {
      case KCLOperationType.StartSketch: {
        if (!this.isStartSketchParams(operation.params)) {
          throw new FormatterError('Invalid StartSketch parameters')
        }
        return `startSketchAt(${this.formatPoint(operation.params.point)})`
      }

      case KCLOperationType.LineTo: {
        if (!this.isLineToParams(operation.params)) {
          throw new FormatterError('Invalid LineTo parameters')
        }
        return `|> lineTo(${this.formatPoint(operation.params.point)}, %)`
      }

      case KCLOperationType.BezierCurve: {
        if (!this.isBezierCurveParams(operation.params)) {
          throw new FormatterError('Invalid BezierCurve parameters')
        }
        return `|> bezierCurve({
      control1 = ${this.formatPoint(operation.params.control1)},
      control2 = ${this.formatPoint(operation.params.control2)},
      to = ${this.formatPoint(operation.params.to)}
    }, %)`
      }

      case KCLOperationType.Circle: {
        if (!this.isCircleParams(operation.params)) {
          throw new FormatterError('Invalid Circle parameters')
        }
        return `|> circle({ radius = ${operation.params.radius} }, %)`
      }

      case KCLOperationType.Close:
        return '|> close(%)'

      case KCLOperationType.Hole: {
        if (!this.isHoleParams(operation.params)) {
          throw new FormatterError('Invalid Hole parameters')
        }
        const holeOps = operation.params.operations
          .map((op) => this.formatOperation(op))
          .join('\n    ')
        return `|> hole(
      ${holeOps}
      , %)`
      }

      case KCLOperationType.Arc: {
        if (
          !operation.params ||
          !('radius' in operation.params) ||
          !('angle' in operation.params)
        ) {
          throw new FormatterError('Invalid Arc parameters')
        }
        return `|> arc({ radius = ${operation.params.radius}, angle = ${operation.params.angle} }, %)`
      }

      case KCLOperationType.XLineTo: {
        if (!operation.params || !('x' in operation.params)) {
          throw new FormatterError('Invalid XLineTo parameters')
        }
        return `|> xLineTo({ x = ${operation.params.x} }, %)`
      }

      case KCLOperationType.YLineTo: {
        if (!operation.params || !('y' in operation.params)) {
          throw new FormatterError('Invalid YLineTo parameters')
        }
        return `|> yLineTo({ y = ${operation.params.y} }, %)`
      }

      case KCLOperationType.Line: {
        if (!operation.params || !('dx' in operation.params) || !('dy' in operation.params)) {
          throw new FormatterError('Invalid Line parameters')
        }
        return `|> line({ dx = ${operation.params.dx}, dy = ${operation.params.dy} }, %)`
      }

      case KCLOperationType.TangentialArc: {
        if (!operation.params || !('radius' in operation.params)) {
          throw new FormatterError('Invalid TangentialArc parameters')
        }
        return `|> tangentialArc({ radius = ${operation.params.radius} }, %)`
      }

      case KCLOperationType.Polygon: {
        if (
          !operation.params ||
          !('sides' in operation.params) ||
          !('radius' in operation.params)
        ) {
          throw new FormatterError('Invalid Polygon parameters')
        }
        return `|> polygon({ sides = ${operation.params.sides}, radius = ${operation.params.radius} }, %)`
      }

      default:
        throw new FormatterError(`Unsupported operation type: ${operation.type}`)
    }
  }

  private formatShape(shape: KCLShape): string {
    const operations = shape.operations.map((op) => this.formatOperation(op))

    if (shape.variable) {
      return `${shape.variable} = ${operations.join('\n  ')}`
    }

    return operations.join('\n  ')
  }

  public format(output: KCLOutput): string {
    return output.shapes.map((shape) => this.formatShape(shape)).join('\n\n')
  }
}
