import { EPSILON_INTERSECT } from '../constants'
import { Point } from '../types/base'
import { PathCommand, PathCommandEnriched, PathCommandType, PathSampleResult } from '../types/paths'
import { sampleCubicBezier, sampleQuadraticBezier } from '../utils/bezier'
import { computePointToPointDistance } from '../utils/geometry'
import { calculateReflectedControlPoint } from '../bezier/helpers'

export function sampleSubpath(inputCommands: PathCommand[]): PathSampleResult {
  // Our objective here is to sample the path into a series of points, while also
  // relating each command to the points it generates. Note that, for each adjacent
  // command pair, e.g., a line followed by a curve, the line's end point and the
  // curve's start point will be the same; both the same coordinates and the same point
  // in our points array. As a result, when tracking indices for each command, adjacent
  // commands will have overlap in iFirstPoint and iLastPoint. This is intentional, as
  // it allows us to determine which command any pair of points belongs to.

  // As we iterate, we should always push a command's points from [0... N-1], but only
  // push the Nth element for the last geometry creating command in a subpath.
  //
  // Note that calling this function on a full path, not a subpath, may not
  // return the expected results.

  let isFirstPoint = true
  const points: Point[] = []
  const commands: PathCommandEnriched[] = []
  let currentPoint = { x: 0, y: 0 }
  let previousControlPoint: Point = { x: 0, y: 0 }

  // Loop over each of our original input commands.
  for (let i = 0; i < inputCommands.length; i++) {
    if (isFirstPoint && points.length > 0) {
      isFirstPoint = false
    }

    const command = inputCommands[i]

    // Store the current iteration's previousControlPoint before processing the command.
    const currentPreviousControlPoint = { ...previousControlPoint }

    // Default to null indices for move/stop commands.
    let iFirstPoint: number | null = null
    let iLastPoint: number | null = null

    switch (command.type) {
      case PathCommandType.MoveAbsolute:
      case PathCommandType.MoveRelative: {
        // We should only ever see one of these since we process subpath only.
        if (points.length > 0) {
          throw new Error('Subpath already started.')
        }

        // Don't sample the move command; just set the current point.
        currentPoint = command.endPositionAbsolute

        // Set 'previous' control point.
        previousControlPoint = currentPoint
        break
      }

      case PathCommandType.LineAbsolute:
      case PathCommandType.LineRelative:
      case PathCommandType.HorizontalLineAbsolute:
      case PathCommandType.HorizontalLineRelative:
      case PathCommandType.VerticalLineAbsolute:
      case PathCommandType.VerticalLineRelative: {
        iFirstPoint = isFirstPoint ? 0 : points.length

        // Always push start position.
        points.push(currentPoint)

        // Track indices in points array.
        iLastPoint = points.length // OOB for now.

        currentPoint = command.endPositionAbsolute
        previousControlPoint = currentPoint
        break
      }

      case PathCommandType.QuadraticBezierAbsolute:
      case PathCommandType.QuadraticBezierRelative: {
        iFirstPoint = isFirstPoint ? 0 : points.length

        // Get absolute control point.
        let [x1, y1] = command.parameters
        if (command.type === PathCommandType.QuadraticBezierRelative) {
          x1 += currentPoint.x
          y1 += currentPoint.y
        }

        // Sample the curve.
        const sampledPoints = sampleQuadraticBezier(
          currentPoint,
          { x: x1, y: y1 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length // OOB for now.

        // Set 'previous' control point.
        previousControlPoint = { x: x1, y: y1 }
        break
      }

      case PathCommandType.QuadraticBezierSmoothAbsolute:
      case PathCommandType.QuadraticBezierSmoothRelative: {
        iFirstPoint = isFirstPoint ? 0 : points.length

        // Smooth quadratic Bézier only takes end point as parameter.
        // First control point is reflection of previous control point.
        const reflectedControlPoint = calculateReflectedControlPoint(
          previousControlPoint,
          currentPoint
        )

        // Sample the curve using the reflected control point.
        const sampledPoints = sampleQuadraticBezier(
          currentPoint,
          reflectedControlPoint,
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length // OOB for now.

        // Set 'previous' control point.
        previousControlPoint = reflectedControlPoint
        break
      }

      case PathCommandType.CubicBezierAbsolute:
      case PathCommandType.CubicBezierRelative: {
        iFirstPoint = isFirstPoint ? 0 : points.length

        // Get absolute control points.
        let [x1, y1, x2, y2] = command.parameters
        if (command.type === PathCommandType.CubicBezierRelative) {
          x1 += currentPoint.x
          y1 += currentPoint.y
          x2 += currentPoint.x
          y2 += currentPoint.y
        }
        // Sample the curve.
        const sampledPoints = sampleCubicBezier(
          currentPoint,
          { x: x1, y: y1 },
          { x: x2, y: y2 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length

        // Set 'previous' control point.
        previousControlPoint = { x: x2, y: y2 }
        break
      }

      case PathCommandType.CubicBezierSmoothAbsolute:
      case PathCommandType.CubicBezierSmoothRelative: {
        iFirstPoint = isFirstPoint ? 0 : points.length

        // S/s command parameters are [x2, y2, x, y] where:
        // (x2,y2) is the second control point
        // (x,y) is the end point
        // but endPositionAbsolute already handles the end point for us.
        let [x2, y2] = command.parameters
        if (command.type === PathCommandType.CubicBezierSmoothRelative) {
          x2 += currentPoint.x
          y2 += currentPoint.y
        }

        // First control point is reflection of previous second control point.
        const reflectedControlPoint = calculateReflectedControlPoint(
          previousControlPoint,
          currentPoint
        )

        // Sample the curve.
        const sampledPoints = sampleCubicBezier(
          currentPoint,
          reflectedControlPoint,
          { x: x2, y: y2 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length

        // Set 'previous' control point.
        previousControlPoint = { x: x2, y: y2 }
        break
      }

      case PathCommandType.StopAbsolute:
      case PathCommandType.StopRelative:
        // Take no commands; effect is the same: close.
        // https://www.w3.org/TR/SVG2/paths.html#PathDataClosePathCommand

        // "A path data segment (if there is one) must begin with a "moveto" command"
        // So we can grab the end of the first move, and push a point there to close.
        // https://www.w3.org/TR/SVG11/paths.html#PathDataMovetoCommands

        // Because we already insert explicit closing geometry, we don't need to do
        // anything here.
        // See also: processValues() in src/parsers/path.ts.
        break
      default:
        throw new Error(`Unsupported command type: ${command}`)
    }

    // Append to our enriched commands.
    commands.push({
      ...command,
      iFirstPoint,
      iLastPoint,
      iCommand: i,
      previousControlPoint: currentPreviousControlPoint
    })
  }

  // Push our final point... making our iLastPoint not OOB.
  if (points.length > 0) {
    points.push(currentPoint)
  }

  // Close.
  // Current point should be the same as the first point given our explicit closing geometry.
  if (computePointToPointDistance(currentPoint, points[0]) > EPSILON_INTERSECT) {
    throw new Error('Subpath is not closed.')
  }

  return { pathSamplePoints: points, pathCommands: commands }
}

// Helper function to convert relative coordinates to absolute.
function toAbsolute(relative: number[], currentPoint: Point): number[] {
  const result: number[] = []
  for (let i = 0; i < relative.length; i += 2) {
    result.push(currentPoint.x + relative[i])
    result.push(currentPoint.y + relative[i + 1])
  }
  return result
}

export function absolutizeSubpath(inputCommands: PathCommand[]): PathCommandEnriched[] {
  // Walks the full subpath and returns enriched commands with absolute positions
  // and control points.
  const commands: PathCommandEnriched[] = []
  let currentPoint = { x: 0, y: 0 }
  let previousControlPoint: Point = { x: 0, y: 0 }

  for (let i = 0; i < inputCommands.length; i++) {
    const command = inputCommands[i]
    const startPositionAbsolute = { ...currentPoint }

    let absCommand: PathCommand
    let endPositionAbsolute: Point
    let newPreviousControlPoint = previousControlPoint

    switch (command.type) {
      // Move commands.
      case PathCommandType.MoveAbsolute:
      case PathCommandType.MoveRelative: {
        const isRelative = command.type === PathCommandType.MoveRelative
        const [x, y] = isRelative
          ? [currentPoint.x + command.parameters[0], currentPoint.y + command.parameters[1]]
          : command.parameters

        endPositionAbsolute = { x, y }
        newPreviousControlPoint = endPositionAbsolute

        absCommand = {
          ...command,
          type: PathCommandType.MoveAbsolute,
          startPositionAbsolute,
          endPositionAbsolute,
          parameters: [x, y]
        }
        break
      }

      // Line commands (including horizontal/vertical).
      case PathCommandType.LineAbsolute:
      case PathCommandType.LineRelative:
      case PathCommandType.HorizontalLineAbsolute:
      case PathCommandType.HorizontalLineRelative:
      case PathCommandType.VerticalLineAbsolute:
      case PathCommandType.VerticalLineRelative: {
        let x: number, y: number

        switch (command.type) {
          case PathCommandType.LineAbsolute:
            ;[x, y] = command.parameters
            break
          case PathCommandType.LineRelative:
            x = currentPoint.x + command.parameters[0]
            y = currentPoint.y + command.parameters[1]
            break
          case PathCommandType.HorizontalLineAbsolute:
            x = command.parameters[0]
            y = currentPoint.y
            break
          case PathCommandType.HorizontalLineRelative:
            x = currentPoint.x + command.parameters[0]
            y = currentPoint.y
            break
          case PathCommandType.VerticalLineAbsolute:
            x = currentPoint.x
            y = command.parameters[0]
            break
          case PathCommandType.VerticalLineRelative:
            x = currentPoint.x
            y = currentPoint.y + command.parameters[0]
            break
        }

        endPositionAbsolute = { x, y }

        absCommand = {
          ...command,
          type: PathCommandType.LineAbsolute,
          startPositionAbsolute,
          endPositionAbsolute,
          parameters: [x, y]
        }
        break
      }

      // Quadratic Bézier commands
      case PathCommandType.QuadraticBezierAbsolute:
      case PathCommandType.QuadraticBezierRelative:
      case PathCommandType.QuadraticBezierSmoothAbsolute:
      case PathCommandType.QuadraticBezierSmoothRelative: {
        let controlPoint: Point
        let endPoint: Point

        const isSmooth = command.type.includes('Smooth')
        const isRelative = command.type.includes('Relative')

        if (isSmooth) {
          // Smooth commands: reflect previous control point
          controlPoint = calculateReflectedControlPoint(previousControlPoint, currentPoint)
          const [endX, endY] = isRelative
            ? [currentPoint.x + command.parameters[0], currentPoint.y + command.parameters[1]]
            : command.parameters
          endPoint = { x: endX, y: endY }
        } else {
          // Regular quadratic: extract control point and end point
          const params = isRelative
            ? toAbsolute(command.parameters, currentPoint)
            : command.parameters
          const [x1, y1, x, y] = params
          controlPoint = { x: x1, y: y1 }
          endPoint = { x, y }
        }

        endPositionAbsolute = endPoint
        newPreviousControlPoint = controlPoint

        absCommand = {
          ...command,
          type: PathCommandType.QuadraticBezierAbsolute,
          startPositionAbsolute,
          endPositionAbsolute,
          parameters: [controlPoint.x, controlPoint.y, endPoint.x, endPoint.y]
        }
        break
      }

      // Cubic Bézier commands
      case PathCommandType.CubicBezierAbsolute:
      case PathCommandType.CubicBezierRelative:
      case PathCommandType.CubicBezierSmoothAbsolute:
      case PathCommandType.CubicBezierSmoothRelative: {
        let control1: Point
        let control2: Point
        let endPoint: Point

        const isSmooth = command.type.includes('Smooth')
        const isRelative = command.type.includes('Relative')

        if (isSmooth) {
          // Smooth commands: reflect previous control point for first control point.
          control1 = calculateReflectedControlPoint(previousControlPoint, currentPoint)
          const params = isRelative
            ? toAbsolute(command.parameters, currentPoint)
            : command.parameters
          const [x2, y2, x, y] = params
          control2 = { x: x2, y: y2 }
          endPoint = { x, y }
        } else {
          // Regular cubic: extract both control points and end point.
          const params = isRelative
            ? toAbsolute(command.parameters, currentPoint)
            : command.parameters
          const [x1, y1, x2, y2, x, y] = params
          control1 = { x: x1, y: y1 }
          control2 = { x: x2, y: y2 }
          endPoint = { x, y }
        }

        endPositionAbsolute = endPoint
        newPreviousControlPoint = control2

        absCommand = {
          ...command,
          type: PathCommandType.CubicBezierAbsolute,
          startPositionAbsolute,
          endPositionAbsolute,
          parameters: [control1.x, control1.y, control2.x, control2.y, endPoint.x, endPoint.y]
        }
        break
      }

      // Stop commands
      case PathCommandType.StopAbsolute:
      case PathCommandType.StopRelative: {
        endPositionAbsolute = { ...command.endPositionAbsolute }

        absCommand = {
          ...command,
          type: PathCommandType.StopAbsolute,
          startPositionAbsolute,
          endPositionAbsolute,
          parameters: []
        }
        break
      }

      default:
        throw new Error(`Unsupported command type: ${command.type}`)
    }

    // Update state.
    currentPoint = { ...endPositionAbsolute }
    previousControlPoint = { ...newPreviousControlPoint }

    // Add enriched command.
    commands.push({
      ...absCommand,
      iCommand: i,
      iFirstPoint: null,
      iLastPoint: null,
      previousControlPoint: { ...previousControlPoint }
    })
  }

  return commands
}
