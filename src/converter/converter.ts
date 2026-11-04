import { PathFragment } from '../paths/fragments/fragment'
import { PathProcessor, ProcessedPath } from '../paths/path_processor'
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
const FACE_DISCOVERY_FAILED = 'Face discovery failed'
const CIRCLE_SAMPLE_COUNT_PER_CURVE = 9
const CIRCLE_MAX_RELATIVE_ERROR = 0.045
const CIRCLE_MAX_ABSOLUTE_ERROR = 0.75
const CIRCLE_RMS_RELATIVE_ERROR = 0.025
const CIRCLE_MIN_ANGLE_COVERAGE = Math.PI * 1.75

type CubicPoints = {
  control1: Point
  control2: Point
  end: Point
  start: Point
}

type CircleCandidate = {
  center: Point
  radius: number
  samplePoints: Point[]
}

type ProfileSubpath = {
  circle: CircleCandidate | null
  commands: PathCommand[]
}

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
        // X supplied. For relative commands this is an X offset; for absolute
        // commands this is an absolute X and Y stays at the current Y.
        x = command.parameters[0]
        y = 0
        break
      case PathCommandType.VerticalLineAbsolute:
      case PathCommandType.VerticalLineRelative:
        // Y supplied. For relative commands this is a Y offset; for absolute
        // commands this is an absolute Y and X stays at the current X.
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
    } else if (command.type === PathCommandType.HorizontalLineAbsolute) {
      absoluteEnd = {
        x,
        y: this.currentPoint.y
      }
    } else if (command.type === PathCommandType.VerticalLineAbsolute) {
      absoluteEnd = {
        x: this.currentPoint.x,
        y
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
        end: [relativeEnd.x, relativeEnd.y]
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
        end: [relativeEnd.x, relativeEnd.y]
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
        end: [relativeEnd.x, relativeEnd.y]
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
        end: [relativeEnd.x, relativeEnd.y]
      }
    }
  }

  private isMoveCommand(command: PathCommand): boolean {
    return (
      command.type === PathCommandType.MoveAbsolute || command.type === PathCommandType.MoveRelative
    )
  }

  private isStopCommand(command: PathCommand): boolean {
    return (
      command.type === PathCommandType.StopAbsolute || command.type === PathCommandType.StopRelative
    )
  }

  private isCubicCommand(command: PathCommand): boolean {
    return (
      command.type === PathCommandType.CubicBezierAbsolute ||
      command.type === PathCommandType.CubicBezierRelative ||
      command.type === PathCommandType.CubicBezierSmoothAbsolute ||
      command.type === PathCommandType.CubicBezierSmoothRelative
    )
  }

  private splitPathCommands(commands: PathCommand[]): PathCommand[][] {
    const subpaths: PathCommand[][] = []
    let currentSubpath: PathCommand[] = []

    for (const command of commands) {
      if (this.isMoveCommand(command) && currentSubpath.length > 0) {
        subpaths.push(currentSubpath)
        currentSubpath = []
      }

      currentSubpath.push(command)

      if (this.isStopCommand(command)) {
        subpaths.push(currentSubpath)
        currentSubpath = []
      }
    }

    if (currentSubpath.length > 0) {
      subpaths.push(currentSubpath)
    }

    return subpaths
  }

  private createCircleOps(circle: CircleCandidate): KclOperation[] {
    return [
      {
        type: KclOperationType.StartSketchOn,
        params: { plane: Plane3D.XY }
      },
      {
        type: KclOperationType.Circle,
        params: {
          radius: circle.radius,
          x: circle.center.x,
          y: circle.center.y
        }
      }
    ]
  }

  private convertPathCommandsToProfileKclOps(
    commands: PathCommand[],
    transform: Transform,
    closeOpenPath = true
  ): KclOperation[] {
    const subpaths = this.splitPathCommands(commands).map((subpathCommands): ProfileSubpath => {
      return {
        circle: this.detectCircularSubpath(subpathCommands, transform),
        commands: subpathCommands
      }
    })

    this.snapConcentricCircles(subpaths)

    return subpaths.flatMap((subpath) => {
      if (subpath.circle) {
        return this.createCircleOps(subpath.circle)
      }

      return this.convertPathCommandsToKclOps(subpath.commands, transform, closeOpenPath)
    })
  }

  private detectCircularSubpath(
    commands: PathCommand[],
    transform: Transform
  ): CircleCandidate | null {
    if (commands.length < 5 || !this.isMoveCommand(commands[0])) {
      return null
    }

    const drawingCommands = commands.filter((command) => {
      return !this.isMoveCommand(command) && !this.isStopCommand(command)
    })

    if (drawingCommands.length < 3 || !drawingCommands.every((command) => this.isCubicCommand(command))) {
      return null
    }

    const firstPoint = commands[0].endPositionAbsolute
    const lastDrawingCommand = drawingCommands[drawingCommands.length - 1]
    const lastPoint = lastDrawingCommand.endPositionAbsolute
    if (Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) > 1e-3) {
      return null
    }

    const samples: Point[] = []
    let previousControlPoint: Point | null = null

    for (const command of drawingCommands) {
      const cubicPoints = this.getAbsoluteCubicPoints(command, previousControlPoint)
      if (!cubicPoints) {
        return null
      }

      previousControlPoint = cubicPoints.control2

      for (let sampleIndex = 0; sampleIndex < CIRCLE_SAMPLE_COUNT_PER_CURVE; sampleIndex++) {
        if (samples.length > 0 && sampleIndex === 0) {
          continue
        }

        const t = sampleIndex / (CIRCLE_SAMPLE_COUNT_PER_CURVE - 1)
        const sample = this.getCubicPoint(cubicPoints, t)
        samples.push(this.transformAndCenterPoint(sample, transform))
      }
    }

    if (samples.length < 12) {
      return null
    }

    return this.fitCircleToSamples(samples)
  }

  private getAbsoluteCubicPoints(
    command: PathCommand,
    previousControlPoint: Point | null
  ): CubicPoints | null {
    const start = command.startPositionAbsolute
    const parameters = command.parameters

    switch (command.type) {
      case PathCommandType.CubicBezierAbsolute:
        return {
          control1: { x: parameters[0], y: parameters[1] },
          control2: { x: parameters[2], y: parameters[3] },
          end: { x: parameters[4], y: parameters[5] },
          start
        }

      case PathCommandType.CubicBezierRelative:
        return {
          control1: { x: start.x + parameters[0], y: start.y + parameters[1] },
          control2: { x: start.x + parameters[2], y: start.y + parameters[3] },
          end: { x: start.x + parameters[4], y: start.y + parameters[5] },
          start
        }

      case PathCommandType.CubicBezierSmoothAbsolute:
        return {
          control1: this.reflectControlPoint(start, previousControlPoint),
          control2: { x: parameters[0], y: parameters[1] },
          end: { x: parameters[2], y: parameters[3] },
          start
        }

      case PathCommandType.CubicBezierSmoothRelative:
        return {
          control1: this.reflectControlPoint(start, previousControlPoint),
          control2: { x: start.x + parameters[0], y: start.y + parameters[1] },
          end: { x: start.x + parameters[2], y: start.y + parameters[3] },
          start
        }

      default:
        return null
    }
  }

  private reflectControlPoint(point: Point, controlPoint: Point | null): Point {
    if (!controlPoint) {
      return point
    }

    return {
      x: 2 * point.x - controlPoint.x,
      y: 2 * point.y - controlPoint.y
    }
  }

  private getCubicPoint(cubicPoints: CubicPoints, t: number): Point {
    const mt = 1 - t
    return {
      x:
        mt ** 3 * cubicPoints.start.x +
        3 * mt ** 2 * t * cubicPoints.control1.x +
        3 * mt * t ** 2 * cubicPoints.control2.x +
        t ** 3 * cubicPoints.end.x,
      y:
        mt ** 3 * cubicPoints.start.y +
        3 * mt ** 2 * t * cubicPoints.control1.y +
        3 * mt * t ** 2 * cubicPoints.control2.y +
        t ** 3 * cubicPoints.end.y
    }
  }

  private transformAndCenterPoint(point: Point, transform: Transform): Point {
    return this.centerPoint(transform.transformPoint(point))
  }

  private fitCircleToSamples(samples: Point[]): CircleCandidate | null {
    const bounds = this.getBounds(samples)
    const width = bounds.xMax - bounds.xMin
    const height = bounds.yMax - bounds.yMin
    if (width <= 1e-6 || height <= 1e-6) {
      return null
    }

    const aspectRatio = width / height
    if (aspectRatio < 0.85 || aspectRatio > 1.15) {
      return null
    }

    const fittedCircle = this.solveCircleLeastSquares(samples)
    if (!fittedCircle) {
      return null
    }

    const distances = samples.map((point) => {
      return Math.hypot(point.x - fittedCircle.center.x, point.y - fittedCircle.center.y)
    })
    const maxError = Math.max(
      ...distances.map((distance) => Math.abs(distance - fittedCircle.radius))
    )
    const squaredErrorSum = distances.reduce((sum, distance) => {
      return sum + (distance - fittedCircle.radius) ** 2
    }, 0)
    const rmsError = Math.sqrt(squaredErrorSum / distances.length)
    const allowedMaxError = Math.max(CIRCLE_MAX_ABSOLUTE_ERROR, fittedCircle.radius * CIRCLE_MAX_RELATIVE_ERROR)
    const allowedRmsError = fittedCircle.radius * CIRCLE_RMS_RELATIVE_ERROR

    if (maxError > allowedMaxError || rmsError > allowedRmsError) {
      return null
    }

    if (this.getCircularAngleCoverage(samples, fittedCircle.center) < CIRCLE_MIN_ANGLE_COVERAGE) {
      return null
    }

    return {
      center: fittedCircle.center,
      radius: fittedCircle.radius,
      samplePoints: samples
    }
  }

  private getBounds(points: Point[]): { xMax: number; xMin: number; yMax: number; yMin: number } {
    return points.reduce(
      (bounds, point) => {
        return {
          xMax: Math.max(bounds.xMax, point.x),
          xMin: Math.min(bounds.xMin, point.x),
          yMax: Math.max(bounds.yMax, point.y),
          yMin: Math.min(bounds.yMin, point.y)
        }
      },
      {
        xMax: Number.NEGATIVE_INFINITY,
        xMin: Number.POSITIVE_INFINITY,
        yMax: Number.NEGATIVE_INFINITY,
        yMin: Number.POSITIVE_INFINITY
      }
    )
  }

  private solveCircleLeastSquares(samples: Point[]): { center: Point; radius: number } | null {
    const matrix = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ]
    const vector = [0, 0, 0]

    for (const point of samples) {
      const row = [point.x, point.y, 1]
      const target = -(point.x ** 2 + point.y ** 2)

      for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
        vector[rowIndex] += row[rowIndex] * target
        for (let columnIndex = 0; columnIndex < 3; columnIndex++) {
          matrix[rowIndex][columnIndex] += row[rowIndex] * row[columnIndex]
        }
      }
    }

    const solution = this.solveLinearSystem3x3(matrix, vector)
    if (!solution) {
      return null
    }

    const [d, e, f] = solution
    const center = { x: -d / 2, y: -e / 2 }
    const radiusSquared = center.x ** 2 + center.y ** 2 - f
    if (radiusSquared <= 0) {
      return null
    }

    return {
      center,
      radius: Math.sqrt(radiusSquared)
    }
  }

  private solveLinearSystem3x3(matrix: number[][], vector: number[]): [number, number, number] | null {
    const augmented = matrix.map((row, index) => [...row, vector[index]])

    for (let pivotIndex = 0; pivotIndex < 3; pivotIndex++) {
      let pivotRow = pivotIndex
      for (let rowIndex = pivotIndex + 1; rowIndex < 3; rowIndex++) {
        if (Math.abs(augmented[rowIndex][pivotIndex]) > Math.abs(augmented[pivotRow][pivotIndex])) {
          pivotRow = rowIndex
        }
      }

      if (Math.abs(augmented[pivotRow][pivotIndex]) < 1e-9) {
        return null
      }

      if (pivotRow !== pivotIndex) {
        ;[augmented[pivotIndex], augmented[pivotRow]] = [augmented[pivotRow], augmented[pivotIndex]]
      }

      const pivot = augmented[pivotIndex][pivotIndex]
      for (let columnIndex = pivotIndex; columnIndex < 4; columnIndex++) {
        augmented[pivotIndex][columnIndex] /= pivot
      }

      for (let rowIndex = 0; rowIndex < 3; rowIndex++) {
        if (rowIndex === pivotIndex) {
          continue
        }

        const factor = augmented[rowIndex][pivotIndex]
        for (let columnIndex = pivotIndex; columnIndex < 4; columnIndex++) {
          augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex]
        }
      }
    }

    return [augmented[0][3], augmented[1][3], augmented[2][3]]
  }

  private getCircularAngleCoverage(samples: Point[], center: Point): number {
    const angles = samples
      .map((point) => Math.atan2(point.y - center.y, point.x - center.x))
      .sort((a, b) => a - b)

    let maxGap = 0
    for (let index = 0; index < angles.length; index++) {
      const current = angles[index]
      const next = index === angles.length - 1 ? angles[0] + Math.PI * 2 : angles[index + 1]
      maxGap = Math.max(maxGap, next - current)
    }

    return Math.PI * 2 - maxGap
  }

  private snapConcentricCircles(subpaths: ProfileSubpath[]): void {
    const circles = subpaths.flatMap((subpath) => {
      return subpath.circle ? [subpath.circle] : []
    })
    const visited = new Set<CircleCandidate>()

    for (const circle of circles) {
      if (visited.has(circle)) {
        continue
      }

      const group = circles.filter((candidate) => {
        return !visited.has(candidate) && this.shouldShareCircleCenter(circle, candidate)
      })

      for (const candidate of group) {
        visited.add(candidate)
      }

      if (group.length < 2) {
        continue
      }

      const totalWeight = group.reduce((sum, candidate) => sum + candidate.radius, 0)
      const sharedCenter = group.reduce(
        (center, candidate) => {
          return {
            x: center.x + (candidate.center.x * candidate.radius) / totalWeight,
            y: center.y + (candidate.center.y * candidate.radius) / totalWeight
          }
        },
        { x: 0, y: 0 }
      )

      for (const candidate of group) {
        candidate.center = sharedCenter
        candidate.radius = this.getAverageRadius(candidate.samplePoints, sharedCenter)
      }
    }
  }

  private shouldShareCircleCenter(circleA: CircleCandidate, circleB: CircleCandidate): boolean {
    const centerDistance = Math.hypot(circleA.center.x - circleB.center.x, circleA.center.y - circleB.center.y)
    const minRadius = Math.min(circleA.radius, circleB.radius)
    const maxRadius = Math.max(circleA.radius, circleB.radius)
    const tolerance = Math.max(0.8, Math.min(2, minRadius * 0.05))
    const isNested = centerDistance + minRadius <= maxRadius + tolerance

    return centerDistance <= tolerance && isNested
  }

  private getAverageRadius(samples: Point[], center: Point): number {
    const radiusSum = samples.reduce((sum, point) => {
      return sum + Math.hypot(point.x - center.x, point.y - center.y)
    }, 0)
    return radiusSum / samples.length
  }
  // Command conversion methods.
  // --------------------------------------------------
  private convertPathCommandsToKclOps(
    commands: PathCommand[],
    transform: Transform,
    closeOpenPath = true
  ): KclOperation[] {
    const operations: KclOperation[] = []
    this.previousControlPoint = null
    this.currentPoint = { x: 0, y: 0 }

    commands.forEach((command) => {
      switch (command.type) {
        // Moves.
        case PathCommandType.MoveAbsolute:
        case PathCommandType.MoveRelative:
          operations.push(this.createNewSketchOp(command, transform))
          this.previousControlPoint = null
          break

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

    if (closeOpenPath && !operations.some((op) => op.type === KclOperationType.Close)) {
      // Call close.
      operations.push({ type: KclOperationType.Close, params: null })
    }

    return operations
  }

  private convertPathToKclOps(path: PathElement): KclOperation[] {
    if (this.options.emitRegions === false) {
      return this.convertPathCommandsToProfileKclOps(
        path.commands,
        path.transform!,
        path.fill !== 'none'
      )
    }

    if (path.fill === 'none') {
      return this.convertPathCommandsToKclOps(path.commands, path.transform!, false)
    }

    // Process path to regions and fragments.
    const processor = new PathProcessor(path)
    let processedPath: ProcessedPath
    try {
      processedPath = processor.processPath()
    } catch (error) {
      if (error instanceof Error && error.message === FACE_DISCOVERY_FAILED) {
        return this.convertPathCommandsToKclOps(path.commands, path.transform!)
      }

      throw error
    }

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
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRadius, angle: -90 } }
      )

      // Right edge and bottom-right corner.
      operations.push(
        {
          type: KclOperationType.Line,
          params: { point: [0, height - 2 * effectiveRadius] }
        },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRadius, angle: -90 } }
      )

      // Bottom edge and bottom-left corner.
      operations.push(
        { type: KclOperationType.Line, params: { point: [-(width - 2 * effectiveRadius), 0] } },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRadius, angle: -90 } }
      )

      // Left edge and top-left corner.
      operations.push(
        { type: KclOperationType.Line, params: { point: [0, -(height - 2 * effectiveRadius)] } },
        { type: KclOperationType.TangentialArc, params: { radius: effectiveRadius, angle: -90 } },
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
