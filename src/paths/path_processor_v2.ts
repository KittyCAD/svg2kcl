import { v4 as uuidv4 } from 'uuid'
import { convertQuadraticToCubic } from '../intersections/bezier_helpers'
import {
  Arc,
  Bezier,
  getBezierBezierIntersection,
  getLineBezierIntersection,
  getLineLineIntersection,
  Intersection,
  Line
} from '../intersections/intersections'
import { Point } from '../types/base'
import { PathElement } from '../types/elements'
import { PathCommand, PathCommandType } from '../types/paths'
import { interpolateLine } from '../utils/geometry'
import { splitCubicBezier } from '../utils/bezier'
import { evaluateBezier } from '../intersections/bezier_helpers'

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
  idParent: string // ID of the original segment before splitting.
}

type SegmentHandler = (a: Segment, b: Segment) => Intersection[]

interface SegmentIntersection {
  idSeg1: string
  idSeg2: string
  intersection: Intersection
}

export interface Subpath {
  id: string
  idParent?: string
  commands: PathCommand[]
  segments?: Segment[]
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
  // 1. Separate paths into subpaths.
  // 2. For each subpath:
  //    - Absolutize path: no relative coordinates.
  //    - Normalize path: all beziers should be in cubic, absolute form.
  //    - Convert SVG commands to a 'segment' array.
  //
  // 3. Run intersection tests.
  //    - This will involve checking each segment against all others.
  //    - If a segment intersects another, track the intersection point.
  // 4. Split segments at intersection points.
  // 5. Build planar graph/DCEL-like structure.
  // 6. Do region analysis.
  // 7. Continue as before.

  // Split the path into subpaths based on move and stop commands.
  const subpaths = splitSubpaths(path.commands)

  // Build  our normalized segments from the path commands.
  for (const subpath of subpaths) {
    const segments = buildSegmentsFromSubpath(subpath.commands)
    subpath.segments = segments
  }

  // Compute intersections between segments.
  const intersections = computeIntersections(subpaths)

  // Now we need to split segments at intersection points... should maybe
  // factor out the flattening as we do this twice.
  const allSegments = subpaths.flatMap((sp) => sp.segments || [])
  splitSegments(allSegments, intersections)

  let x = 1
}

function splitSubpaths(commands: PathCommand[]): Subpath[] {
  const subpaths: Subpath[] = []
  let currentSubpath: Subpath | null = null

  const moves = [PathCommandType.MoveAbsolute, PathCommandType.MoveRelative]
  const stops = [PathCommandType.StopAbsolute, PathCommandType.StopRelative]

  for (const cmd of commands) {
    // Start new subpath on move (unless it's the first command).
    if (moves.includes(cmd.type) && currentSubpath === null) {
      currentSubpath = {
        id: uuidv4(),
        commands: [],
        segments: []
      }
    }

    // If we have a current subpath, add the command to it.
    if (currentSubpath) {
      currentSubpath.commands.push(cmd)
    }

    // End subpath on a stop.
    if (stops.includes(cmd.type)) {
      if (currentSubpath) {
        subpaths.push(currentSubpath)
        currentSubpath = null
      }
    }
  }

  // Handle final subpath if not ended with a stop.
  if (currentSubpath) {
    subpaths.push(currentSubpath)
  }

  if (subpaths.length === 0) {
    throw new Error('Path has no valid subpaths to process')
  }

  return subpaths
}

function reflectControlPoint(controlPoint: Point, currentPoint: Point): Point {
  return {
    x: 2 * currentPoint.x - controlPoint.x,
    y: 2 * currentPoint.y - controlPoint.y
  }
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

    // These will be updated as we process the commands.
    let endPositionAbsolute = { ...currentPoint }
    let newPreviousControlPoint = { ...previousControlPoint }

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

function computeIntersections(subpaths: Subpath[]): SegmentIntersection[] {
  // Intersection tests. We need to test every segment against every other segment.
  const allSegments = subpaths.flatMap((subpath) => subpath.segments || [])

  // Dispatch table... should probably use generics but YOLO.
  const intersectionDispatch: Record<SegmentType, Record<SegmentType, SegmentHandler>> = {
    [SegmentType.Line]: {
      [SegmentType.Line]: (a, b) => getLineLineIntersection(a.geometry as Line, b.geometry as Line),

      [SegmentType.CubicBezier]: (a, b) =>
        getLineBezierIntersection(a.geometry as Line, b.geometry as Bezier),

      [SegmentType.Arc]: () => [] // Placeholder
    },

    [SegmentType.CubicBezier]: {
      [SegmentType.Line]: (a, b) => {
        // We flipped args going on, so we need to flip the t values.
        const raw = getLineBezierIntersection(b.geometry as Line, a.geometry as Bezier)
        return raw.map(({ point, t1, t2 }) => ({
          point,
          t1: t2,
          t2: t1
        }))
      },

      [SegmentType.CubicBezier]: (a, b) =>
        getBezierBezierIntersection(a.geometry as Bezier, b.geometry as Bezier),

      [SegmentType.Arc]: () => [] // Placeholder
    },

    [SegmentType.Arc]: {
      [SegmentType.Line]: () => [],
      [SegmentType.CubicBezier]: () => [],
      [SegmentType.Arc]: () => []
    }
  }

  // We can do only the upper triangle, including the diagonal.
  let allSegmentIntersections: SegmentIntersection[] = []

  for (let i = 0; i < allSegments.length - 1; i++) {
    for (let j = i + 1; j < allSegments.length; j++) {
      const seg1 = allSegments[i]
      const seg2 = allSegments[j]

      // Get intersections.
      const handler = intersectionDispatch[seg1.type][seg2.type]

      if (!handler) {
        console.warn(`No intersection handler for ${seg1.type} - ${seg2.type}`)
        continue
      }

      const intersections = handler(seg1, seg2)

      // Flatten and append.
      for (const intersection of intersections) {
        allSegmentIntersections.push({
          idSeg1: seg1.id,
          idSeg2: seg2.id,
          intersection
        })
      }
    }
  }

  return allSegmentIntersections
}

function splitLine(line: Line, tMin: number, tMax: number): SplitSegment[] {
  // Split a line segment at the given tMin and tMax values.
  const splitSegments: SplitSegment[] = []

  // Interpolate.
  const startOut = interpolateLine(line.start, line.end, tMin)
  const endOut = interpolateLine(line.start, line.end, tMax)

  return splitSegments
}

export function splitCubicBezierBetween(bezier: Bezier, tMin: number, tMax: number): Bezier {
  if (tMin >= tMax) {
    throw new Error(`Invalid t range: tMin (${tMin}) >= tMax (${tMax})`)
  }

  const { start, control1, control2, end } = bezier

  // Step 1: split at tMin → keep the second half.
  const firstSplit = splitCubicBezier(start, control1, control2, end, tMin)
  const [bStart, bCtrl1, bCtrl2, bEnd] = firstSplit.second

  // Step 2: split the result again at a rescaled t.
  const tRescaled = (tMax - tMin) / (1 - tMin)
  const secondSplit = splitCubicBezier(bStart, bCtrl1, bCtrl2, bEnd, tRescaled)
  const [finalStart, finalCtrl1, finalCtrl2, finalEnd] = secondSplit.first

  return {
    start: finalStart,
    control1: finalCtrl1,
    control2: finalCtrl2,
    end: finalEnd
  }
}

function splitArc(arc: Arc, tMin: number, tMax: number): SplitSegment[] {
  // Split an arc segment at the given tMin and tMax values.
  // For now, we will not implement this as arcs are not yet supported.
  throw new Error('Arc splitting is not yet implemented')
}

function splitSegments(segments: Segment[], intersections: SegmentIntersection[]): SplitSegment[] {
  // TODO: Ongoing here...

  const tMap = new Map<string, number[]>()

  for (const intersection of intersections) {
    let {
      idSeg1,
      idSeg2,
      intersection: { t1, t2 }
    } = intersection

    if (!tMap.has(idSeg1)) tMap.set(idSeg1, [])
    if (!tMap.has(idSeg2)) tMap.set(idSeg2, [])

    tMap.get(idSeg1)!.push(t1)
    tMap.get(idSeg2)!.push(t2)
  }

  const result: SplitSegment[] = []

  for (const segment of segments) {
    // We need t ranges, e.g., [0, t], [t, 1], rather than just t values.
    const tValues = [0, 1, ...(tMap.get(segment.id) || [])]
      .filter((t, i, arr) => t >= 0 && t <= 1 && arr.indexOf(t) === i)
      .sort((a, b) => a - b)

    for (let i = 0; i < tValues.length - 1; i++) {
      const t0 = tValues[i]
      const t1 = tValues[i + 1]
      if (t1 - t0 < 1e-6) continue

      if (segment.type === SegmentType.Line) {
        const lineGeometry = segment.geometry as Line
        const start = interpolateLine(lineGeometry.start, lineGeometry.end, t0)
        const end = interpolateLine(lineGeometry.start, lineGeometry.end, t1)

        result.push({
          id: uuidv4(),
          idParent: segment.id,
          type: SegmentType.Line,
          geometry: { start, end }
        })
      } else if (segment.type === SegmentType.CubicBezier) {
        const bezierGeometry = segment.geometry as Bezier

        const pieces = splitCubicBezierBetween(bezierGeometry, t0, t1)
        result.push({
          id: uuidv4(),
          idParent: segment.id,
          type: SegmentType.CubicBezier,
          geometry: pieces
        })
      } else if (segment.type === SegmentType.Arc) {
        throw new Error('Arc splitting not yet supported')
      }
    }
  }

  return result
}
