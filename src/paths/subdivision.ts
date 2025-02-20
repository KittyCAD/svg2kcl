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
  let output: PathFragment | null = null
  switch (command.type) {
    case PathCommandType.LineAbsolute:
    case PathCommandType.LineRelative:
    case PathCommandType.HorizontalLineAbsolute:
    case PathCommandType.HorizontalLineRelative:
    case PathCommandType.VerticalLineAbsolute:
    case PathCommandType.VerticalLineRelative:
      output = subdivideLine(command, tMin, tMax)
      break
    case PathCommandType.QuadraticBezierAbsolute:
    case PathCommandType.QuadraticBezierRelative:
      output = subdivideQuadratic(command, tMin, tMax)
      break
    case PathCommandType.CubicBezierAbsolute:
    case PathCommandType.CubicBezierRelative:
      output = subdivideCubic(command, tMin, tMax)
      break
  }

  return output
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

export function subdivideCubic(cmd: PathCommandEnriched, tMin: number, tMax: number): PathFragment {
  // Get relative flag.
  const isRelative = cmd.type === PathCommandType.CubicBezierRelative

  // Pull relevant points.
  const startPoint = cmd.startPositionAbsolute
  const x1 = cmd.parameters[0]
  const y1 = cmd.parameters[1]
  const x2 = cmd.parameters[2]
  const y2 = cmd.parameters[3]
  const x = cmd.parameters[4]
  const y = cmd.parameters[5]

  let control1Point = { x: x1, y: y1 }
  let control2Point = { x: x2, y: y2 }
  let endPoint = { x, y }

  // Convert to absolute if needed.
  if (isRelative) {
    control1Point = {
      x: x1 + startPoint.x,
      y: y1 + startPoint.y
    }
    control2Point = {
      x: x2 + startPoint.x,
      y: y2 + startPoint.y
    }
    endPoint = {
      x: x + startPoint.x,
      y: y + startPoint.y
    }
  }

  // Split.
  const splitResult = BezierUtils.splitCubicBezierRange(
    {
      start: startPoint,
      control1: control1Point,
      control2: control2Point,
      end: endPoint
    },
    tMin,
    tMax
  )

  // Pull results — only the curve fragment in our range.
  const startOut = splitResult.range[0]
  const control1Out = splitResult.range[1]
  const control2Out = splitResult.range[2]
  const endOut = splitResult.range[3]

  return new PathFragment({
    type: PathFragmentType.Cubic,
    start: startOut,
    control1: control1Out,
    control2: control2Out,
    end: endOut,
    iCommand: cmd.iCommand
  })
}
