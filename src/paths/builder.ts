import { Point } from '../types/base'
import { PathCommandEnriched, PathCommand, PathCommandType, PathSampleResult } from '../types/paths'
import { BezierUtils } from '../utils/bezier'

export function buildPath(inputCommands: PathCommand[]): PathSampleResult {
  const points: Point[] = []
  const commands: PathCommandEnriched[] = []
  let currentPoint = { x: 0, y: 0 }

  // Loop over each of our original input commands.
  for (let i = 0; i < inputCommands.length; i++) {
    const command = inputCommands[i]

    // Get the (global point set) index of this command's first point.
    const iFirstPoint = points.length

    switch (command.type) {
      case PathCommandType.MoveAbsolute:
      case PathCommandType.MoveRelative: {
        points.push(command.endPositionAbsolute)
        currentPoint = command.endPositionAbsolute
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
        break
      }
    }

    // Get the (global point set) index of this command's last point.
    const iLastPoint = points.length - 1

    // Append to our enriched commands.
    commands.push({
      ...command,
      iFirstPoint,
      iLastPoint,
      iCommand: i
    })
  }

  return { pathSamplePoints: points, pathCommands: commands }
}
