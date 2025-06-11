import { PathCommand, PathCommandTypeToSvgPathCommandMap } from '../types/paths'
import { Line, Arc, Bezier } from '../intersections/intersections'
import { PathElement } from '../types/elements'
import { PathCommandType } from '../types/paths'
import { Point } from '../types/base'
import { convertQuadraticToCubic } from '../intersections/bezier_helpers'
import { v4 as uuidv4 } from 'uuid'

export enum SegmentType {
  // We'll support lines, circular arcs, and cubic Bézier curves only.
  Line = 'Line',
  Arc = 'Arc',
  CubicBezier = 'CubicBezier'
}

export interface Segment {
  type: SegmentType
  id: string
  geometry: Line | Arc | Bezier
}

export interface SplitSegment extends Segment {
  // A segment that has been split at an intersection point.
  parentId: string // ID of the original segment before splitting.
}

// Some of these are near duplicates of content in src/utils/bezier.ts; cleanup later.
const MOVE_COMMANDS = [PathCommandType.MoveAbsolute, PathCommandType.MoveRelative]

const LINE_COMMANDS = [
  PathCommandType.LineAbsolute,
  PathCommandType.LineRelative,
  PathCommandType.HorizontalLineAbsolute,
  PathCommandType.HorizontalLineRelative,
  PathCommandType.VerticalLineAbsolute,
  PathCommandType.VerticalLineRelative
]

const BEZIER_COMMANDS = [
  PathCommandType.QuadraticBezierAbsolute,
  PathCommandType.QuadraticBezierRelative,
  PathCommandType.QuadraticBezierSmoothAbsolute,
  PathCommandType.QuadraticBezierSmoothRelative,
  PathCommandType.CubicBezierAbsolute,
  PathCommandType.CubicBezierRelative,
  PathCommandType.CubicBezierSmoothAbsolute,
  PathCommandType.CubicBezierSmoothRelative
]

const ARC_COMMANDS = [PathCommandType.EllipticalArcAbsolute, PathCommandType.EllipticalArcRelative]

export function processPath(path: PathElement) {
  // Approach here will be, I think:
  // 1. Absolutize path: no relative coordinates.
  // 2. Normalize path: all beziers should be in cubic, absolute form.
  // 3. Convert SVG commands to a 'segment' array.
  // 4. Run intersection tests on segments.
  // 5. Split segments at intersection points.
  // 6. Build planar graph/DCEL-like structure.
  // 7. Do region analysis.
  // 8. Continue as before.
  let x = 1

  // Build segments from the path commands. This will
  // involve converting relative commands to absolute, normalizing
  // Bezier curves, then assembling a segment array.
  const segments = buildSegmentsFromSubpath(path.commands)
}

function reflectControlPoint(controlPoint: Point, currentPoint: Point): Point {
  return {
    x: 2 * currentPoint.x - controlPoint.x,
    y: 2 * currentPoint.y - controlPoint.y
  }
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

function normalizeBezierCommand(
  command: PathCommand,
  currentPoint: Point,
  previousControlPoint: Point
): Bezier {
  // Convert a Bézier command to a full cubic Bézier representation.
  // This will handle both absolute and relative commands, as well as smooth commands.
  //
  // For SVG nomenclature/parameters, see:
  // https://www.w3.org/TR/SVG/paths.html#PathDataCubicBezierCommands
  // https://www.w3.org/TR/SVG/paths.html#PathDataQuadraticBezierCommands

  if (!BEZIER_COMMANDS.includes(command.type)) {
    throw new Error(`Command type ${command.type} is not a Bézier command`)
  }

  let result: Bezier

  switch (command.type) {
    case PathCommandType.CubicBezierAbsolute: {
      const [x1, y1, x2, y2, x, y] = command.parameters

      result = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control1: { x: x1, y: y1 },
        control2: { x: x2, y: y2 },
        end: { x, y }
      }
      break
    }
    case PathCommandType.CubicBezierRelative: {
      const [x1, y1, x2, y2, x, y] = command.parameters

      // Convert relative coordinates to absolute.
      const x1Abs = currentPoint.x + x1
      const y1Abs = currentPoint.y + y1
      const x2Abs = currentPoint.x + x2
      const y2Abs = currentPoint.y + y2
      const xAbs = currentPoint.x + x
      const yAbs = currentPoint.y + y

      result = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control1: { x: x1Abs, y: y1Abs },
        control2: { x: x2Abs, y: y2Abs },
        end: { x: xAbs, y: yAbs }
      }
      break
    }
    case PathCommandType.CubicBezierSmoothAbsolute: {
      const [x2, y2, x, y] = command.parameters

      // Reflect the previous control point.
      const control1 = reflectControlPoint(previousControlPoint, currentPoint)

      result = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control1: control1,
        control2: { x: x2, y: y2 },
        end: { x, y }
      }
      break
    }
    case PathCommandType.CubicBezierSmoothRelative: {
      const [x2, y2, x, y] = command.parameters

      // Convert relative coordinates to absolute.
      const x2Abs = currentPoint.x + x2
      const y2Abs = currentPoint.y + y2
      const xAbs = currentPoint.x + x
      const yAbs = currentPoint.y + y

      // Reflect the previous control point.
      const control1 = reflectControlPoint(previousControlPoint, currentPoint)

      result = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control1: control1,
        control2: { x: x2Abs, y: y2Abs },
        end: { x: xAbs, y: yAbs }
      }
      break
    }
    case PathCommandType.QuadraticBezierAbsolute: {
      const [x1, y1, x, y] = command.parameters

      // Convert to cubic Bézier.
      const quadraticForm = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control: { x: x1, y: y1 },
        end: { x, y }
      }
      const cubicForm = convertQuadraticToCubic(
        quadraticForm.start,
        quadraticForm.control,
        quadraticForm.end
      )

      // This is a bit verbose but clear.
      result = {
        start: cubicForm.start,
        control1: cubicForm.control1,
        control2: cubicForm.control2,
        end: cubicForm.end
      }
      break
    }
    case PathCommandType.QuadraticBezierRelative: {
      const [x1, y1, x, y] = command.parameters

      // Convert relative coordinates to absolute.
      const x1Abs = currentPoint.x + x1
      const y1Abs = currentPoint.y + y1
      const xAbs = currentPoint.x + x
      const yAbs = currentPoint.y + y

      // Convert to cubic Bézier.
      const quadraticForm = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control: { x: x1Abs, y: y1Abs },
        end: { x: xAbs, y: yAbs }
      }
      const cubicForm = convertQuadraticToCubic(
        quadraticForm.start,
        quadraticForm.control,
        quadraticForm.end
      )

      // This is a bit verbose but clear.
      result = {
        start: cubicForm.start,
        control1: cubicForm.control1,
        control2: cubicForm.control2,
        end: cubicForm.end
      }
      break
    }
    case PathCommandType.QuadraticBezierSmoothAbsolute: {
      const [x, y] = command.parameters

      // Reflect the previous control point.
      const control = reflectControlPoint(previousControlPoint, currentPoint)

      // Convert to cubic Bézier.
      const quadraticForm = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control: control,
        end: { x: x, y: y }
      }

      const cubicForm = convertQuadraticToCubic(
        quadraticForm.start,
        quadraticForm.control,
        quadraticForm.end
      )

      // This is a bit verbose but clear.
      result = {
        start: cubicForm.start,
        control1: cubicForm.control1,
        control2: cubicForm.control2,
        end: cubicForm.end
      }
      break
    }
    case PathCommandType.QuadraticBezierSmoothRelative: {
      const [x, y] = command.parameters

      // Convert relative coordinates to absolute.
      const xAbs = currentPoint.x + x
      const yAbs = currentPoint.y + y

      // Reflect the previous control point.
      const control = reflectControlPoint(previousControlPoint, currentPoint)

      // Convert to cubic Bézier.
      const quadraticForm = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control: control,
        end: { x: xAbs, y: yAbs }
      }

      const cubicForm = convertQuadraticToCubic(
        quadraticForm.start,
        quadraticForm.control,
        quadraticForm.end
      )

      // This is a bit verbose but clear.
      result = {
        start: cubicForm.start,
        control1: cubicForm.control1,
        control2: cubicForm.control2,
        end: cubicForm.end
      }
      break
    }
    default:
      throw new Error(`Unsupported Bézier command type: ${command.type}`)
  }

  return result
}

function buildSegmentsFromSubpath(commands: PathCommand[]): Segment[] {
  // Absolutize + normalize + emit geometry segments.
  let segments: Segment[] = []

  let currentPoint = { x: 0, y: 0 }
  let previousControlPoint: Point = { x: 0, y: 0 }

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i]
    const startPositionAbsolute = { ...currentPoint }

    let endPositionAbsolute: Point
    let newPreviousControlPoint = previousControlPoint

    if (MOVE_COMMANDS.includes(command.type)) {
      // Move command — just update state.
      const isRelative = command.type === PathCommandType.MoveRelative
      const [x, y] = isRelative
        ? [currentPoint.x + command.parameters[0], currentPoint.y + command.parameters[1]]
        : command.parameters

      endPositionAbsolute = { x, y }
      newPreviousControlPoint = { ...endPositionAbsolute }
    } else if (LINE_COMMANDS.includes(command.type)) {
      // Handle line commands.
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
        default:
          throw new Error(`Unknown line command type: ${command.type}`)
      }

      // Set end position.
      endPositionAbsolute = { x, y }
      newPreviousControlPoint = { ...endPositionAbsolute }

      // Build segment.
      let lineGeometry: Line = {
        start: startPositionAbsolute,
        end: endPositionAbsolute
      }
      segments.push({
        type: SegmentType.Line,
        id: uuidv4(),
        geometry: lineGeometry
      })
    } else if (BEZIER_COMMANDS.includes(command.type)) {
      // For quadratics:
      // - Smooth commands need to have their control point reflected and inserted.
      // - All must be converted to absolute.
      // - All must be converted to cubic.
      // For cubics:
      // - Smooth commands need to have their control point reflected and inserted.
      // - All must be converted to absolute.

      // Normalize to our converted format.
      const bezier = normalizeBezierCommand(command, currentPoint, previousControlPoint)

      // Set end position.
      endPositionAbsolute = bezier.end
      newPreviousControlPoint = bezier.control2

      // Build segment.
      let bezierGeometry: Bezier = {
        start: bezier.start,
        control1: bezier.control1,
        control2: bezier.control2,
        end: bezier.end
      }
      segments.push({
        type: SegmentType.CubicBezier,
        id: uuidv4(),
        geometry: bezierGeometry
      })
    } else if (ARC_COMMANDS.includes(command.type)) {
      // Handle arc commands.
      // For now, we can only handle circular arcs—so we need to police the
      // elliptical SVG parameters a bit.

      throw new Error(`Arc commands are not yet supported: ${command.type}`)
    }

    // Update state.
    currentPoint = { ...endPositionAbsolute }
    previousControlPoint = { ...newPreviousControlPoint }
  }

  return segments
}
