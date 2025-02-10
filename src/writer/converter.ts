import {
  PathElement,
  RectangleElement,
  CircleElement,
  LineElement,
  PolylineElement,
  PolygonElement,
  Element,
  ElementType,
  GroupElement
} from '../types/elements'
import { Point, ViewBox, FillRule } from '../types/base'
import { PathCommand, PathCommandType } from '../types/path'
import { KCLOperation, KCLOperationType, KCLOptions } from '../types/kcl'
import { separateSubpaths } from '../utils/geometry'
import { getCombinedTransform } from '../utils/transform'
import { Transform } from '../utils/transform'

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

  constructor(private options: KCLOptions = {}, viewBox: ViewBox) {
    // Calculate offset coordinates for centering if requested.
    const x = options.centerOnViewBox ? viewBox.xMin + viewBox.width / 2 : 0
    const y = options.centerOnViewBox ? viewBox.yMin + viewBox.height / 2 : 0
    this.offsetCoords = { x, y }
  }

  // Utilities used in conversion.
  // --------------------------------------------------
  private centerPoint(point: Point): Point {
    return {
      x: point.x - this.offsetCoords.x,
      y: point.y - this.offsetCoords.y
    }
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

  private transformPoint(point: Point, transform: Transform | null): Point {
    if (!transform || !transform.matrix) {
      return point
    }

    const { a, b, c, d, e, f } = transform.matrix
    return {
      x: a * point.x + c * point.y + e,
      y: b * point.x + d * point.y + f
    }
  }

  // Operation creation methods.
  // --------------------------------------------------
  private createNewSketchOp(command: PathCommand): KCLOperation {
    // Set the 'currentPoint' to be the position of the first point. Relative
    // commands will add to this point.
    this.currentPoint = command.position

    // Offset, if centering, and write.
    let outPoint = this.centerPoint(this.currentPoint)
    return {
      type: KCLOperationType.StartSketch,
      params: { point: [outPoint.x, outPoint.y] }
    }
  }

  private createLineOp(command: PathCommand, isRelative: boolean): KCLOperation {
    // Line.
    const [x, y] = command.parameters

    const endX = isRelative ? x + this.currentPoint.x : x
    const endY = isRelative ? y + this.currentPoint.y : y

    let endpoint = {
      x: endX - this.currentPoint.x + this.offsetCoords.x,
      y: endY - this.currentPoint.y + this.offsetCoords.y
    }

    // Set current point.
    this.currentPoint = { x: endX, y: endY }

    // Center.
    const centeredEndpoint = this.centerPoint(endpoint)

    return {
      type: KCLOperationType.Line,
      params: { point: [centeredEndpoint.x, centeredEndpoint.y] }
    }
  }

  private createQuadraticBezierOp(command: PathCommand, isRelative: boolean): KCLOperation {
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

    // Center for writing out.
    const centeredControl = this.centerPoint(control1)
    const centeredEndpoint = this.centerPoint(endpoint)

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [centeredControl.x, centeredControl.y],
        control2: [centeredControl.x, centeredControl.y],
        to: [centeredEndpoint.x, centeredEndpoint.y]
      }
    }
  }

  private createQuadraticBezierSmoothOp(command: PathCommand, isRelative: boolean): KCLOperation {
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

    // Center and invert points.
    const centeredControl = this.centerPoint(control)
    const centeredEndpoint = this.centerPoint(endpoint)

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [centeredControl.x, centeredControl.y],
        control2: [centeredControl.x, centeredControl.y],
        to: [centeredEndpoint.x, centeredEndpoint.y]
      }
    }
  }

  private createCubicBezierOp(command: PathCommand, isRelative: boolean): KCLOperation {
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

    // Center and invert points for writing out.
    const centeredControl1 = this.centerPoint(control1)
    const centeredControl2 = this.centerPoint(control2)
    const centeredEndpoint = this.centerPoint(endpoint)

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [centeredControl1.x, centeredControl1.y],
        control2: [centeredControl2.x, centeredControl2.y],
        to: [centeredEndpoint.x, centeredEndpoint.y]
      }
    }
  }

  private createCubicBezierSmoothOp(command: PathCommand, isRelative: boolean): KCLOperation {
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

    // Center and invert points for writing out.
    const centeredControl1 = this.centerPoint(control1)
    const centeredControl2 = this.centerPoint(control2)
    const centeredEndpoint = this.centerPoint(endpoint)

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [centeredControl1.x, centeredControl1.y],
        control2: [centeredControl2.x, centeredControl2.y],
        to: [centeredEndpoint.x, centeredEndpoint.y]
      }
    }
  }

  // Command conversion methods.
  // --------------------------------------------------
  private convertPathCommandsToKclOps(commands: PathCommand[]): KCLOperation[] {
    const operations: KCLOperation[] = []
    this.previousControlPoint = null
    this.currentPoint = { x: 0, y: 0 }

    commands.forEach((command, index) => {
      // Handle first command: start sketch.
      if (index === 0) {
        operations.push(this.createNewSketchOp(command))
      }

      // Otherwise, command type determines operation.
      switch (command.type) {
        // Lines.
        case PathCommandType.LineAbsolute:
        case PathCommandType.HorizontalLineAbsolute:
        case PathCommandType.VerticalLineAbsolute:
          operations.push(this.createLineOp(command, false))
          break
        case PathCommandType.LineRelative:
        case PathCommandType.HorizontalLineRelative:
        case PathCommandType.VerticalLineRelative:
          operations.push(this.createLineOp(command, true))
          break

        // Quadratic beziers.
        case PathCommandType.QuadraticBezierAbsolute:
          operations.push(this.createQuadraticBezierOp(command, false))
          break
        case PathCommandType.QuadraticBezierRelative:
          operations.push(this.createQuadraticBezierOp(command, true))
          break
        case PathCommandType.QuadraticBezierSmoothAbsolute:
          operations.push(this.createQuadraticBezierSmoothOp(command, false))
          break
        case PathCommandType.QuadraticBezierSmoothRelative:
          operations.push(this.createQuadraticBezierSmoothOp(command, true))
          break

        // Cubic beziers.
        case PathCommandType.CubicBezierAbsolute:
          operations.push(this.createCubicBezierOp(command, false))
          break
        case PathCommandType.CubicBezierRelative:
          operations.push(this.createCubicBezierOp(command, true))
          break
        case PathCommandType.CubicBezierSmoothAbsolute:
          operations.push(this.createCubicBezierSmoothOp(command, false))
          break
        case PathCommandType.CubicBezierSmoothRelative:
          operations.push(this.createCubicBezierSmoothOp(command, true))
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

  private convertPathToKclOps(path: PathElement): KCLOperation[] {
    const operations: KCLOperation[] = []

    if (path.fillRule === FillRule.EvenOdd) {
      // Even-odd fill rule - first subpath is outline, rest are holes.
      const subpaths = separateSubpaths(path)
      const [outline, ...holes] = subpaths

      // Convert outline.
      operations.push(...this.convertPathCommandsToKclOps(outline.commands))

      // Convert holes.
      holes.forEach((hole) => {
        operations.push({
          type: KCLOperationType.Hole,
          params: {
            operations: this.convertPathCommandsToKclOps(hole.commands)
          }
        })
      })
    } else {
      // Nonzero fill rule - use winding direction.
      const subpaths = separateSubpaths(path)
      const [first, ...rest] = subpaths
      const baseClockwise = first.isClockwise

      // Convert first path.
      operations.push(...this.convertPathCommandsToKclOps(first.commands))

      // Rest are holes if opposite winding, separate shapes if same.
      rest.forEach((subpath) => {
        const subpathOps = this.convertPathCommandsToKclOps(subpath.commands)
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

  private convertRectangleToKclOps(rect: RectangleElement): KCLOperation[] {
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
          type: KCLOperationType.Line,
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
        { type: KCLOperationType.Line, params: { point: [x + width - effectiveRx, -y] } },
        { type: KCLOperationType.Arc, params: { radius: effectiveRx, angle: 90 } }
      )

      // Right edge and bottom-right corner.
      operations.push(
        {
          type: KCLOperationType.Line,
          params: { point: [x + width, -(y + height - effectiveRy)] }
        },
        { type: KCLOperationType.Arc, params: { radius: effectiveRx, angle: 90 } }
      )

      // Bottom edge and bottom-left corner.
      operations.push(
        { type: KCLOperationType.Line, params: { point: [x + effectiveRx, -(y + height)] } },
        { type: KCLOperationType.Arc, params: { radius: effectiveRx, angle: 90 } }
      )

      // Left edge and top-left corner.
      operations.push(
        { type: KCLOperationType.Line, params: { point: [x, -(y + effectiveRy)] } },
        { type: KCLOperationType.Arc, params: { radius: effectiveRx, angle: 90 } },
        { type: KCLOperationType.Close, params: null }
      )
    }

    return operations
  }

  private convertCircleToKclOps(circle: CircleElement): KCLOperation[] {
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

  private convertLineToKclOps(line: LineElement): KCLOperation[] {
    this.currentPoint = line.end
    return [
      {
        type: KCLOperationType.StartSketch,
        params: { point: [line.start.x, line.start.y] }
      },
      {
        type: KCLOperationType.Line,
        params: { point: [line.end.x, line.end.y] }
      }
    ]
  }

  private convertPolylineToKclOps(polyline: PolylineElement): KCLOperation[] {
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
        type: KCLOperationType.Line,
        params: { point: [point.x, point.y] }
      })
    })

    return operations
  }

  private convertPolygonToKclOps(polygon: PolygonElement): KCLOperation[] {
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
        type: KCLOperationType.Line,
        params: { point: [point.x, point.y] }
      })
    })

    operations.push({ type: KCLOperationType.Close, params: null })
    return operations
  }

  public convertElement(elements: Element[], targetElement: Element): KCLOperation[] {
    // Get the combined transform by walking up through the groups
    const combinedTransform = getCombinedTransform(elements, targetElement)

    // Store the original transform.
    const originalTransform = targetElement.transform

    // Temporarily set the element's transform to the combined transform.
    targetElement.transform = combinedTransform

    let opList: KCLOperation[] = []

    switch (targetElement.type) {
      case ElementType.Path:
        opList = this.convertPathToKclOps(targetElement as PathElement)
        break
      case ElementType.Rectangle:
        opList = this.convertRectangleToKclOps(targetElement as RectangleElement)
        break
      case ElementType.Circle:
        opList = this.convertCircleToKclOps(targetElement as CircleElement)
        break
      case ElementType.Line:
        opList = this.convertLineToKclOps(targetElement as LineElement)
        break
      case ElementType.Polyline:
        opList = this.convertPolylineToKclOps(targetElement as PolylineElement)
        break
      case ElementType.Polygon:
        opList = this.convertPolygonToKclOps(targetElement as PolygonElement)
        break
      case ElementType.Group:
        // Recursively convert children.
        const group = targetElement as GroupElement
        opList = group.children.flatMap((child) => this.convertElement(elements, child))
        break
      default: {
        const exhaustiveCheck: never = targetElement
        throw new ConverterError(`Unsupported element type: ${(targetElement as any).type}`)
      }
    }

    // Restore the original transform.
    targetElement.transform = originalTransform

    return opList
  }
}
