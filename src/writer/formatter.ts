import {
  BezierCurveParams,
  CircleParams,
  HoleParams,
  KclOperation,
  KclOperationType,
  KclOutput,
  KclShape,
  LineToParams,
  StartSketchOnParams,
  StartSketchParams
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
    const scalar = INVERT_Y ? -1 : 1
    const x = Number(point[0].toFixed(3))
    const y = Number((scalar * point[1]).toFixed(3))
    return `[${x}, ${y}]`
  }

  private isStartSketchParams(params: any): params is StartSketchParams {
    return params && 'point' in params
  }

  private isStartSketchOnParams(params: any): params is StartSketchOnParams {
    return params && 'plane' in params
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

  private formatOperation(operation: KclOperation): string {
    if (!operation.params && operation.type !== KclOperationType.Close) {
      throw new FormatterError(`Missing parameters for operation type: ${operation.type}`)
    }

    switch (operation.type) {
      case KclOperationType.StartSketch: {
        if (!this.isStartSketchParams(operation.params)) {
          throw new FormatterError('Invalid StartSketch parameters')
        }
        // const output = `startSketchAt(${this.formatPoint(operation.params.point)})`
        const output = `startSketchOn(XY)\n  |> startProfileAt(${this.formatPoint(
          operation.params.point
        )}, %)`
        return output
      }

      case KclOperationType.StartSketchOn: {
        if (!this.isStartSketchOnParams(operation.params)) {
          throw new FormatterError('Invalid StartSketchOn parameters')
        }
        return `startSketchOn("${operation.params.plane}")`
      }

      case KclOperationType.Line: {
        if (!this.isLineToParams(operation.params)) {
          throw new FormatterError('Invalid Line parameters')
        }
        return `|> line(end = ${this.formatPoint(operation.params.point)})`
      }

      case KclOperationType.BezierCurve: {
        if (!this.isBezierCurveParams(operation.params)) {
          throw new FormatterError('Invalid BezierCurve parameters')
        }
        return `|> bezierCurve({
      control1 = ${this.formatPoint(operation.params.control1)},
      control2 = ${this.formatPoint(operation.params.control2)},
      to = ${this.formatPoint(operation.params.to)}
    }, %)`
      }

      case KclOperationType.Circle: {
        if (!this.isCircleParams(operation.params)) {
          throw new FormatterError('Invalid Circle parameters')
        }
        let center: [number, number] = [operation.params.x, operation.params.y]
        return `|> circle({ center = ${this.formatPoint(center)}, radius = ${
          operation.params.radius
        } }, %)`
      }

      case KclOperationType.Close:
        return '|> close()'

      case KclOperationType.Hole: {
        if (!this.isHoleParams(operation.params)) {
          throw new FormatterError('Invalid Hole parameters')
        }
        const holeOps = operation.params.operations
          .map((op) => this.formatOperation(op))
          .join('\n    ')
        return `|> hole(
        ${holeOps}, %)`
      }

      case KclOperationType.Arc: {
        if (
          !operation.params ||
          !('radius' in operation.params) ||
          !('angle' in operation.params)
        ) {
          throw new FormatterError('Invalid Arc parameters')
        }
        return `|> arc({ radius = ${operation.params.radius}, angle = ${operation.params.angle} }, %)`
      }

      case KclOperationType.TangentialArc: {
        if (!operation.params || !('radius' in operation.params)) {
          throw new FormatterError('Invalid TangentialArc parameters')
        }
        if (!('offset' in operation.params)) {
          throw new FormatterError('Invalid TangentialArc parameters')
        }
        return `|> tangentialArc({ radius = ${operation.params.radius}, offset = ${operation.params.offset} }, %)`
      }

      case KclOperationType.XLineTo: {
        if (!operation.params || !('x' in operation.params)) {
          throw new FormatterError('Invalid XLineTo parameters')
        }
        return `|> xLineTo({ x = ${operation.params.x} }, %)`
      }

      case KclOperationType.YLineTo: {
        if (!operation.params || !('y' in operation.params)) {
          throw new FormatterError('Invalid YLineTo parameters')
        }
        return `|> yLineTo({ y = ${operation.params.y} }, %)`
      }

      case KclOperationType.Polygon: {
        if (
          !operation.params ||
          !('sides' in operation.params) ||
          !('radius' in operation.params)
        ) {
          throw new FormatterError('Invalid Polygon parameters')
        }
        return `|> polygon({ numSides = ${operation.params.sides}, radius = ${operation.params.radius} }, %)`
      }

      default:
        throw new FormatterError(`Unsupported operation type: ${operation.type}`)
    }
  }

  private formatShape(shape: KclShape): string {
    const operations = shape.operations.map((op) => this.formatOperation(op))

    if (shape.variable) {
      return `${shape.variable} = ${operations.join('\n  ')}`
    }

    return operations.join('\n  ')
  }

  public format(output: KclOutput): string {
    return output.shapes.map((shape) => this.formatShape(shape)).join('\n\n')
  }
}
