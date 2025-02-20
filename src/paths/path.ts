import { Point } from '../types/base'
import { PathCommandEnriched, PathCommand, PathCommandType, PathSampleResult } from '../types/paths'
import { BezierUtils } from '../utils/bezier'

export function samplePath(inputCommands: PathCommand[]): PathSampleResult {
  const points: Point[] = []
  const commands: PathCommandEnriched[] = []
  let currentPoint = { x: 0, y: 0 }
  let previousControlPoint: Point = { x: 0, y: 0 }

  // Loop over each of our original input commands.
  for (let i = 0; i < inputCommands.length; i++) {
    const command = inputCommands[i]

    // Get the (global point set) index of this command's first point.
    const iFirstPoint = points.length

    // Store the current iteration's previousControlPoint before processing the command.
    const currentPreviousControlPoint = { ...previousControlPoint }

    switch (command.type) {
      case PathCommandType.MoveAbsolute:
      case PathCommandType.MoveRelative: {
        points.push(command.endPositionAbsolute)
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
        points.push(currentPoint, command.endPositionAbsolute)
        currentPoint = command.endPositionAbsolute

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
        const sampledPoints = BezierUtils.sampleQuadraticBezier(
          currentPoint,
          { x: x1, y: y1 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute

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
        const sampledPoints = BezierUtils.sampleQuadraticBezier(
          currentPoint,
          reflectedControlPoint,
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute

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
        const sampledPoints = BezierUtils.sampleCubicBezier(
          currentPoint,
          { x: x1, y: y1 },
          { x: x2, y: y2 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute

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
        const sampledPoints = BezierUtils.sampleCubicBezier(
          currentPoint,
          reflectedControlPoint,
          { x: x2, y: y2 },
          command.endPositionAbsolute
        )
        points.push(...sampledPoints)
        currentPoint = command.endPositionAbsolute

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
        points.push(inputCommands[0].endPositionAbsolute)
        break
      default:
        throw new Error(`Unsupported command type: ${command}`)
    }

    // Get the (global point set) index of this command's last point.
    const iLastPoint = points.length - 1

    // Append to our enriched commands.
    commands.push({
      ...command,
      iFirstPoint,
      iLastPoint,
      iCommand: i,
      previousControlPoint: currentPreviousControlPoint
    })
  }

  return { pathSamplePoints: points, pathCommands: commands }
}
