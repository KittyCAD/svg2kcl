import { PathFragment } from '../paths/fragments/fragment'
import { PathProcessor } from '../paths/path_processor'
import { Plane3D, Point, ViewBox } from '../types/base'
import {
  CircleElement,
  Element,
  ElementType,
  LineElement,
  PathElement,
  PolygonElement,
  PolylineElement,
  RectangleElement
} from '../types/elements'
import { PathFragmentType } from '../types/fragments'
import { KclOperation, KclOperationType, KclOptions } from '../types/kcl'
import { PathCommand, PathCommandType } from '../types/paths'
import { getCombinedTransform, Transform } from '../utils/transform'

// TODO: Improve handling of relative coordinates, particularly prior to `close` calls.
// Absolute coordinates allow us to get away from rounding/floating point issues.
// In effect, we were seeing tolerance stackup here with relative coordinates that could
// yield degenerate geometry, with closing lines intersecting with but overshooting the
// start point.
const USE_ABSOLUTE_LINE_COORDS = true

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
  private readonly options: KclOptions

  constructor(options: KclOptions = {}, viewBox: ViewBox) {
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
    this.currentPoint = command.endPositionAbsolute

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

    // First get absolute positions for the end point.
    let absoluteEnd: Point

    if (isRelative) {
      absoluteEnd = {
        x: this.currentPoint.x + x,
        y: this.currentPoint.y + y
      }
    } else {
      absoluteEnd = { x, y }
    }

    // Store untransformed absolute position for next command.
    this.currentPoint = absoluteEnd

    // Transform both the start and end points.
    const transformedStart = transform.transformPoint(this.currentPoint)
    const transformedEnd = transform.transformPoint(absoluteEnd)

    if (USE_ABSOLUTE_LINE_COORDS) {
      // Apply centering here.
      const centeredEnd = this.centerPoint(transformedEnd)
      return {
        type: KclOperationType.LineAbsolute,
        params: { point: [centeredEnd.x, centeredEnd.y] }
      }
    } else {
      // Calculate relative position from transformed points for KCL output.
      const relativeEnd = {
        x: transformedEnd.x - transformedStart.x,
        y: transformedEnd.y - transformedStart.y
      }

      return {
        type: KclOperationType.Line,
        params: { point: [relativeEnd.x, relativeEnd.y] }
      }
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
      // Call close.
      operations.push({ type: KclOperationType.Close, params: null })
    }

    return operations
  }

  private convertPathToKclOps(path: PathElement): KclOperation[] {
    // Process path to regions and fragments.
    const processor = new PathProcessor(path)
    const processedPath = processor.processPath()

    const operations: KclOperation[] = []

    for (const region of processedPath.regions) {
      // Get fragments for this region, applying reversals as needed
      const regionFragments: PathFragment[] = []

      for (let i = 0; i < region.fragmentIds.length; i++) {
        const id = region.fragmentIds[i]
        const fragment = processedPath.getFragment(id)

        if (fragment) {
          if (region.fragmentReversed && region.fragmentReversed[i]) {
            // Create a reversed copy of the fragment
            const reversedFragment: PathFragment = {
              ...fragment,
              start: { ...fragment.end },
              end: { ...fragment.start },
              getNextFragmentId: fragment.getNextFragmentId
            }

            // Handle control points based on curve type
            if (fragment.type === PathFragmentType.Quad) {
              // For quadratic curves, keep the same control point
              // The control point position doesn't change when reversing a quadratic curve
              reversedFragment.control1 = fragment.control1 ? { ...fragment.control1 } : undefined
            } else if (fragment.type === PathFragmentType.Cubic) {
              // For cubic curves, swap control points
              reversedFragment.control1 = fragment.control2 ? { ...fragment.control2 } : undefined
              reversedFragment.control2 = fragment.control1 ? { ...fragment.control1 } : undefined
            }

            regionFragments.push(reversedFragment)
          } else {
            // Use the original fragment
            regionFragments.push(fragment)
          }
        }
      }

      // Convert the correctly oriented fragments to commands
      const regionCommands = processor.convertFragmentsToCommands(regionFragments)

      // Convert commands to KCL operations
      const kclOps = this.convertPathCommandsToKclOps(regionCommands, path.transform!)

      if (region.isHole) {
        // Holes should be wrapped inside a `hole` operation.
        if (operations.length > 0) {
          operations.push({ type: KclOperationType.Hole, params: { operations: kclOps } })
        } else {
          console.warn(`Orphan hole detected: ${region.id}`)
        }
      } else {
        // Parent regions are added normally.
        operations.push(...kclOps)
      }
    }

    return operations
  }

  private convertRectangleToKclOps(rect: RectangleElement): KclOperation[] {
    const operations: KclOperation[] = []
    const { x, y, width, height, rx, ry } = rect

    // If both rx and ry are specified and they're different, throw an error.
    // We need elliptical arcs to handle this case.
    if (rx !== undefined && ry !== undefined && rx !== ry) {
      throw new Error('KCL conversion does not support rectangles with different rx and ry values')
    }

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
      const effectiveRadius = rx || ry || 0

      const startPoint: [number, number] = [x + effectiveRadius, y]
      operations.push({ type: KclOperationType.StartSketch, params: { point: startPoint } })

      // Top edge and top-right corner.
      operations.push(
        { type: KclOperationType.Line, params: { point: [width - 2 * effectiveRadius, 0] } },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRadius, offset: -90 } }
      )

      // Right edge and bottom-right corner.
      operations.push(
        {
          type: KclOperationType.Line,
          params: { point: [0, height - 2 * effectiveRadius] }
        },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRadius, offset: -90 } }
      )

      // Bottom edge and bottom-left corner.
      operations.push(
        { type: KclOperationType.Line, params: { point: [-(width - 2 * effectiveRadius), 0] } },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRadius, offset: -90 } }
      )

      // Left edge and top-left corner.
      operations.push(
        { type: KclOperationType.Line, params: { point: [0, -(height - 2 * effectiveRadius)] } },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRadius, offset: -90 } },
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

  public convertElement(element: Element): KclOperation[] {
    switch (element.type) {
      case ElementType.Path:
        return this.convertPathToKclOps(element as PathElement)
      case ElementType.Rectangle:
        return this.convertRectangleToKclOps(element as RectangleElement)
      case ElementType.Circle:
        return this.convertCircleToKclOps(element as CircleElement)
      case ElementType.Line:
        return this.convertLineToKclOps(element as LineElement)
      case ElementType.Polyline:
        return this.convertPolylineToKclOps(element as PolylineElement)
      case ElementType.Polygon:
        return this.convertPolygonToKclOps(element as PolygonElement)
      case ElementType.Group:
        // Groups should never reach here since flattening happens in the writer.
        return []
      default: {
        const exhaustiveCheck: never = element
        throw new ConverterError(`Unsupported element type: ${(element as any).type}`)
      }
    }
  }

  private flattenElements(elements: Element[]): Element[] {
    // Flattens elements and combines their transforms correctly.
    const flattened: Element[] = []

    const processElement = (element: Element) => {
      if (element.type === ElementType.Group) {
        // Process each child of the group.
        element.children.forEach((child) => processElement(child))
      } else {
        // Get combined transform using utility function.
        const combinedTransform = getCombinedTransform(elements, element)

        // Add the element with its combined transform.
        flattened.push({
          ...element,
          transform: combinedTransform
        })
      }
    }

    // Process all root elements.
    elements.forEach((element) => processElement(element))
    return flattened
  }

  public convertElements(elements: Element[]): KclOperation[][] {
    const output: KclOperation[][] = []
    const flatElements = this.flattenElements(elements)

    for (const element of flatElements) {
      const operations = this.convertElement(element)
      if (operations.length > 0) {
        output.push(operations)
      }
    }

    return output
  }
}
