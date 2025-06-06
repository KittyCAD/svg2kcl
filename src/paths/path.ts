import { EPSILON_INTERSECT } from '../constants'
import { Point } from '../types/base'
import { PathCommand, PathCommandEnriched, PathCommandType, PathSampleResult } from '../types/paths'
import {
  calculateReflectedControlPoint,
  sampleCubicBezier,
  sampleQuadraticBezier
} from '../utils/bezier'
import { computePointToPointDistance } from '../utils/geometry'

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
