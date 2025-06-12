import { v4 as uuidv4 } from 'uuid'
import { convertQuadraticToCubic } from '../intersections/bezier_helpers'
import { EPS_PARAM, EPS_INTERSECTION } from '../intersections/constants'
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
import { splitCubicBezier } from '../utils/bezier'
import { interpolateLine } from '../utils/geometry'
import { DiscoveryResult, PlanarFaceTree } from 'planar-face-discovery'
import { computePointToPointDistance } from '../utils/geometry'

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
  idSubpath: string // ID of the subpath this segment belongs to.
  idNextSegment: string | null // ID of the next segment in the subpath.
  idPrevSegment: string | null // ID of the previous segment in the subpath.
}

export interface SplitSegment extends Segment {
  // A segment that has been split at an intersection point.
  idParentSegment: string // ID of the original segment before splitting.
}

// Dispatch table for segment intersection handlers.
type SegmentIntersectionComputer = (a: Segment, b: Segment) => Intersection[]

const handleLineLineIntersection: SegmentIntersectionComputer = (a, b) =>
  getLineLineIntersection(a.geometry as Line, b.geometry as Line)

const handleLineBezierIntersection: SegmentIntersectionComputer = (a, b) =>
  getLineBezierIntersection(a.geometry as Line, b.geometry as Bezier)

const handleBezierLineIntersection: SegmentIntersectionComputer = (a, b) => {
  const raw = getLineBezierIntersection(b.geometry as Line, a.geometry as Bezier)
  return raw.map(({ point, t1, t2 }) => ({ point, t1: t2, t2: t1 }))
}

const handleBezierBezierIntersection: SegmentIntersectionComputer = (a, b) =>
  getBezierBezierIntersection(a.geometry as Bezier, b.geometry as Bezier)

const handleNotImplemented = () => []

const intersectionDispatch: Record<
  SegmentType,
  Record<SegmentType, SegmentIntersectionComputer>
> = {
  [SegmentType.Line]: {
    [SegmentType.Line]: handleLineLineIntersection,
    [SegmentType.CubicBezier]: handleLineBezierIntersection,
    [SegmentType.Arc]: handleNotImplemented
  },
  [SegmentType.CubicBezier]: {
    [SegmentType.Line]: handleBezierLineIntersection,
    [SegmentType.CubicBezier]: handleBezierBezierIntersection,
    [SegmentType.Arc]: handleNotImplemented
  },
  [SegmentType.Arc]: {
    [SegmentType.Line]: handleNotImplemented,
    [SegmentType.CubicBezier]: handleNotImplemented,
    [SegmentType.Arc]: handleNotImplemented
  }
}

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

export interface PlanarGraph {
  nodes: Array<[number, number]>
  edges: Array<[number, number]>
  segmentEdgeMap: Map<string, string>
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
  const rawSubpaths = splitSubpaths(path.commands)
  const subpaths = rawSubpaths.map((subpath) => ensureClosure(subpath))

  // Build  our normalized segments from the path commands.
  for (const subpath of subpaths) {
    const segments = buildSegmentsFromSubpath(subpath)
    subpath.segments = segments
  }

  // Compute intersections between segments.
  const intersections = computeIntersections(subpaths)

  // Now we need to split segments at intersection points... should maybe
  // factor out the flattening as we do this twice. Note that we track
  // everything for linking via subpath ID, so the flatmap is safe.
  const allSegments = subpaths.flatMap((sp) => sp.segments || [])
  const linkedSplitSegments = splitSegments(allSegments, intersections)

  // Planar graph structure.
  const planarGraph = buildPlanarGraphFromSegments(linkedSplitSegments)
  const faceForest = getFaces(planarGraph)

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

function buildSegmentsFromSubpath(subpath: Subpath): Segment[] {
  // Absolutize + normalize + emit geometry segments.
  let segments: Segment[] = []

  let currentPoint = { x: 0, y: 0 }
  let previousControlPoint: Point = { x: 0, y: 0 }

  // Linked list ID tracking.
  let idPrevSegment: string | null = null
  let idCurrentSegment: string | null = null

  for (let i = 0; i < subpath.commands.length; i++) {
    const command = subpath.commands[i]
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
      idCurrentSegment = uuidv4()
      let lineGeometry: Line = {
        start: startPositionAbsolute,
        end: endPositionAbsolute
      }
      segments.push({
        type: SegmentType.Line,
        id: idCurrentSegment,
        geometry: lineGeometry,
        idSubpath: subpath.id,
        idPrevSegment: idPrevSegment,
        idNextSegment: null
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
      idCurrentSegment = uuidv4()
      let bezierGeometry: Bezier = {
        start: bezier.start,
        control1: bezier.control1,
        control2: bezier.control2,
        end: bezier.end
      }
      segments.push({
        type: SegmentType.CubicBezier,
        id: idCurrentSegment,
        geometry: bezierGeometry,
        idSubpath: subpath.id,
        idPrevSegment: idPrevSegment,
        idNextSegment: null
      })
    } else if (ARC_COMMANDS.includes(command.type)) {
      // Handle arc commands.
      // For now, we can only handle circular arcs—so we need to police the
      // elliptical SVG parameters a bit.

      throw new Error(`Arc commands are not yet supported: ${command.type}`)
    }

    // Handle linked list.
    if (idPrevSegment) {
      const prevSegment = segments[segments.length - 2]
      prevSegment.idNextSegment = idCurrentSegment
    }
    idPrevSegment = idCurrentSegment

    // Update state.
    currentPoint = { ...endPositionAbsolute }
    previousControlPoint = { ...newPreviousControlPoint }
  }

  return segments
}

function getSelfIntersectionsForSegment(seg: Segment): SegmentIntersection[] {
  // Lines and arcs cannot self-intersect.
  if (seg.type !== SegmentType.CubicBezier) return []

  const hits = getBezierBezierIntersection(seg.geometry as Bezier, seg.geometry as Bezier)

  // Drop the start-point and end-point duplicates.
  return hits
    .filter(
      ({ t1, t2 }) =>
        !(t1 <= EPS_PARAM && t2 <= EPS_PARAM) && !(1 - t1 <= EPS_PARAM && 1 - t2 <= EPS_PARAM)
    )
    .map((intersection) => ({
      idSeg1: seg.id,
      idSeg2: seg.id,
      intersection
    }))
}

function computeIntersections(subpaths: Subpath[]): SegmentIntersection[] {
  // Intersection tests. We need to test every segment against every other segment.
  const allSegments = subpaths.flatMap((subpath) => subpath.segments || [])

  // This will hold all intersections found.
  let allSegmentIntersections: SegmentIntersection[] = []

  // First, we need to handle self-intersections for cubic Bézier segments.
  for (const seg of allSegments) {
    const selfHits = getSelfIntersectionsForSegment(seg)
    allSegmentIntersections.push(...selfHits)
  }

  // Now we can do only the upper triangle, excluding the diagonal.
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

      let intersections = handler(seg1, seg2)

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

function splitLine(line: Line, tMin: number, tMax: number): Line {
  // Split a line segment at the given tMin and tMax values.
  const splitSegments: SplitSegment[] = []

  // Interpolate.
  const startOut = interpolateLine(line.start, line.end, tMin)
  const endOut = interpolateLine(line.start, line.end, tMax)

  // Build line.
  const lineOut: Line = {
    start: startOut,
    end: endOut
  }

  return lineOut
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
  // Build map of segment IDs to their intersection t-values
  const segmentTMap = new Map<string, number[]>()

  // Initialize arrays for all segments first.
  for (const segment of segments) {
    segmentTMap.set(segment.id, [])
  }

  // Now populate the t-values.
  for (const intersection of intersections) {
    const seg1TValues = segmentTMap.get(intersection.idSeg1)
    const seg2TValues = segmentTMap.get(intersection.idSeg2)

    if (!seg1TValues || !seg2TValues) throw new Error('Intersection references unknown segment.')

    seg1TValues.push(intersection.intersection.t1)
    seg2TValues.push(intersection.intersection.t2)
  }

  // Create lookup for segments by ID.
  const segmentLookup = new Map<string, Segment>()
  for (const segment of segments) {
    segmentLookup.set(segment.id, segment)
  }

  const result: SplitSegment[] = []

  for (const segment of segments) {
    // Get the t-values for this segment, filtering out endpoints.
    // We use EPS_PARAM to filter out very small t-values close to 0 or 1.
    let currentSegmentT = segmentTMap.get(segment.id) || []
    currentSegmentT = currentSegmentT.filter((t) => t > EPS_PARAM && t < 1 - EPS_PARAM)

    // If we don't split this segment, just add it as is.
    if (currentSegmentT.length === 0) {
      result.push(segment as SplitSegment)
      continue
    }

    // Pad, sort, and filter the t-values.
    const currentSegmentTFull = [0, ...currentSegmentT, 1]
      .sort((a, b) => a - b)
      .filter((t, i, arr) => t >= 0 && t <= 1 && arr.indexOf(t) === i)

    // Create split segments for each t-range.
    const splitPieces: SplitSegment[] = []

    for (let i = 0; i < currentSegmentTFull.length - 1; i++) {
      const t1 = currentSegmentTFull[i]
      const t2 = currentSegmentTFull[i + 1]

      // Skip zero-length segments.
      if (t2 - t1 < EPS_PARAM) continue

      const splitSegmentId = uuidv4()
      let splitSegment: SplitSegment

      switch (segment.type) {
        case SegmentType.Line:
          splitSegment = {
            id: splitSegmentId,
            idSubpath: segment.idSubpath,
            idParentSegment: segment.id,
            type: segment.type,
            geometry: splitLine(segment.geometry as Line, t1, t2),
            idPrevSegment: null, // Will be set below.
            idNextSegment: null // Will be set below.
          }
          break
        case SegmentType.CubicBezier:
          splitSegment = {
            id: splitSegmentId,
            idSubpath: segment.idSubpath,
            idParentSegment: segment.id,
            type: segment.type,
            geometry: splitCubicBezierBetween(segment.geometry as Bezier, t1, t2),
            idPrevSegment: null, // Will be set below.
            idNextSegment: null // Will be set below.
          }
          break
        case SegmentType.Arc:
          throw new Error('Arc splitting not yet supported')
        default:
          throw new Error(`Unknown segment type: ${segment.type}`)
      }

      splitPieces.push(splitSegment)
    }

    // Link the split pieces together.
    for (let i = 0; i < splitPieces.length; i++) {
      splitPieces[i].idPrevSegment = i === 0 ? segment.idPrevSegment : splitPieces[i - 1].id
      splitPieces[i].idNextSegment =
        i === splitPieces.length - 1 ? segment.idNextSegment : splitPieces[i + 1].id
    }

    // Update the neighbors of the original segment to point to the new split pieces.
    if (segment.idPrevSegment) {
      const prevSegment = segmentLookup.get(segment.idPrevSegment)
      if (prevSegment) {
        prevSegment.idNextSegment = splitPieces[0].id
      }
    }
    if (segment.idNextSegment) {
      const nextSegment = segmentLookup.get(segment.idNextSegment)
      if (nextSegment) {
        nextSegment.idPrevSegment = splitPieces[splitPieces.length - 1].id
      }
    }

    // Add split pieces to lookup for any future references.
    for (const piece of splitPieces) {
      segmentLookup.set(piece.id, piece)
    }

    result.push(...splitPieces)
  }

  return result
}

function makeNodeAccessor(nodes: Array<[number, number]>) {
  return (p: Point): number => {
    for (let i = 0; i < nodes.length; i++) {
      const [x, y] = nodes[i]
      if (Math.hypot(p.x - x, p.y - y) < EPS_INTERSECTION) return i
    }
    nodes.push([p.x, p.y])
    return nodes.length - 1
  }
}

export function buildPlanarGraphFromSegments(segments: SplitSegment[]): PlanarGraph {
  const nodes: Array<[number, number]> = []
  const getNodeId = makeNodeAccessor(nodes)

  const edgeSet = new Set<string>() // avoid duplicates
  const segmentEdgeMap = new Map<string, string>()

  for (const seg of segments) {
    let start: Point, end: Point
    switch (seg.type) {
      case SegmentType.Line:
        ;({ start, end } = seg.geometry as Line)
        break
      case SegmentType.CubicBezier:
        ;({ start, end } = seg.geometry as Bezier)
        break
      case SegmentType.Arc:
        throw new Error('Arc segments are not yet supported in planar graph construction')
      default:
        throw new Error(`Unknown segment type ${seg.type}`)
    }

    const aId = getNodeId(start)
    const bId = getNodeId(end)
    if (aId === bId) continue // zero-length, ignore

    const key = aId < bId ? `${aId},${bId}` : `${bId},${aId}`
    if (!edgeSet.has(key)) {
      edgeSet.add(key)
      segmentEdgeMap.set(key, seg.id)
    }
  }

  const edges: Array<[number, number]> = [...edgeSet].map((k) => {
    const [a, b] = k.split(',').map(Number)
    return [a, b]
  })

  return { nodes, edges, segmentEdgeMap }
}

export function getFaces(graph: PlanarGraph): DiscoveryResult {
  // Create the solver instance.
  const solver = new PlanarFaceTree()

  // Run face discovery.
  const faceForest = solver.discover(graph.nodes, graph.edges)

  if (faceForest.type === 'RESULT') {
    return faceForest
  } else {
    throw new Error('Face discovery failed')
  }
}

function ensureClosure(subpath: Subpath): Subpath {
  // Get our last non-stop command.
  const stops = [PathCommandType.StopAbsolute, PathCommandType.StopRelative]
  let iLastGeomCommand = -1

  const commands = subpath.commands

  for (let i = commands.length - 1; i >= 0; i--) {
    if (!stops.includes(commands[i].type)) {
      iLastGeomCommand = i
      break
    }
  }

  // Check if it meets our first command.
  const firstCommand = commands[0]
  const lastCommand = commands[iLastGeomCommand]

  if (
    computePointToPointDistance(
      lastCommand.endPositionAbsolute,
      firstCommand.endPositionAbsolute // All subpaths start with a move.
    ) <= EPS_INTERSECTION
  ) {
    // Do nothing.
  } else {
    // Insert a new line command.
    const newCommand = {
      type: PathCommandType.LineAbsolute,
      parameters: [firstCommand.endPositionAbsolute.x, firstCommand.endPositionAbsolute.y],
      startPositionAbsolute: lastCommand.endPositionAbsolute,
      endPositionAbsolute: firstCommand.endPositionAbsolute
    }
    commands.splice(iLastGeomCommand + 1, 0, newCommand)
  }

  subpath.commands = commands

  return subpath
}
