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
import { KclOperation, KclOperationType, KclOptions } from '../types/kcl'
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

  constructor(private options: KclOptions = {}, viewBox: ViewBox) {
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
  private createNewSketchOp(command: PathCommand, transform: Transform): KclOperation {
    // Set the 'currentPoint' to be the position of the first point. Relative
    // commands will add to this point.
    this.currentPoint = command.position

    // Transform the start point.
    const transformedStart = transform.transformPoint(this.currentPoint)

    // Apply centering if requested.
    const centeredPoint = this.centerPoint(transformedStart)

    return {
      type: KclOperationType.StartSketch,
      params: { point: [centeredPoint.x, centeredPoint.y] }
    }
  }

  private createLineOp(
    command: PathCommand,
    isRelative: boolean,
    transform: Transform
  ): KclOperation {
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

    // First get absolute positions for the end point
    let absoluteEnd: Point

    if (isRelative) {
      absoluteEnd = {
        x: this.currentPoint.x + x,
        y: this.currentPoint.y + y
      }
    } else {
      absoluteEnd = { x, y }
    }

    // Transform both the start and end points
    const transformedStart = transform.transformPoint(this.currentPoint)
    const transformedEnd = transform.transformPoint(absoluteEnd)

    // Calculate relative position from transformed points for KCL output
    const relativeEnd = {
      x: transformedEnd.x - transformedStart.x,
      y: transformedEnd.y - transformedStart.y
    }

    // Store untransformed absolute position for next command
    this.currentPoint = absoluteEnd

    return {
      type: KclOperationType.Line,
      params: { point: [relativeEnd.x, relativeEnd.y] }
    }
  }

  private createQuadraticBezierOp(
    command: PathCommand,
    isRelative: boolean,
    transform: Transform
  ): KclOperation {
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataQuadraticBezierCommands
    const [x1, y1, x, y] = command.parameters

    // 1: Transform the points after converting to absolute coordinates but before the
    //    quadratic-to-cubic conversion.
    //
    // 2: Do the quadratic-to-cubic conversion using the transformed points.
    //
    // 3: Calculate relative positions from the transformed points.
    //
    // 4: Store untransformed absolute positions for state tracking.

    // First get absolute positions for all points.
    let absoluteControl1: Point, absoluteEnd: Point

    if (isRelative) {
      absoluteControl1 = {
        x: this.currentPoint.x + x1,
        y: this.currentPoint.y + y1
      }
      absoluteEnd = {
        x: this.currentPoint.x + x,
        y: this.currentPoint.y + y
      }
    } else {
      absoluteControl1 = { x: x1, y: y1 }
      absoluteEnd = { x, y }
    }

    // Transform all the absolute points.
    const transformedStart = transform.transformPoint(this.currentPoint)
    const transformedControl1 = transform.transformPoint(absoluteControl1)
    const transformedEnd = transform.transformPoint(absoluteEnd)

    // Convert quadratic to cubic Bézier control points for KCL.
    // See: https://stackoverflow.com/questions/3162645/convert-a-quadratic-bezier-to-a-cubic-one
    const cp1x = transformedStart.x + (2 / 3) * (transformedControl1.x - transformedStart.x)
    const cp1y = transformedStart.y + (2 / 3) * (transformedControl1.y - transformedStart.y)

    const cp2x = transformedEnd.x + (2 / 3) * (transformedControl1.x - transformedEnd.x)
    const cp2y = transformedEnd.y + (2 / 3) * (transformedControl1.y - transformedEnd.y)

    // Convert to relative positions for KCL output.
    const relativeControl1 = {
      x: cp1x - transformedStart.x,
      y: cp1y - transformedStart.y
    }
    const relativeControl2 = {
      x: cp2x - transformedStart.x,
      y: cp2y - transformedStart.y
    }
    const relativeEnd = {
      x: transformedEnd.x - transformedStart.x,
      y: transformedEnd.y - transformedStart.y
    }

    // Store untransformed absolute positions for next command.
    this.previousControlPoint = absoluteControl1
    this.currentPoint = absoluteEnd

    return {
      type: KclOperationType.BezierCurve,
      params: {
        control1: [relativeControl1.x, relativeControl1.y],
        control2: [relativeControl2.x, relativeControl2.y],
        to: [relativeEnd.x, relativeEnd.y]
      }
    }
  }

  private createCubicBezierOp(
    command: PathCommand,
    isRelative: boolean,
    transform: Transform
  ): KclOperation {
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataLinetoCommands
    const [x1, y1, x2, y2, x, y] = command.parameters

    // 1: Transform the points after converting to absolute coordinates.
    //
    // 2: Calculate relative positions from the transformed points.
    //
    // 3: Store untransformed absolute positions for state tracking.

    // First get absolute positions for all points.
    let absoluteControl1: Point, absoluteControl2: Point, absoluteEnd: Point

    if (isRelative) {
      absoluteControl1 = {
        x: this.currentPoint.x + x1,
        y: this.currentPoint.y + y1
      }
      absoluteControl2 = {
        x: this.currentPoint.x + x2,
        y: this.currentPoint.y + y2
      }
      absoluteEnd = {
        x: this.currentPoint.x + x,
        y: this.currentPoint.y + y
      }
    } else {
      absoluteControl1 = { x: x1, y: y1 }
      absoluteControl2 = { x: x2, y: y2 }
      absoluteEnd = { x, y }
    }

    // Transform all the absolute points.
    const transformedStart = transform.transformPoint(this.currentPoint)
    const transformedControl1 = transform.transformPoint(absoluteControl1)
    const transformedControl2 = transform.transformPoint(absoluteControl2)
    const transformedEnd = transform.transformPoint(absoluteEnd)

    // Convert to relative positions for KCL output.
    const relativeControl1 = {
      x: transformedControl1.x - transformedStart.x,
      y: transformedControl1.y - transformedStart.y
    }
    const relativeControl2 = {
      x: transformedControl2.x - transformedStart.x,
      y: transformedControl2.y - transformedStart.y
    }
    const relativeEnd = {
      x: transformedEnd.x - transformedStart.x,
      y: transformedEnd.y - transformedStart.y
    }

    // Store untransformed absolute positions for next command.
    this.previousControlPoint = absoluteControl2
    this.currentPoint = absoluteEnd

    return {
      type: KclOperationType.BezierCurve,
      params: {
        control1: [relativeControl1.x, relativeControl1.y],
        control2: [relativeControl2.x, relativeControl2.y],
        to: [relativeEnd.x, relativeEnd.y]
      }
    }
  }

  private createQuadraticBezierSmoothOp(
    command: PathCommand,
    isRelative: boolean,
    transform: Transform
  ): KclOperation {
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataQuadraticBezierCommands
    const [x, y] = command.parameters

    // 1: Transform the points after converting to absolute coordinates but before the
    //    quadratic-to-cubic conversion.
    //
    // 2: Calculate the reflected control point before transforms.
    //
    // 3: Do the quadratic-to-cubic conversion using the transformed points.
    //
    // 4: Calculate relative positions from the transformed points.
    //
    // 5: Store untransformed absolute positions for state tracking.

    // First get absolute positions for all points.
    const reflectedPoint = this.calculateReflectedControlPoint()
    let absoluteControl1: Point = reflectedPoint
    let absoluteEnd: Point

    if (isRelative) {
      absoluteEnd = {
        x: this.currentPoint.x + x,
        y: this.currentPoint.y + y
      }
    } else {
      absoluteEnd = { x, y }
    }

    // Transform all the absolute points.
    const transformedStart = transform.transformPoint(this.currentPoint)
    const transformedControl1 = transform.transformPoint(absoluteControl1)
    const transformedEnd = transform.transformPoint(absoluteEnd)

    // Convert quadratic to cubic Bézier control points for KCL.
    const cp1x = transformedStart.x + (2 / 3) * (transformedControl1.x - transformedStart.x)
    const cp1y = transformedStart.y + (2 / 3) * (transformedControl1.y - transformedStart.y)

    const cp2x = transformedEnd.x + (2 / 3) * (transformedControl1.x - transformedEnd.x)
    const cp2y = transformedEnd.y + (2 / 3) * (transformedControl1.y - transformedEnd.y)

    // Convert to relative positions for KCL output.
    const relativeControl1 = {
      x: cp1x - transformedStart.x,
      y: cp1y - transformedStart.y
    }
    const relativeControl2 = {
      x: cp2x - transformedStart.x,
      y: cp2y - transformedStart.y
    }
    const relativeEnd = {
      x: transformedEnd.x - transformedStart.x,
      y: transformedEnd.y - transformedStart.y
    }

    // Store untransformed absolute positions for next command.
    this.previousControlPoint = absoluteControl1
    this.currentPoint = absoluteEnd

    return {
      type: KclOperationType.BezierCurve,
      params: {
        control1: [relativeControl1.x, relativeControl1.y],
        control2: [relativeControl2.x, relativeControl2.y],
        to: [relativeEnd.x, relativeEnd.y]
      }
    }
  }

  private createCubicBezierSmoothOp(
    command: PathCommand,
    isRelative: boolean,
    transform: Transform
  ): KclOperation {
    // See: https://www.w3.org/TR/SVG11/paths.html#PathDataCubicBezierCommands
    const [x2, y2, x, y] = command.parameters

    // 1: Transform the points after converting to absolute coordinates.
    //
    // 2: Calculate the reflected control point before transforms.
    //
    // 3: Calculate relative positions from the transformed points.
    //
    // 4: Store untransformed absolute positions for state tracking.

    // First get absolute positions for all points.
    const reflectedPoint = this.calculateReflectedControlPoint()
    let absoluteControl1: Point = reflectedPoint
    let absoluteControl2: Point, absoluteEnd: Point

    if (isRelative) {
      absoluteControl2 = {
        x: this.currentPoint.x + x2,
        y: this.currentPoint.y + y2
      }
      absoluteEnd = {
        x: this.currentPoint.x + x,
        y: this.currentPoint.y + y
      }
    } else {
      absoluteControl2 = { x: x2, y: y2 }
      absoluteEnd = { x, y }
    }

    // Transform all the absolute points.
    const transformedStart = transform.transformPoint(this.currentPoint)
    const transformedControl1 = transform.transformPoint(absoluteControl1)
    const transformedControl2 = transform.transformPoint(absoluteControl2)
    const transformedEnd = transform.transformPoint(absoluteEnd)

    // Convert to relative positions for KCL output.
    const relativeControl1 = {
      x: transformedControl1.x - transformedStart.x,
      y: transformedControl1.y - transformedStart.y
    }
    const relativeControl2 = {
      x: transformedControl2.x - transformedStart.x,
      y: transformedControl2.y - transformedStart.y
    }
    const relativeEnd = {
      x: transformedEnd.x - transformedStart.x,
      y: transformedEnd.y - transformedStart.y
    }

    // Store untransformed absolute positions for next command.
    this.previousControlPoint = absoluteControl2
    this.currentPoint = absoluteEnd

    return {
      type: KclOperationType.BezierCurve,
      params: {
        control1: [relativeControl1.x, relativeControl1.y],
        control2: [relativeControl2.x, relativeControl2.y],
        to: [relativeEnd.x, relativeEnd.y]
      }
    }
  }
  // Command conversion methods.
  // --------------------------------------------------
  private convertPathCommandsToKclOps(
    commands: PathCommand[],
    transform: Transform
  ): KclOperation[] {
    const operations: KclOperation[] = []
    this.previousControlPoint = null
    this.currentPoint = { x: 0, y: 0 }

    commands.forEach((command, index) => {
      // Handle first command: start sketch.
      if (index === 0) {
        operations.push(this.createNewSketchOp(command, transform))
      }

      // Otherwise, command type determines operation.
      switch (command.type) {
        // Lines.
        case PathCommandType.LineAbsolute:
        case PathCommandType.HorizontalLineAbsolute:
        case PathCommandType.VerticalLineAbsolute:
          operations.push(this.createLineOp(command, false, transform))
          break
        case PathCommandType.LineRelative:
        case PathCommandType.HorizontalLineRelative:
        case PathCommandType.VerticalLineRelative:
          operations.push(this.createLineOp(command, true, transform))
          break

        // Quadratic beziers.
        case PathCommandType.QuadraticBezierAbsolute:
          operations.push(this.createQuadraticBezierOp(command, false, transform))
          break
        case PathCommandType.QuadraticBezierRelative:
          operations.push(this.createQuadraticBezierOp(command, true, transform))
          break
        case PathCommandType.QuadraticBezierSmoothAbsolute:
          operations.push(this.createQuadraticBezierSmoothOp(command, false, transform))
          break
        case PathCommandType.QuadraticBezierSmoothRelative:
          operations.push(this.createQuadraticBezierSmoothOp(command, true, transform))
          break

        // Cubic beziers.
        case PathCommandType.CubicBezierAbsolute:
          operations.push(this.createCubicBezierOp(command, false, transform))
          break
        case PathCommandType.CubicBezierRelative:
          operations.push(this.createCubicBezierOp(command, true, transform))
          break
        case PathCommandType.CubicBezierSmoothAbsolute:
          operations.push(this.createCubicBezierSmoothOp(command, false, transform))
          break
        case PathCommandType.CubicBezierSmoothRelative:
          operations.push(this.createCubicBezierSmoothOp(command, true, transform))
          break

        // Stops.
        case PathCommandType.StopAbsolute:
        case PathCommandType.StopRelative:
          operations.push({ type: KclOperationType.Close, params: null })
          break
      }
    })

    if (!operations.some((op) => op.type === KclOperationType.Close)) {
      operations.push({ type: KclOperationType.Close, params: null })
    }

    return operations
  }

  private convertPathToKclOps(path: PathElement): KclOperation[] {
    const operations: KclOperation[] = []
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
          type: KclOperationType.Hole,
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
            type: KclOperationType.Hole,
            params: { operations: subpathOps }
          })
        }
      })
    }

    return operations
  }

  private convertRectangleToKclOps(rect: RectangleElement): KclOperation[] {
    const operations: KclOperation[] = []
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
        { type: KclOperationType.StartSketch, params: { point: points[0] } },
        ...points.slice(1).map((point) => ({
          type: KclOperationType.Line,
          params: { point }
        })),
        { type: KclOperationType.Close, params: null }
      )
    } else {
      // Rounded rectangle.
      const effectiveRx = rx || ry || 0
      const effectiveRy = ry || rx || 0

      const startPoint: [number, number] = [x + effectiveRx, y]
      operations.push({ type: KclOperationType.StartSketch, params: { point: startPoint } })

      // Top edge and top-right corner.
      operations.push(
        { type: KclOperationType.Line, params: { point: [width - effectiveRx, 0] } },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRx, offset: 90 } }
      )

      // Right edge and bottom-right corner.
      operations.push(
        {
          type: KclOperationType.Line,
          params: { point: [0, -(height - effectiveRy)] }
        },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRx, offset: 90 } }
      )

      // Bottom edge and bottom-left corner.
      operations.push(
        { type: KclOperationType.Line, params: { point: [-(width - effectiveRx), 0] } },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRx, offset: 90 } }
      )

      // Left edge and top-left corner.
      operations.push(
        { type: KclOperationType.Line, params: { point: [0, height - effectiveRy] } },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRx, offset: 90 } },
        { type: KclOperationType.Close, params: null }
      )
    }

    return operations
  }

  private convertCircleToKclOps(circle: CircleElement): KclOperation[] {
    const { center, radius } = circle

    // Chain together new sketch and circle operations.
    return [
      {
        type: KclOperationType.StartSketchOn,
        params: { plane: Plane3D.XY }
      },
      {
        type: KclOperationType.Circle,
        params: { radius, x: center.x, y: center.y }
      }
    ]
  }

  private convertLineToKclOps(line: LineElement): KclOperation[] {
    this.currentPoint = line.end

    // Lines are relative in our KCL call, but absolute in SVG.
    const deltaX = line.end.x - line.start.x
    const deltaY = line.end.y - line.start.y

    return [
      {
        type: KclOperationType.StartSketch,
        params: { point: [line.start.x, line.start.y] }
      },
      {
        type: KclOperationType.Line,
        params: { point: [deltaX, deltaY] }
      }
    ]
  }

  private convertPolylineToKclOps(polyline: PolylineElement): KclOperation[] {
    if (polyline.points.length < 2) {
      throw new ConverterError('Polyline must have at least 2 points')
    }

    const operations: KclOperation[] = []
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
      type: KclOperationType.StartSketch,
      params: { point: [points[0].x, points[0].y] }
    })

    diffs.forEach((point) => {
      operations.push({
        type: KclOperationType.Line,
        params: { point: [point.dx, point.dy] }
      })
    })

    return operations
  }

  private convertPolygonToKclOps(polygon: PolygonElement): KclOperation[] {
    if (polygon.points.length < 3) {
      throw new ConverterError('Polygon must have at least 3 points')
    }

    const operations: KclOperation[] = []
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
      type: KclOperationType.StartSketch,
      params: { point: [points[0].x, points[0].y] }
    })

    diffs.forEach((point) => {
      operations.push({
        type: KclOperationType.Line,
        params: { point: [point.dx, point.dy] }
      })
    })

    operations.push({ type: KclOperationType.Close, params: null })
    return operations
  }

  public convertElement(elements: Element[], targetElement: Element): KclOperation[] {
    if (targetElement.type === ElementType.Group) {
      // For groups, just recurse to children without applying transforms.
      const group = targetElement as GroupElement
      return group.children.flatMap((child) => this.convertElement(elements, child))
    }

    // Only get combined transform when we hit a leaf node (renderable non-group element).
    const combinedTransform = getCombinedTransform(elements, targetElement)

    // Store the original transform.
    const originalTransform = targetElement.transform

    // Temporarily set the element's transform to the combined transform.
    targetElement.transform = combinedTransform

    let opList: KclOperation[] = []

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
      default: {
        const exhaustiveCheck: never = targetElement
        throw new ConverterError(`Unsupported element type: ${(targetElement as any).type}`)
      }
    }

    // Restore the original transform
    targetElement.transform = originalTransform

    return opList
  }
}
