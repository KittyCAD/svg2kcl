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
import { PathCommand } from '../types/geometric'

export class ConverterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConverterError'
  }
}

export class Converter {
  private previousControlPoint: Point | null = null
  private currentPoint: Point = { x: 0, y: 0 }
  private readonly offsetCoords: Point

  constructor(private options: KCLOptions = {}) {
    // For now, no centering.
    this.offsetCoords = { x: 0, y: 0 }
  }

  private transformPoint(point: Point): Point {
    return {
      x: point.x - this.offsetCoords.x,
      y: point.y - this.offsetCoords.y
    }
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
    if (!this.previousControlPoint) {
      // If no previous control point, use current point.
      return this.currentPoint
    }

    // Reflect the previous control point about current point.
    return {
      x: 2 * this.currentPoint.x - this.previousControlPoint.x,
      y: 2 * this.currentPoint.y - this.previousControlPoint.y
    }
  }

  private generateNewSketch(command: PathCommand): KCLOperation {
    this.currentPoint = command.position
    return {
      type: KCLOperationType.StartSketch,
      params: { point: [this.currentPoint.x, this.currentPoint.y] }
    }
  }

  private handleQuadraticBezier(command: PathCommand, isRelative: boolean): KCLOperation {
    // Quadratic bezier.
    const [x1, y1, x, y] = command.parameters
    const c1x = isRelative ? x1 + this.currentPoint.x : x1
    const c1y = isRelative ? y1 + this.currentPoint.y : y1
    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    let control1 = {
      x: c1x - this.currentPoint.x + this.offsetCoords.x,
      y: c1y - this.currentPoint.y + this.offsetCoords.y
    }
    let endpoint = {
      x: endX - this.currentPoint.x + this.offsetCoords.x,
      y: endY - this.currentPoint.y + this.offsetCoords.y
    }

    // Set current point to endpoint and save control point.
    this.currentPoint = { x: endX, y: endY }
    this.previousControlPoint = { x: c1x, y: c1y }

    // Transform for writing out.
    const transformedControl = this.transformPoint(control1)
    const transformedEndpoint = this.transformPoint(endpoint)

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [transformedControl.x, transformedControl.y],
        control2: [transformedControl.x, transformedControl.y],
        to: [transformedEndpoint.x, transformedEndpoint.y]
      }
    }
  }

  private handleSmoothQuadraticBezier(command: PathCommand, isRelative: boolean): KCLOperation {
    // Get reflected control point.
    const control = this.calculateReflectedControlPoint()

    // Get endpoint from command.
    const [x, y] = command.parameters
    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    let endpoint = {
      x: endX - this.currentPoint.x + this.offsetCoords.x,
      y: endY - this.currentPoint.y + this.offsetCoords.y
    }

    // Set current point to endpoint and save control point.
    this.previousControlPoint = control
    this.currentPoint = { x: endX, y: endY }

    // Transform and invert points.
    const transformedControl = this.transformPoint(control)
    const transformedEndpoint = this.transformPoint(endpoint)

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [transformedControl.x, transformedControl.y],
        control2: [transformedControl.x, transformedControl.y],
        to: [transformedEndpoint.x, transformedEndpoint.y]
      }
    }
  }

  private handleCubicBezier(command: PathCommand, isRelative: boolean): KCLOperation {
    // Cubic bezier.
    const [x1, y1, x2, y2, x, y] = command.parameters
    const c1x = isRelative ? x1 + this.currentPoint.x : x1
    const c1y = isRelative ? y1 + this.currentPoint.y : y1
    const c2x = isRelative ? x2 + this.currentPoint.x : x2
    const c2y = isRelative ? y2 + this.currentPoint.y : y2
    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    let control1 = {
      x: c1x - this.currentPoint.x + this.offsetCoords.x,
      y: c1y - this.currentPoint.y + this.offsetCoords.y
    }
    let control2 = {
      x: c2x - this.currentPoint.x + this.offsetCoords.x,
      y: c2y - this.currentPoint.y + this.offsetCoords.y
    }
    let endpoint = {
      x: endX - this.currentPoint.x + this.offsetCoords.x,
      y: endY - this.currentPoint.y + this.offsetCoords.y
    }

    // Set current point to endpoint and save control point.
    this.previousControlPoint = { x: c2x, y: c2y }
    this.currentPoint = { x: endX, y: endY }

    // Transform and invert points for writing out.
    const transformedControl1 = this.transformPoint(control1)
    const transformedControl2 = this.transformPoint(control2)
    const transformedEndpoint = this.transformPoint(endpoint)

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [transformedControl1.x, transformedControl1.y],
        control2: [transformedControl2.x, transformedControl2.y],
        to: [transformedEndpoint.x, transformedEndpoint.y]
      }
    }
  }

  private handleSmoothCubicBezier(command: PathCommand, isRelative: boolean): KCLOperation {
    const [x2, y2, x, y] = command.parameters

    // Get reflected control point.
    const control1 = this.calculateReflectedControlPoint()

    // Second control point and endpoint from command.
    const c2x = isRelative ? x2 + this.currentPoint.x : x2
    const c2y = isRelative ? y2 + this.currentPoint.y : y2
    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    let control2 = {
      x: c2x - this.currentPoint.x + this.offsetCoords.x,
      y: c2y - this.currentPoint.y + this.offsetCoords.y
    }
    let endpoint = {
      x: endX - this.currentPoint.x + this.offsetCoords.x,
      y: endY - this.currentPoint.y + this.offsetCoords.y
    }

    // Set current point to endpoint and save control point.
    this.previousControlPoint = { x: c2x, y: c2y }
    this.currentPoint = { x: endX, y: endY }

    // Transform and invert points for writing out.
    const transformedControl1 = this.transformPoint(control1)
    const transformedControl2 = this.transformPoint(control2)
    const transformedEndpoint = this.transformPoint(endpoint)

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [transformedControl1.x, transformedControl1.y],
        control2: [transformedControl2.x, transformedControl2.y],
        to: [transformedEndpoint.x, transformedEndpoint.y]
      }
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

  private convertPathCommands(commands: PathCommand[]): KCLOperation[] {
    const operations: KCLOperation[] = []
    this.previousControlPoint = null
    this.currentPoint = { x: 0, y: 0 }

    commands.forEach((command, index) => {
      // Handle first command: start sketch.
      if (index === 0) {
        operations.push(this.generateNewSketch(command))
      }

      // Otherwise, command type determines operation.
      switch (command.type) {
        // Lines.
        case PathCommandType.LineAbsolute:
        case PathCommandType.LineRelative:
        case PathCommandType.HorizontalLineAbsolute:
        case PathCommandType.HorizontalLineRelative:
        case PathCommandType.VerticalLineAbsolute:
        case PathCommandType.VerticalLineRelative:
          operations.push({
            type: KCLOperationType.LineTo,
            params: { point: [this.currentPoint.x, this.currentPoint.y] }
          })
          break

        // Quadratic beziers.
        case PathCommandType.QuadraticBezierAbsolute:
          operations.push(this.handleQuadraticBezier(command, false))
          break
        case PathCommandType.QuadraticBezierRelative:
          operations.push(this.handleQuadraticBezier(command, true))
          break
        case PathCommandType.QuadraticBezierSmoothAbsolute:
          operations.push(this.handleSmoothQuadraticBezier(command, false))
          break
        case PathCommandType.QuadraticBezierSmoothRelative:
          operations.push(this.handleSmoothQuadraticBezier(command, true))
          break

        // Cubic beziers.
        case PathCommandType.CubicBezierAbsolute:
          operations.push(this.handleCubicBezier(command, false))
          break
        case PathCommandType.CubicBezierRelative:
          operations.push(this.handleCubicBezier(command, true))
          break
        case PathCommandType.CubicBezierSmoothAbsolute:
          operations.push(this.handleSmoothCubicBezier(command, false))
          break
        case PathCommandType.CubicBezierSmoothRelative:
          operations.push(this.handleSmoothCubicBezier(command, true))
          break

        // Stops.
        case PathCommandType.StopAbsolute:
        case PathCommandType.StopRelative:
          operations.push({ type: KCLOperationType.Close, params: null })
          break
      }
    })

    if (!operations.some((op) => op.type === KCLOperationType.Close)) {
      operations.push({ type: KCLOperationType.Close, params: null })
    }

    return operations
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
      //   holes.forEach((hole) => {
      //     operations.push({
      //       type: KCLOperationType.Hole,
      //       params: {
      //         operations: this.convertPathCommands(hole.commands)
      //       }
      //     })
      //   })
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
      ]

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

    return [
      {
        type: KCLOperationType.StartSketch,
        params: { point: [center.x, center.y] }
      },
      {
        type: KCLOperationType.Circle,
        params: { radius }
      }
    ]
  }

  private lineToOperations(line: Line): KCLOperation[] {
    this.currentPoint = line.end
    return [
      {
        type: KCLOperationType.StartSketch,
        params: { point: [line.start.x, line.start.y] }
      },
      {
        type: KCLOperationType.LineTo,
        params: { point: [line.end.x, line.end.y] }
      }
    ]
  }

  private polylineToOperations(polyline: Polyline): KCLOperation[] {
    if (polyline.points.length < 2) {
      throw new ConverterError('Polyline must have at least 2 points')
    }

    const operations: KCLOperation[] = []
    const points = polyline.points.map((p) => p)

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
    const points = polygon.points.map((p) => p)

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
