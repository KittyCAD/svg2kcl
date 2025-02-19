import { PathFragment } from '../paths/fragments/fragment'
import { PathFragmentType } from '../types/fragments'
import { PathCommandEnriched, PathCommandType } from '../types/paths'
import { BezierUtils } from '../utils/bezier'
import { interpolateLine } from '../utils/geometry'

export function subdivideCommand(
  command: PathCommandEnriched,
  tMin: number,
  tMax: number
): PathFragment | null {
  // We only handle lines, quadratics, and cubics here.
  // If other commands (Move, Arc, etc.) appear, return null or handle them as needed.
  switch (command.type) {
    case PathCommandType.LineAbsolute:
    case PathCommandType.LineRelative:
    case PathCommandType.HorizontalLineAbsolute:
    case PathCommandType.HorizontalLineRelative:
    case PathCommandType.VerticalLineAbsolute:
    case PathCommandType.VerticalLineRelative:
      return subdivideLine(command, tMin, tMax)
      break
    case PathCommandType.QuadraticBezierAbsolute:
    case PathCommandType.QuadraticBezierRelative:
      return subdivideQuadratic(command, tMin, tMax)
      break
  }

  return null
}

export function subdivideLine(cmd: PathCommandEnriched, tMin: number, tMax: number): PathFragment {
  // Line absolute is draw from current point to the specified coords.
  const startPoint = cmd.startPositionAbsolute
  const endPoint = cmd.endPositionAbsolute

  // Interpolate.
  const startOut = interpolateLine(startPoint, endPoint, tMin)
  const endOut = interpolateLine(startPoint, endPoint, tMax)

  let result = new PathFragment({
    type: PathFragmentType.Line,
    start: startOut,
    end: endOut,
    iCommand: cmd.iCommand
  })

  return result
}

export function subdivideQuadratic(
  cmd: PathCommandEnriched,
  tMin: number,
  tMax: number
): PathFragment {
  // Get relative flag.
  const isRelative = cmd.type === PathCommandType.QuadraticBezierRelative

  // Pull relevant points.
  const startPoint = cmd.startPositionAbsolute
  const x1 = cmd.parameters[0]
  const y1 = cmd.parameters[1]
  const x = cmd.parameters[2]
  const y = cmd.parameters[3]

  let controlPoint = { x: x1, y: y1 }
  let endPoint = { x: x, y: y }

  // Convert to absolute if needed.
  if (isRelative) {
    controlPoint = {
      x: x1 + startPoint.x,
      y: y1 + startPoint.y
    }
    endPoint = {
      x: x + startPoint.x,
      y: y + startPoint.y
    }
  }

  // Split.
  const splitResult = BezierUtils.splitQuadraticBezierRange(
    { start: startPoint, control: controlPoint, end: endPoint },
    tMin,
    tMax
  )

  // Pull results — only the curve fragment in our range.
  let startOut = splitResult.range[0]
  let controlOut = splitResult.range[1]
  let endOut = splitResult.range[2]

  let result = new PathFragment({
    type: PathFragmentType.Quad,
    start: startOut,
    control1: controlOut,
    end: endOut,
    iCommand: cmd.iCommand
  })

  return result
}
