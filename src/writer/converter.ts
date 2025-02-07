import {
  GeometricElementType,
  GeometricShape,
  Path,
  Rectangle,
  Circle,
  Line,
  Polygon,
  Polyline,
  Point,
  FillRule,
  PathCommandType
} from '../types/geometric'
import { KCLOperation, KCLOperationType, KCLOptions } from '../types/kcl'

export class ConverterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConverterError'
  }
}

export class Converter {
  // Track previous control point (required smooth curves).
  private previousControlPoint: Point | null = null
  private currentPoint: Point | null = null

  constructor(private options: KCLOptions = {}) {}

  private invertY(point: Point): Point {
    return { x: point.x, y: -point.y }
  }

  private isClockwise(points: Point[]): boolean {
    let sum = 0
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i]
      const next = points[i + 1]
      sum += (next.x - curr.x) * (next.y + curr.y)
    }
    return sum > 0
  }

  private calculateReflectedControlPoint(): Point {
    if (!this.previousControlPoint || !this.currentPoint) {
      return this.currentPoint || { x: 0, y: 0 }
    }

    // Reflect previous control point about current point.
    return {
      x: 2 * this.currentPoint.x - this.previousControlPoint.x,
      y: 2 * this.currentPoint.y - this.previousControlPoint.y
    }
  }

  private separateSubpaths(path: Path): {
    commands: Path['commands']
    isClockwise: boolean
  }[] {
    const subpaths: { commands: Path['commands']; isClockwise: boolean }[] = []
    let currentCommands: Path['commands'] = []

    path.commands.forEach((command) => {
      if (
        currentCommands.length > 0 &&
        (command.type === PathCommandType.MoveAbsolute ||
          command.type === PathCommandType.MoveRelative)
      ) {
        subpaths.push({
          commands: currentCommands,
          isClockwise: this.isClockwise(currentCommands.map((c) => c.position))
        })
        currentCommands = []
      }
      currentCommands.push(command)
    })

    if (currentCommands.length > 0) {
      subpaths.push({
        commands: currentCommands,
        isClockwise: this.isClockwise(currentCommands.map((c) => c.position))
      })
    }

    return subpaths
  }

  private pathToOperations(path: Path): KCLOperation[] {
    const operations: KCLOperation[] = []

    if (path.fillRule === FillRule.EvenOdd) {
      // Even-odd fill rule - first subpath is outline, rest are holes.
      const subpaths = this.separateSubpaths(path)
      const [outline, ...holes] = subpaths

      // Convert outline.
      operations.push(...this.convertPathCommands(outline.commands))

      // Convert holes.
      holes.forEach((hole) => {
        operations.push({
          type: KCLOperationType.Hole,
          params: {
            operations: this.convertPathCommands(hole.commands)
          }
        })
      })
    } else {
      // Nonzero fill rule - use winding direction.
      const subpaths = this.separateSubpaths(path)
      const [first, ...rest] = subpaths
      const baseClockwise = first.isClockwise

      // Convert first path.
      operations.push(...this.convertPathCommands(first.commands))

      // Rest are holes if opposite winding, separate shapes if same.
      rest.forEach((subpath) => {
        const subpathOps = this.convertPathCommands(subpath.commands)
        if (subpath.isClockwise === baseClockwise) {
          // Same winding - separate shape.
          operations.push(...subpathOps)
        } else {
          // Opposite winding - hole.
          operations.push({
            type: KCLOperationType.Hole,
            params: { operations: subpathOps }
          })
        }
      })
    }

    return operations
  }

  private convertPathCommands(commands: Path['commands']): KCLOperation[] {
    const operations: KCLOperation[] = []
    this.previousControlPoint = null
    this.currentPoint = null

    commands.forEach((command, index) => {
      const point = this.invertY(command.position)
      // Store non-inverted position.
      this.currentPoint = command.position

      if (index === 0) {
        operations.push({
          type: KCLOperationType.StartSketch,
          params: { point: [point.x, point.y] }
        })
        return
      }

      switch (command.type) {
        case PathCommandType.LineAbsolute:
        case PathCommandType.LineRelative:
        case PathCommandType.HorizontalLineAbsolute:
        case PathCommandType.HorizontalLineRelative:
        case PathCommandType.VerticalLineAbsolute:
        case PathCommandType.VerticalLineRelative:
          operations.push({
            type: KCLOperationType.LineTo,
            params: { point: [point.x, point.y] }
          })
          break

        case PathCommandType.QuadraticBezierAbsolute:
        case PathCommandType.QuadraticBezierRelative: {
          const [x1, y1] = command.parameters
          const control = this.invertY({ x: x1, y: y1 })
          this.previousControlPoint = { x: x1, y: y1 }

          operations.push({
            type: KCLOperationType.BezierCurve,
            params: {
              control1: [control.x, control.y],
              control2: [control.x, control.y], // Same control point for quadratic.
              to: [point.x, point.y]
            }
          })
          break
        }

        case PathCommandType.QuadraticBezierSmoothAbsolute:
        case PathCommandType.QuadraticBezierSmoothRelative: {
          const reflectedControl = this.calculateReflectedControlPoint()
          const control = this.invertY(reflectedControl)
          this.previousControlPoint = reflectedControl

          operations.push({
            type: KCLOperationType.BezierCurve,
            params: {
              control1: [control.x, control.y],
              control2: [control.x, control.y],
              to: [point.x, point.y]
            }
          })
          break
        }

        case PathCommandType.CubicBezierAbsolute:
        case PathCommandType.CubicBezierRelative: {
          const [x1, y1, x2, y2] = command.parameters
          const control1 = this.invertY({ x: x1, y: y1 })
          const control2 = this.invertY({ x: x2, y: y2 })
          this.previousControlPoint = { x: x2, y: y2 }

          operations.push({
            type: KCLOperationType.BezierCurve,
            params: {
              control1: [control1.x, control1.y],
              control2: [control2.x, control2.y],
              to: [point.x, point.y]
            }
          })
          break
        }

        case PathCommandType.CubicBezierSmoothAbsolute:
        case PathCommandType.CubicBezierSmoothRelative: {
          const [x2, y2] = command.parameters
          const reflectedControl = this.calculateReflectedControlPoint()
          const control1 = this.invertY(reflectedControl)
          const control2 = this.invertY({ x: x2, y: y2 })
          this.previousControlPoint = { x: x2, y: y2 }

          operations.push({
            type: KCLOperationType.BezierCurve,
            params: {
              control1: [control1.x, control1.y],
              control2: [control2.x, control2.y],
              to: [point.x, point.y]
            }
          })
          break
        }

        case PathCommandType.StopAbsolute:
        case PathCommandType.StopRelative:
          operations.push({ type: KCLOperationType.Close, params: null })
          break
      }
    })

    // Ensure path is closed.
    if (!operations.some((op) => op.type === KCLOperationType.Close)) {
      operations.push({ type: KCLOperationType.Close, params: null })
    }

    return operations
  }

  private rectangleToOperations(rect: Rectangle): KCLOperation[] {
    const operations: KCLOperation[] = []
    const { x, y, width, height, rx, ry } = rect

    if (!rx && !ry) {
      // Regular rectangle.
      const points: [number, number][] = [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height]
      ].map(([x, y]) => [x, -y])

      operations.push(
        { type: KCLOperationType.StartSketch, params: { point: points[0] } },
        ...points.slice(1).map((point) => ({
          type: KCLOperationType.LineTo,
          params: { point }
        })),
        { type: KCLOperationType.Close, params: null }
      )
    } else {
      // Rounded rectangle.
      const effectiveRx = rx || ry || 0
      const effectiveRy = ry || rx || 0

      const startPoint: [number, number] = [x + effectiveRx, -y]
      operations.push({ type: KCLOperationType.StartSketch, params: { point: startPoint } })

      // Top edge and top-right corner.
      operations.push(
        { type: KCLOperationType.LineTo, params: { point: [x + width - effectiveRx, -y] } },
        { type: KCLOperationType.Arc, params: { radius: effectiveRx, angle: 90 } }
      )

      // Right edge and bottom-right corner.
      operations.push(
        {
          type: KCLOperationType.LineTo,
          params: { point: [x + width, -(y + height - effectiveRy)] }
        },
        { type: KCLOperationType.Arc, params: { radius: effectiveRx, angle: 90 } }
      )

      // Bottom edge and bottom-left corner.
      operations.push(
        { type: KCLOperationType.LineTo, params: { point: [x + effectiveRx, -(y + height)] } },
        { type: KCLOperationType.Arc, params: { radius: effectiveRx, angle: 90 } }
      )

      // Left edge and top-left corner.
      operations.push(
        { type: KCLOperationType.LineTo, params: { point: [x, -(y + effectiveRy)] } },
        { type: KCLOperationType.Arc, params: { radius: effectiveRx, angle: 90 } },
        { type: KCLOperationType.Close, params: null }
      )
    }

    return operations
  }

  private circleToOperations(circle: Circle): KCLOperation[] {
    const { center, radius } = circle
    const invertedCenter = this.invertY(center)

    return [
      {
        type: KCLOperationType.StartSketch,
        params: { point: [invertedCenter.x, invertedCenter.y] }
      },
      {
        type: KCLOperationType.Circle,
        params: { radius }
      }
    ]
  }

  private lineToOperations(line: Line): KCLOperation[] {
    const start = this.invertY(line.start)
    const end = this.invertY(line.end)

    return [
      {
        type: KCLOperationType.StartSketch,
        params: { point: [start.x, start.y] }
      },
      {
        type: KCLOperationType.LineTo,
        params: { point: [end.x, end.y] }
      }
    ]
  }

  private polylineToOperations(polyline: Polyline): KCLOperation[] {
    if (polyline.points.length < 2) {
      throw new ConverterError('Polyline must have at least 2 points')
    }

    const operations: KCLOperation[] = []
    const points = polyline.points.map((p) => this.invertY(p))

    operations.push({
      type: KCLOperationType.StartSketch,
      params: { point: [points[0].x, points[0].y] }
    })

    points.slice(1).forEach((point) => {
      operations.push({
        type: KCLOperationType.LineTo,
        params: { point: [point.x, point.y] }
      })
    })

    return operations
  }

  private polygonToOperations(polygon: Polygon): KCLOperation[] {
    if (polygon.points.length < 3) {
      throw new ConverterError('Polygon must have at least 3 points')
    }

    const operations: KCLOperation[] = []
    const points = polygon.points.map((p) => this.invertY(p))

    operations.push({
      type: KCLOperationType.StartSketch,
      params: { point: [points[0].x, points[0].y] }
    })

    points.slice(1).forEach((point) => {
      operations.push({
        type: KCLOperationType.LineTo,
        params: { point: [point.x, point.y] }
      })
    })

    operations.push({ type: KCLOperationType.Close, params: null })
    return operations
  }

  public convertElement(element: GeometricShape): KCLOperation[] {
    switch (element.type) {
      case GeometricElementType.Path:
        return this.pathToOperations(element as Path)
      case GeometricElementType.Rectangle:
        return this.rectangleToOperations(element as Rectangle)
      case GeometricElementType.Circle:
        return this.circleToOperations(element as Circle)
      case GeometricElementType.Line:
        return this.lineToOperations(element as Line)
      case GeometricElementType.Polyline:
        return this.polylineToOperations(element as Polyline)
      case GeometricElementType.Polygon:
        return this.polygonToOperations(element as Polygon)
      default: {
        const exhaustiveCheck: never = element
        throw new ConverterError(`Unsupported element type: ${(element as any).type}`)
      }
    }
  }
}
