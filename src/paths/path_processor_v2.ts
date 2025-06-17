import { v4 as uuidv4 } from 'uuid'
import { convertQuadraticToCubic } from '../intersections/bezier_helpers'
import { EPS_PARAM, EPS_INTERSECTION } from '../intersections/constants'
import {
  Arc,
  Bezier,
  getBezierBezierIntersection,
  getBezierSelfIntersection,
  getLineBezierIntersection,
  getLineLineIntersection,
  Intersection,
  Line
} from '../intersections/intersections'
import { Point, FillRule } from '../types/base'
import { PathElement } from '../types/elements'
import { PathCommand, PathCommandType } from '../types/paths'
import { splitCubicBezier } from '../utils/bezier'
import { doesRayIntersectLineSegment, interpolateLine } from '../utils/geometry'
import { DiscoveryResult, PlanarFaceTree } from 'planar-face-discovery'
import { computePointToPointDistance } from '../utils/geometry'
import { flattenSegments, FlattenedSegment } from './segment_flattener'
import { EPSILON_INTERSECT } from '../constants'
import { calculatePolygonArea } from '../utils/geometry'
import { isLeft } from '../utils/geometry'
import { calculateCentroid } from '../utils/geometry'
import { calculateWindingDirection } from '../utils/polygon'

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
  idParentSegment: string | null // ID of the original segment before splitting.
}

export interface Region {
  id: string
  faceIndex: number
  segmentIds: string[]
  segmentReversed: boolean[]
  verticesFlattened: number[]
  signedArea: number
  isACW: boolean
}

interface EdgeSegmentInfo {
  segmentId: string
  isReversed: boolean
}

export interface RegionAnnotated extends Region {
  crossingNumber: number
  windingNumber: number
  isHole: boolean
  parentRegionId: string | null
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

export interface EnhancedPlanarGraph extends PlanarGraph {
  // Maps edge key to segment info with direction.
  edgeSegmentMap: Map<string, EdgeSegmentInfo>
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

export class ProcessedPathV2 {
  public readonly segments: Segment[]
  public readonly segmentsFlattened: FlattenedSegment[]

  private readonly flattenedMap = new Map<string, FlattenedSegment>()
  private readonly originalMap = new Map<string, Segment>()

  constructor(
    originals: Segment[],
    flats: FlattenedSegment[],
    public readonly regions: RegionAnnotated[]
  ) {
    this.segments = originals
    this.segmentsFlattened = flats

    originals.forEach((s) => this.originalMap.set(s.id, s))
    flats.forEach((f) => this.flattenedMap.set(f.id, f))
  }

  public getSegment(id: string): Segment | undefined {
    return this.originalMap.get(id)
  }
  public getSegmentFlattened(id: string): FlattenedSegment | undefined {
    return this.flattenedMap.get(id)
  }
}

export function processPath(path: PathElement): ProcessedPathV2 {
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
  // factor out the flattening (as in flatMap) as we do this twice. Note that we track
  // everything for linking via subpath ID, so the flatmap is safe.
  const allSegments = subpaths.flatMap((sp) => sp.segments || [])
  const linkedSplitSegments = splitSegments(allSegments, intersections)

  // The above is _almost_ a DCEL, but I think we can get a quicker win
  // by flattening (as in sampling) here, then building a planar graph, and doing our
  // fill-rule logic with that.
  const epsilon = 0.001
  const flattenedSegments = flattenSegments(linkedSplitSegments, epsilon)

  // Planar graph structure.
  const planarGraph = buildPlanarGraphFromFlattenedSegments(flattenedSegments)
  const faceForest = getFaces(planarGraph)

  // Build regions.
  const regions: Region[] = buildRegionsFromFaces(planarGraph, faceForest)

  // Now we need to get the fill rules for each region.
  // First, get a test point for each.
  const regionTestPoints: Point[] = regions.map((region) => computeTestPoint(region, planarGraph))

  // Then, we can do winding number tests for each region.
  const regionsAnnotated = determineInsideness(regions, regionTestPoints, flattenedSegments)

  // Trim redundant regions.
  const stackedRegions = resolveContainmentHierarchy(
    regionsAnnotated,
    regionTestPoints,
    planarGraph,
    path.fillRule
  )
  const finalRegions = cleanup(flattenedSegments, stackedRegions)

  // Build output.
  const segmentMap = new Map<string, FlattenedSegment>()
  for (const segment of finalRegions.segments) {
    segmentMap.set(segment.id, segment)
  }

  return new ProcessedPathV2(linkedSplitSegments, flattenedSegments, finalRegions.regions)
}

function splitSubpaths(commands: PathCommand[]): Subpath[] {
  const subpaths: Subpath[] = []
  let currentSubpath: Subpath | null = null

  const moves = [PathCommandType.MoveAbsolute, PathCommandType.MoveRelative]
  const stops = [PathCommandType.StopAbsolute, PathCommandType.StopRelative]

  for (const cmd of commands) {
    // Start new subpath on move
    if (moves.includes(cmd.type)) {
      if (currentSubpath) {
        // If we already have a current subpath, push it to the list.
        subpaths.push(currentSubpath)
      }

      // Create a new subpath.
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
  // Get absolute, normalized segments from a subpath.
  let segments: Segment[] = []

  let previousControlPoint: Point = { x: 0, y: 0 }
  let idPrevSegment: string | null = null
  let idCurrentSegment: string | null = null

  for (let i = 0; i < subpath.commands.length; i++) {
    // We have to walk the command path to build segments.
    // The SVG reader has already annotated each command with absolute start and end
    // positions, so we're really most interested in tracking control points.
    const command = subpath.commands[i]
    let newPreviousControlPoint = { ...previousControlPoint }

    if (MOVE_COMMANDS.includes(command.type)) {
      // Move: just update control point; no segment insertion.
      newPreviousControlPoint = { ...command.endPositionAbsolute }
    } else if (LINE_COMMANDS.includes(command.type)) {
      idCurrentSegment = uuidv4()
      const line: Line = {
        start: { ...command.startPositionAbsolute },
        end: { ...command.endPositionAbsolute }
      }
      const lineSegment: Segment = {
        type: SegmentType.Line,
        id: idCurrentSegment,
        geometry: line,
        idSubpath: subpath.id,
        idPrevSegment: idPrevSegment,
        idNextSegment: null
      }

      segments.push(lineSegment)
      newPreviousControlPoint = { ...command.endPositionAbsolute }
    } else if (BEZIER_COMMANDS.includes(command.type)) {
      // For quadratics:
      // - Smooth commands need to have their control point reflected and inserted.
      // - All must be converted to absolute.
      // - All must be converted to cubic.
      // For cubics:
      // - Smooth commands need to have their control point reflected and inserted.
      // - All must be converted to absolute.
      idCurrentSegment = uuidv4()
      const bezier = normalizeBezierCommand(
        command,
        command.startPositionAbsolute,
        previousControlPoint
      )
      const bezierSegment: Segment = {
        type: SegmentType.CubicBezier,
        id: idCurrentSegment,
        geometry: bezier,
        idSubpath: subpath.id,
        idPrevSegment: idPrevSegment,
        idNextSegment: null
      }

      segments.push(bezierSegment)
      newPreviousControlPoint = bezier.control2
    } else if (ARC_COMMANDS.includes(command.type)) {
      // Handle arc commands.
      // For now, we can only handle circular arcs—so we need to police the
      // elliptical SVG parameters a bit.
      throw new Error(`Arc commands are not yet supported: ${command.type}`)
    }

    // Linked list update. Almost but not quite a DCEL.
    if (idPrevSegment && segments.length >= 2) {
      const prevSegment = segments[segments.length - 2]
      prevSegment.idNextSegment = idCurrentSegment
    }
    idPrevSegment = idCurrentSegment
    previousControlPoint = { ...newPreviousControlPoint }
  }

  return segments
}

function getSelfIntersectionsForSegment(seg: Segment): SegmentIntersection[] {
  // Lines and arcs cannot self-intersect.
  if (seg.type !== SegmentType.CubicBezier) return []

  const hits = getBezierSelfIntersection(seg.geometry as Bezier)

  // Drop any start-point and end-point duplicates.
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
      // Push this segment as is; no parent.
      result.push({
        ...segment,
        idParentSegment: null // No parent segment since this is not split.
      } as SplitSegment)

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

function makeNodeAccessor(nodes: Array<[number, number]>) {
  return function getNodeId(p: Point): number {
    for (let i = 0; i < nodes.length; i++) {
      const [nx, ny] = nodes[i]
      if (computePointToPointDistance(p, { x: nx, y: ny }) < EPSILON_INTERSECT) return i
    }
    const id = nodes.length
    nodes.push([p.x, p.y])
    return id
  }
}

export function buildPlanarGraphFromFlattenedSegments(
  segments: FlattenedSegment[]
): EnhancedPlanarGraph {
  const nodes: Array<[number, number]> = []
  const getNodeId = makeNodeAccessor(nodes)

  const edgeSet = new Set<string>()
  const segmentEdgeMap = new Map<string, string>()
  const edgeSegmentMap = new Map<string, EdgeSegmentInfo>() // For direction.

  for (const seg of segments) {
    const { start, end } = seg.geometry
    const aId = getNodeId(start)
    const bId = getNodeId(end)
    if (aId === bId) continue // Ignore zero‑length.

    const key = aId < bId ? `${aId},${bId}` : `${bId},${aId}`
    const isReversed = aId > bId // Direction.

    if (!edgeSet.has(key)) {
      edgeSet.add(key)
      segmentEdgeMap.set(key, seg.parentSegmentId)
      edgeSegmentMap.set(key, {
        segmentId: seg.parentSegmentId,
        isReversed
      })
    }
  }

  const edges: Array<[number, number]> = Array.from(edgeSet, (k) => {
    const [a, b] = k.split(',').map(Number)
    return [a, b]
  })

  return { nodes, edges, segmentEdgeMap, edgeSegmentMap }
}

export function getFaces(graph: PlanarGraph): DiscoveryResult {
  const solver = new PlanarFaceTree()
  const faceForest = solver.discover(graph.nodes, graph.edges)
  if (faceForest.type === 'RESULT') return faceForest
  throw new Error('Face discovery failed')
}

export function buildRegionsFromFaces(
  graph: EnhancedPlanarGraph,
  faceResult: DiscoveryResult
): Region[] {
  if (faceResult.type !== 'RESULT') throw new Error('Invalid face result')
  type CycleNode = { cycle: number[]; children?: CycleNode[] }
  const { nodes, segmentEdgeMap, edgeSegmentMap } = graph

  const regions: Region[] = []
  let faceSeq = 0
  const walk = (node: CycleNode) => {
    const verts = node.cycle
    if (verts && verts.length >= 3) {
      const points: Point[] = verts.map((i) => ({ x: nodes[i][0], y: nodes[i][1] }))
      const signedArea = calculatePolygonArea(points)

      // Track original segments and their reversal status.
      const originalSegmentReversals = new Map<string, boolean>()

      for (let i = 0; i < verts.length; i++) {
        const a = verts[i]
        const b = verts[(i + 1) % verts.length]
        const key = a < b ? `${a},${b}` : `${b},${a}`
        const segmentInfo = edgeSegmentMap.get(key)

        if (segmentInfo) {
          // segmentInfo.segmentId is already the original segment ID
          const originalSegmentId = segmentInfo.segmentId

          // Determine if this segment is used in reverse for this face.
          const faceUsesReverse = a > b
          const actualReverse = segmentInfo.isReversed !== faceUsesReverse

          // Store the reversal status for the original segment.
          originalSegmentReversals.set(originalSegmentId, actualReverse)
        }
      }

      // Convert to arrays
      const segIds = Array.from(originalSegmentReversals.keys())
      const segReversed = segIds.map((id) => originalSegmentReversals.get(id)!)

      regions.push({
        id: uuidv4(),
        faceIndex: faceSeq++,
        verticesFlattened: verts,
        segmentIds: segIds,
        segmentReversed: segReversed,
        signedArea,
        isACW: signedArea > 0
      })
    }

    node.children?.forEach(walk)
  }

  ;(faceResult.forest as CycleNode[]).forEach(walk)
  return regions
}

// Rework of src/utils/geometry.ts; should be moved there later.
export function isPointInsidePolygon(point: Point, polygon: Point[], eps = 1e-9): boolean {
  let windingNumber = 0
  let j = polygon.length - 1

  for (let i = 0; i < polygon.length; i++) {
    const pi = polygon[i]
    const pj = polygon[j]

    // Upward crossing.
    if (pj.y <= point.y + eps) {
      if (pi.y > point.y + eps && isLeft(pj, pi, point) > eps) windingNumber++
    }
    // Downward crossing.
    else {
      if (pi.y <= point.y - eps && isLeft(pj, pi, point) < -eps) windingNumber--
    }

    j = i
  }
  return windingNumber !== 0
}

export function computeTestPoint(
  region: Region,
  graph: PlanarGraph,
  epsilonFraction = 1e-3 // Fraction of mean segment length to use as epsilon.
): Point {
  // Pull coords.
  const vertices: Point[] = region.verticesFlattened.map((idx) => {
    const [x, y] = graph.nodes[idx]
    return { x, y }
  })

  // Get our actual epsilon from our mean segment length.
  let lengthTotal = 0
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i]
    const q = vertices[(i + 1) % vertices.length]
    lengthTotal += Math.hypot(q.x - p.x, q.y - p.y)
  }
  const lengthMean = lengthTotal / vertices.length
  const EPSILON_MIN = 1e-3
  const epsilon = Math.max(lengthMean * epsilonFraction, EPSILON_MIN)

  // Iterate over our line segments. We'll nudge inward, then test.
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]

    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1

    // Inward normal: go left for ACW, right for CW.
    const inward = region.isACW ? { x: -dy / len, y: dx / len } : { x: dy / len, y: -dx / len }

    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }
    const probe = { x: mid.x + inward.x * epsilon, y: mid.y + inward.y * epsilon }

    if (isPointInsidePolygon(probe, vertices)) {
      return probe
    }
  }

  // Fallback to centroid calc.
  return calculateCentroid(vertices)
}

export function determineInsideness(
  regions: Region[],
  regionTestPoints: Point[],
  segments: FlattenedSegment[]
): RegionAnnotated[] {
  if (regions.length !== regionTestPoints.length) {
    throw new Error('Region and test-point count mismatch')
  }

  // Work on a deep clone so we don't mutate the caller's data.
  const out = structuredClone(regions) as RegionAnnotated[]

  // Infinite ray.
  const makeRay = (y: number): Point => ({ x: Number.MAX_SAFE_INTEGER, y })

  for (let i = 0; i < out.length; i++) {
    const testPoint = regionTestPoints[i]
    const rayEnd = makeRay(testPoint.y)

    let crossingCount = 0 // For even-odd.
    let windingNumber = 0 // For non-zero.

    // Intersect the ray with every flattened segment.
    for (const seg of segments) {
      const { start: p1, end: p2 } = seg.geometry

      if (doesRayIntersectLineSegment(testPoint, rayEnd, p1, p2)) {
        crossingCount++
        windingNumber += calculateWindingDirection(testPoint, p1, p2)
      }
    }

    // Store result.
    out[i].crossingNumber = crossingCount
    out[i].windingNumber = windingNumber

    // We can't actually set hole flag yet, as we need to resolve containment hierarchy
    // first.
  }

  return out
}

export function resolveContainmentHierarchy(
  regions: RegionAnnotated[],
  testPoints: Point[],
  graph: PlanarGraph,
  fillRule: FillRule
): RegionAnnotated[] {
  // Build quick-reject bounding boxes for every region.
  const boundingBoxes = regions.map((region) => {
    let xMin = Infinity,
      yMin = Infinity
    let xMax = -Infinity,
      yMax = -Infinity

    for (const v of region.verticesFlattened) {
      const [x, y] = graph.nodes[v]
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }

    return { xMin, xMax, yMin, yMax }
  })

  // Walk each region and look for the *smallest* region that encloses it.
  for (let i = 0; i < regions.length; i++) {
    const childRegion = regions[i]
    const childBox = boundingBoxes[i]
    const childTestPoint = testPoints[i]

    let chosenParent: RegionAnnotated | null = null
    let smallestArea = Infinity

    for (let j = 0; j < regions.length; j++) {
      if (i === j) continue

      const candidateRegion = regions[j]
      const candidateBox = boundingBoxes[j]

      // Fast bounding-box containment test.
      const boxContains =
        candidateBox.xMin <= childBox.xMin &&
        candidateBox.xMax >= childBox.xMax &&
        candidateBox.yMin <= childBox.yMin &&
        candidateBox.yMax >= childBox.yMax

      if (!boxContains) continue

      // Precise point-in-polygon test using the child's test point..
      const candidatePolygon: Point[] = candidateRegion.verticesFlattened.map((idx) => {
        const [x, y] = graph.nodes[idx]
        return { x, y }
      })

      if (isPointInsidePolygon(childTestPoint, candidatePolygon)) {
        const candidateAreaAbs = Math.abs(candidateRegion.signedArea)
        if (candidateAreaAbs < smallestArea) {
          smallestArea = candidateAreaAbs
          chosenParent = candidateRegion
        }
      }
    }

    // Record relationship & hole status.
    if (chosenParent) {
      childRegion.parentRegionId = chosenParent.id

      if (fillRule === FillRule.EvenOdd) {
        // Even-odd: flip hole flag on each nesting.
        childRegion.isHole = !chosenParent.isHole
      } else {
        // Nonzero: compare winding directions.
        const parentW = chosenParent.windingNumber ?? 0
        const childW = childRegion.windingNumber ?? 0

        childRegion.isHole = Math.sign(parentW) !== Math.sign(childW)
      }
    } else {
      // No parent = outermost.
      childRegion.isHole = false
    }
  }

  return regions
}

export function cleanup(
  segments: FlattenedSegment[],
  regions: RegionAnnotated[],
  epsArea = 1e-4
): { regions: RegionAnnotated[]; segments: FlattenedSegment[] } {
  // We want to remove regions that are fully contained in another but which do
  // not alter the fill result.
  const keptRegions: RegionAnnotated[] = []
  const usedSegmentIds = new Set<string>()

  for (const r of regions) {
    if (Math.abs(r.signedArea) < epsArea) {
      // Too small, likely noise.
      continue
    }

    const parent = regions.find((reg) => reg.id === r.parentRegionId)

    // If region has same hole status as parent, it’s redundant.
    if (parent && r.isHole === parent.isHole) {
      continue
    }

    keptRegions.push(r)
    for (const segId of r.segmentIds) {
      usedSegmentIds.add(segId)
    }
  }

  // Keep only segments used by kept regions.
  const keptSegments = segments.filter((f) => usedSegmentIds.has(f.parentSegmentId))

  return { regions: keptRegions, segments: keptSegments }
}
