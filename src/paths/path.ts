import { Point } from '../types/base'
import { PathCommandEnriched, PathCommand, PathCommandType, PathSampleResult } from '../types/paths'
import { BezierUtils } from '../utils/bezier'
import { computePointToPointDistance } from '../utils/geometry'
import { EPSILON_INTERSECT } from '../constants'

export function samplePath(inputCommands: PathCommand[]): PathSampleResult {
  const points: Point[] = []
  const commands: PathCommandEnriched[] = []
  let currentPoint = { x: 0, y: 0 }
  let previousControlPoint: Point = { x: 0, y: 0 }

  // Loop over each of our original input commands.
  for (let i = 0; i < inputCommands.length; i++) {
    const command = inputCommands[i]

    // Store the current iteration's previousControlPoint before processing the command.
    const currentPreviousControlPoint = { ...previousControlPoint }

    // Default to null indices for move/stop commands.
    let iFirstPoint: number | null = null
    let iLastPoint: number | null = null

    switch (command.type) {
      case PathCommandType.MoveAbsolute:
      case PathCommandType.MoveRelative: {
        // Don't sample the move command; just set the current point.
        // points.push(command.endPositionAbsolute)
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
        iFirstPoint = points.length
        // points.push(currentPoint, command.endPositionAbsolute)
        points.push(currentPoint)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length - 1

        // Set 'previous' control point.
        previousControlPoint = currentPoint
        break
      }

      case PathCommandType.QuadraticBezierAbsolute:
      case PathCommandType.QuadraticBezierRelative: {
        // Get absolute control point.
        let [x1, y1] = command.parameters
        if (command.type === PathCommandType.QuadraticBezierRelative) {
          x1 += currentPoint.x
          y1 += currentPoint.y
        }

        // Sample the curve.
        iFirstPoint = points.length
        const sampledPoints = BezierUtils.sampleQuadraticBezier(
          currentPoint,
          { x: x1, y: y1 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length - 1

        // Set 'previous' control point.
        previousControlPoint = { x: x1, y: y1 }
        break
      }

      case PathCommandType.QuadraticBezierSmoothAbsolute:
      case PathCommandType.QuadraticBezierSmoothRelative: {
        // Smooth quadratic Bézier only takes end point as parameter.
        // First control point is reflection of previous control point.
        const reflectedControlPoint = BezierUtils.calculateReflectedControlPoint(
          previousControlPoint,
          currentPoint
        )

        // Sample the curve using the reflected control point.
        iFirstPoint = points.length
        const sampledPoints = BezierUtils.sampleQuadraticBezier(
          currentPoint,
          reflectedControlPoint,
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length - 1

        // Set 'previous' control point.
        previousControlPoint = reflectedControlPoint
        break
      }

      case PathCommandType.CubicBezierAbsolute:
      case PathCommandType.CubicBezierRelative: {
        // Get absolute control points.
        let [x1, y1, x2, y2] = command.parameters
        if (command.type === PathCommandType.CubicBezierRelative) {
          x1 += currentPoint.x
          y1 += currentPoint.y
          x2 += currentPoint.x
          y2 += currentPoint.y
        }
        // Sample the curve.
        iFirstPoint = points.length
        const sampledPoints = BezierUtils.sampleCubicBezier(
          currentPoint,
          { x: x1, y: y1 },
          { x: x2, y: y2 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length - 1

        // Set 'previous' control point.
        previousControlPoint = { x: x2, y: y2 }
        break
      }

      case PathCommandType.CubicBezierSmoothAbsolute:
      case PathCommandType.CubicBezierSmoothRelative: {
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
        const reflectedControlPoint = BezierUtils.calculateReflectedControlPoint(
          previousControlPoint,
          currentPoint
        )

        // Sample the curve.
        iFirstPoint = points.length
        const sampledPoints = BezierUtils.sampleCubicBezier(
          currentPoint,
          reflectedControlPoint,
          { x: x2, y: y2 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute
        iLastPoint = points.length - 1

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

  // Close.
  // Current point should be the same as the first point given our explicit closing geometry.
  if (computePointToPointDistance(currentPoint, points[0]) > EPSILON_INTERSECT) {
    throw new Error('Subpath is not closed.')
  }
  points.push(currentPoint)

  return { pathSamplePoints: points, pathCommands: commands }
}
