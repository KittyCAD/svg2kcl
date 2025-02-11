import { FillRule, Plane3D, Point, ViewBox } from '../types/base'
import {
  CircleElement,
  Element,
  ElementType,
  GroupElement,
  LineElement,
  PathElement,
  PolygonElement,
  PolylineElement,
  RectangleElement
} from '../types/elements'
import { KCLOperation, KCLOperationType, KCLOptions } from '../types/kcl'
import { PathCommand, PathCommandType } from '../types/path'
import { separateSubpaths } from '../utils/geometry'
import { getCombinedTransform, Transform } from '../utils/transform'

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
    const xOffset = viewBox.xMin + viewBox.width / 2
    const yOffset = viewBox.yMin + viewBox.height / 2
    this.offsetCoords = { x: xOffset, y: yOffset }
    this.options = options
  }

  // Utilities used in conversion.
  // --------------------------------------------------
  private centerPoint(point: Point): Point {
    if (!this.options.centerOnViewBox) {
      return point
    } else {
      return {
        x: point.x - this.offsetCoords.x,
        y: point.y - this.offsetCoords.y
      }
    }
  }

  private transformPoint(point: Point, transform: Transform | null): Point {
    // First apply any SVG transforms.
    if (transform && transform.matrix) {
      const { a, b, c, d, e, f } = transform.matrix
      point = {
        x: a * point.x + c * point.y + e,
        y: b * point.x + d * point.y + f
      }
    }

    return point
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
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataLinetoCommands

    // Set up x and y values. We may have to override some of these.
    let x: number, y: number

    switch (command.type) {
      case PathCommandType.LineAbsolute:
      case PathCommandType.LineRelative:
        // X and Y supplied.
        ;[x, y] = command.parameters
        break
      case PathCommandType.HorizontalLineAbsolute:
      case PathCommandType.HorizontalLineRelative:
        // X supplied, Y is 0.
        x = command.parameters[0]
        y = 0
        break
      case PathCommandType.VerticalLineAbsolute:
      case PathCommandType.VerticalLineRelative:
        // Y supplied, X is 0.
        x = 0
        y = command.parameters[0]
        break
      default:
        throw new ConverterError(`Invalid line command: ${command.type}`)
    }

    // KCL will use relative coordinates for all points.
    let relativeEndX: number, relativeEndY: number

    // But our state tracking here needs absolute coordinates.
    let absoluteEndX: number, absoluteEndY: number

    if (isRelative) {
      // Coordinates are already relative.
      relativeEndX = x
      relativeEndY = y

      // Convert relative values to absolute for state tracking.
      absoluteEndX = x + this.currentPoint.x
      absoluteEndY = y + this.currentPoint.y
    } else {
      // Input params are absolute so convert to relative for KCL output
      relativeEndX = x - this.currentPoint.x
      relativeEndY = y - this.currentPoint.y

      // Absolute values remain unchanged for state tracking.
      absoluteEndX = x
      absoluteEndY = y
    }

    // Store absolute position for next command.
    this.currentPoint = { x: absoluteEndX, y: absoluteEndY }

    return {
      type: KCLOperationType.Line,
      params: { point: [relativeEndX, relativeEndY] }
    }
  }

  private createQuadraticBezierOp(command: PathCommand, isRelative: boolean): KCLOperation {
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataQuadraticBezierCommands
    const [x1, y1, x, y] = command.parameters

    // KCL will use relative coordinates for all points.
    let relativeControl1X: number, relativeControl1Y: number
    let relativeControl2X: number, relativeControl2Y: number
    let relativeEndX: number, relativeEndY: number

    // But our state tracking here needs absolute coordinates.
    let absoluteControl1X: number, absoluteControl1Y: number
    let absoluteEndX: number, absoluteEndY: number

    if (isRelative) {
      // Coordinates are already relative.
      relativeControl1X = x1
      relativeControl1Y = y1
      relativeEndX = x
      relativeEndY = y

      // Convert relative values to absolute for state tracking.
      absoluteControl1X = x1 + this.currentPoint.x
      absoluteControl1Y = y1 + this.currentPoint.y
      absoluteEndX = x + this.currentPoint.x
      absoluteEndY = y + this.currentPoint.y
    } else {
      // Input params are absolute so convert to relative for KCL output.
      relativeControl1X = x1 - this.currentPoint.x
      relativeControl1Y = y1 - this.currentPoint.y
      relativeEndX = x - this.currentPoint.x
      relativeEndY = y - this.currentPoint.y

      // Absolute values remain unchanged for state tracking.
      absoluteControl1X = x1
      absoluteControl1Y = y1
      absoluteEndX = x
      absoluteEndY = y
    }

    // Convert quadratic to cubic Bézier control points for KCL.
    // See: https://stackoverflow.com/questions/3162645/convert-a-quadratic-bezier-to-a-cubic-one
    // https://stackoverflow.com/questions/9485788/convert-quadratic-curve-to-cubic-curve
    const startX = this.currentPoint.x
    const startY = this.currentPoint.y

    const cp1x = startX + (2 / 3) * (absoluteControl1X - startX)
    const cp1y = startY + (2 / 3) * (absoluteControl1Y - startY)

    const cp2x = absoluteEndX + (2 / 3) * (absoluteControl1X - absoluteEndX)
    const cp2y = absoluteEndY + (2 / 3) * (absoluteControl1Y - absoluteEndY)

    // Then convert to relative positions for KCL output.
    relativeControl1X = cp1x - this.currentPoint.x
    relativeControl1Y = cp1y - this.currentPoint.y
    relativeControl2X = cp2x - this.currentPoint.x
    relativeControl2Y = cp2y - this.currentPoint.y

    // Store absolute positions for next command.
    this.previousControlPoint = { x: absoluteControl1X, y: absoluteControl1Y }
    this.currentPoint = { x: absoluteEndX, y: absoluteEndY }

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [relativeControl1X, relativeControl1Y],
        control2: [relativeControl2X, relativeControl2Y],
        to: [relativeEndX, relativeEndY]
      }
    }
  }

  private createCubicBezierOp(command: PathCommand, isRelative: boolean): KCLOperation {
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataLinetoCommands
    const [x1, y1, x2, y2, x, y] = command.parameters

    // KCL will use relative coordinates for all points.
    let relativeControl1X: number, relativeControl1Y: number
    let relativeControl2X: number, relativeControl2Y: number
    let relativeEndX: number, relativeEndY: number

    // But our state tracking here needs absolute coordinates.
    let absoluteControl2X: number, absoluteControl2Y: number
    let absoluteEndX: number, absoluteEndY: number

    if (isRelative) {
      // Coordinates are already relative.
      relativeControl1X = x1
      relativeControl1Y = y1
      relativeControl2X = x2
      relativeControl2Y = y2
      relativeEndX = x
      relativeEndY = y

      // Convert relative values to absolute for state tracking.
      absoluteControl2X = x2 + this.currentPoint.x
      absoluteControl2Y = y2 + this.currentPoint.y
      absoluteEndX = x + this.currentPoint.x
      absoluteEndY = y + this.currentPoint.y
    } else {
      // Input params are absolute so convert to relative for KCL output
      relativeControl1X = x1 - this.currentPoint.x
      relativeControl1Y = y1 - this.currentPoint.y
      relativeControl2X = x2 - this.currentPoint.x
      relativeControl2Y = y2 - this.currentPoint.y
      relativeEndX = x - this.currentPoint.x
      relativeEndY = y - this.currentPoint.y

      // Absolute values remain unchanged for state tracking.
      absoluteControl2X = x2
      absoluteControl2Y = y2
      absoluteEndX = x
      absoluteEndY = y
    }

    // Store absolute positions for next command.
    this.previousControlPoint = { x: absoluteControl2X, y: absoluteControl2Y }
    this.currentPoint = { x: absoluteEndX, y: absoluteEndY }

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [relativeControl1X, relativeControl1Y],
        control2: [relativeControl2X, relativeControl2Y],
        to: [relativeEndX, relativeEndY]
      }
    }
  }

  private createQuadraticBezierSmoothOp(command: PathCommand, isRelative: boolean): KCLOperation {
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataQuadraticBezierCommands
    const [x, y] = command.parameters

    // KCL will use relative coordinates for all points.
    let relativeControl1X: number, relativeControl1Y: number
    let relativeEndX: number, relativeEndY: number

    // But our state tracking here needs absolute coordinates.
    let absoluteControl1X: number, absoluteControl1Y: number
    let absoluteEndX: number, absoluteEndY: number

    // Calculate reflected control point
    const reflectedPoint = this.calculateReflectedControlPoint()
    absoluteControl1X = reflectedPoint.x
    absoluteControl1Y = reflectedPoint.y

    if (isRelative) {
      // Coordinates are already relative.
      relativeEndX = x
      relativeEndY = y

      // Convert relative values to absolute for state tracking.
      absoluteEndX = x + this.currentPoint.x
      absoluteEndY = y + this.currentPoint.y
    } else {
      // Input params are absolute so convert to relative for KCL output.
      relativeEndX = x - this.currentPoint.x
      relativeEndY = y - this.currentPoint.y

      // Absolute values remain unchanged for state tracking.
      absoluteEndX = x
      absoluteEndY = y
    }

    // Control point is relative to current point.
    relativeControl1X = absoluteControl1X - this.currentPoint.x
    relativeControl1Y = absoluteControl1Y - this.currentPoint.y

    // Store absolute positions for next command.
    this.previousControlPoint = { x: absoluteControl1X, y: absoluteControl1Y }
    this.currentPoint = { x: absoluteEndX, y: absoluteEndY }

    // KCL wants cubic Beziers, so duplicate control point to mimic quadratic
    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [relativeControl1X, relativeControl1Y],
        control2: [relativeControl1X, relativeControl1Y],
        to: [relativeEndX, relativeEndY]
      }
    }
  }

  private createCubicBezierSmoothOp(command: PathCommand, isRelative: boolean): KCLOperation {
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataCubicBezierCommands
    const [x2, y2, x, y] = command.parameters

    // KCL will use relative coordinates for all points.
    let relativeControl1X: number, relativeControl1Y: number
    let relativeControl2X: number, relativeControl2Y: number
    let relativeEndX: number, relativeEndY: number

    // But our state tracking here needs absolute coordinates.
    let absoluteControl1X: number, absoluteControl1Y: number
    let absoluteControl2X: number, absoluteControl2Y: number
    let absoluteEndX: number, absoluteEndY: number

    // Calculate reflected first control point.
    const reflectedPoint = this.calculateReflectedControlPoint()
    absoluteControl1X = reflectedPoint.x
    absoluteControl1Y = reflectedPoint.y

    if (isRelative) {
      // Coordinates are already relative.
      relativeControl2X = x2
      relativeControl2Y = y2
      relativeEndX = x
      relativeEndY = y

      // Convert relative values to absolute for state tracking.
      absoluteControl2X = x2 + this.currentPoint.x
      absoluteControl2Y = y2 + this.currentPoint.y
      absoluteEndX = x + this.currentPoint.x
      absoluteEndY = y + this.currentPoint.y
    } else {
      // Input params are absolute so convert to relative for KCL output
      relativeControl2X = x2 - this.currentPoint.x
      relativeControl2Y = y2 - this.currentPoint.y
      relativeEndX = x - this.currentPoint.x
      relativeEndY = y - this.currentPoint.y

      // Absolute values remain unchanged for state tracking.
      absoluteControl2X = x2
      absoluteControl2Y = y2
      absoluteEndX = x
      absoluteEndY = y
    }

    // First control point is relative to current point.
    relativeControl1X = absoluteControl1X - this.currentPoint.x
    relativeControl1Y = absoluteControl1Y - this.currentPoint.y

    // Store absolute positions for next command.
    this.previousControlPoint = { x: absoluteControl2X, y: absoluteControl2Y }
    this.currentPoint = { x: absoluteEndX, y: absoluteEndY }

    return {
      type: KCLOperationType.BezierCurve,
      params: {
        control1: [relativeControl1X, relativeControl1Y],
        control2: [relativeControl2X, relativeControl2Y],
        to: [relativeEndX, relativeEndY]
      }
    }
  }

  // Command conversion methods.
  // --------------------------------------------------
  private convertPathCommandsToKclOps(
    commands: PathCommand[],
    transform: Transform
  ): KCLOperation[] {
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
    const transform = path.transform!

    if (path.fillRule === FillRule.EvenOdd) {
      // Even-odd fill rule - first subpath is outline, rest are holes.
      const subpaths = separateSubpaths(path)
      const [outline, ...holes] = subpaths

      // Convert outline.
      operations.push(...this.convertPathCommandsToKclOps(outline.commands, transform))

      // Convert holes.
      holes.forEach((hole) => {
        operations.push({
          type: KCLOperationType.Hole,
          params: {
            operations: this.convertPathCommandsToKclOps(hole.commands, transform)
          }
        })
      })
    } else {
      // Nonzero fill rule - use winding direction.
      const subpaths = separateSubpaths(path)
      const [first, ...rest] = subpaths
      const baseClockwise = first.isClockwise

      // Convert first path.
      operations.push(...this.convertPathCommandsToKclOps(first.commands, transform))

      // Rest are holes if opposite winding, separate shapes if same.
      rest.forEach((subpath) => {
        const subpathOps = this.convertPathCommandsToKclOps(subpath.commands, transform)
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
      // Regular rectangle, drawn clockwise, y+ve down. Note our KCL line op is relative.
      const points: [number, number][] = [
        [x, y],
        [width, 0],
        [0, height],
        [-width, 0]
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

      const startPoint: [number, number] = [x + effectiveRx, y]
      operations.push({ type: KCLOperationType.StartSketch, params: { point: startPoint } })

      // Top edge and top-right corner.
      operations.push(
        { type: KCLOperationType.Line, params: { point: [width - effectiveRx, 0] } },
        { type: KCLOperationType.TangentialArc, params: { radius: effectiveRx, offset: 90 } }
      )

      // Right edge and bottom-right corner.
      operations.push(
        {
          type: KCLOperationType.Line,
          params: { point: [0, -(height - effectiveRy)] }
        },
        { type: KCLOperationType.TangentialArc, params: { radius: effectiveRx, offset: 90 } }
      )

      // Bottom edge and bottom-left corner.
      operations.push(
        { type: KCLOperationType.Line, params: { point: [-(width - effectiveRx), 0] } },
        { type: KCLOperationType.TangentialArc, params: { radius: effectiveRx, offset: 90 } }
      )

      // Left edge and top-left corner.
      operations.push(
        { type: KCLOperationType.Line, params: { point: [0, height - effectiveRy] } },
        { type: KCLOperationType.TangentialArc, params: { radius: effectiveRx, offset: 90 } },
        { type: KCLOperationType.Close, params: null }
      )
    }

    return operations
  }

  private convertCircleToKclOps(circle: CircleElement): KCLOperation[] {
    const { center, radius } = circle

    // Chain together new sketch and circle operations.
    return [
      {
        type: KCLOperationType.StartSketchOn,
        params: { plane: Plane3D.XY }
      },
      {
        type: KCLOperationType.Circle,
        params: { radius, x: center.x, y: center.y }
      }
    ]
  }

  private convertLineToKclOps(line: LineElement): KCLOperation[] {
    this.currentPoint = line.end

    // Lines are relative in our KCL call, but absolute in SVG.
    const deltaX = line.end.x - line.start.x
    const deltaY = line.end.y - line.start.y

    return [
      {
        type: KCLOperationType.StartSketch,
        params: { point: [line.start.x, line.start.y] }
      },
      {
        type: KCLOperationType.Line,
        params: { point: [deltaX, deltaY] }
      }
    ]
  }

  private convertPolylineToKclOps(polyline: PolylineElement): KCLOperation[] {
    if (polyline.points.length < 2) {
      throw new ConverterError('Polyline must have at least 2 points')
    }

    const operations: KCLOperation[] = []
    const points = polyline.points.map((p) => p)

    // Lines are relative in our KCL call, but absolute in SVG. Need a backwards diff.
    const diffs = points.reduce((acc, point, index, arr) => {
      if (index === 0) return acc
      acc.push({
        dx: point.x - arr[index - 1].x,
        dy: point.y - arr[index - 1].y
      })
      return acc
    }, [] as Array<{ dx: number; dy: number }>)

    // Push ops.
    operations.push({
      type: KCLOperationType.StartSketch,
      params: { point: [points[0].x, points[0].y] }
    })

    diffs.forEach((point) => {
      operations.push({
        type: KCLOperationType.Line,
        params: { point: [point.dx, point.dy] }
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

    // SVG does polygons with chained absolute points, but our KCL call uses relative.
    const diffs = points.reduce((acc, point, index, arr) => {
      if (index === 0) return acc
      acc.push({
        dx: point.x - arr[index - 1].x,
        dy: point.y - arr[index - 1].y
      })
      return acc
    }, [] as Array<{ dx: number; dy: number }>)

    // Push ops.
    operations.push({
      type: KCLOperationType.StartSketch,
      params: { point: [points[0].x, points[0].y] }
    })

    diffs.forEach((point) => {
      operations.push({
        type: KCLOperationType.Line,
        params: { point: [point.dx, point.dy] }
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
