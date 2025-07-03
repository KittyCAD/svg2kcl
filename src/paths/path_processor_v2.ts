import { DiscoveryResult, PlanarFaceTree } from 'planar-face-discovery'
import { Bezier } from '../bezier/core'
import { calculateReflectedControlPoint } from '../bezier/helpers'
import { splitCubicBezierBetween, splitQuadraticBezierBetween } from '../bezier/split'
import { EPS_INTERSECTION, EPS_PARAM } from '../intersections/constants'
import {
  Arc,
  getBezierBezierIntersection,
  getBezierSelfIntersection,
  getLineBezierIntersection,
  getLineLineIntersection,
  Intersection,
  Line
} from '../intersections/intersections'
import { FillRule, Point } from '../types/base'
import { PathElement } from '../types/elements'
import { PathCommand, PathCommandType } from '../types/paths'
import { writeToJsonFile } from '../utils/debug'
import {
  calculateCentroid,
  computePointToPointDistance,
  doesRayIntersectLineSegment,
  interpolateLine,
  isLeft
} from '../utils/geometry'
import { newId } from '../utils/ids'
import { calculateWindingDirection } from '../utils/polygon'
import { findMinimalFaces, makeHalfEdges, edgeAngle } from './dcel/dcel'
import { VertexCollection } from './dcel/vertex_collection'
import { computeQuantizedPointAndKey, processSegments } from './flatboi'
import { plotFacesAndPoints, plotLinkedSplitSegments } from './plot_segments'
import { FlattenedSegment } from './segment_flattener'
import { HalfEdge } from './dcel/dcel'
import { normalizeAngle } from '../utils/geometry'
import {
  cleanupFaceHierarchy,
  computeInteriorPoint,
  evaluateFaces,
  resolveContainmentHierarchyV2
} from './regions_v2'
import type { ProcessedFace } from './regions_v2'

export enum SegmentType {
  // We'll support lines, circular arcs, and Bézier curves only.
  Line = 'Line',
  Arc = 'Arc',
  CubicBezier = 'CubicBezier',
  QuadraticBezier = 'QuadraticBezier'
}

export interface Segment {
  type: SegmentType
  id: string
  geometry: Line | Bezier // | Arc
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
  signedArea: number
  isACW: boolean
}

export interface EdgeSegmentInfo {
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
    [SegmentType.QuadraticBezier]: handleLineBezierIntersection,
    [SegmentType.Arc]: handleNotImplemented
  },
  [SegmentType.CubicBezier]: {
    [SegmentType.Line]: handleBezierLineIntersection,
    [SegmentType.CubicBezier]: handleBezierBezierIntersection,
    [SegmentType.QuadraticBezier]: handleBezierBezierIntersection,
    [SegmentType.Arc]: handleNotImplemented
  },
  [SegmentType.QuadraticBezier]: {
    [SegmentType.Line]: handleBezierLineIntersection,
    [SegmentType.CubicBezier]: handleBezierBezierIntersection,
    [SegmentType.QuadraticBezier]: handleBezierBezierIntersection,
    [SegmentType.Arc]: handleNotImplemented
  },
  [SegmentType.Arc]: {
    [SegmentType.Line]: handleNotImplemented,
    [SegmentType.CubicBezier]: handleNotImplemented,
    [SegmentType.QuadraticBezier]: handleNotImplemented,
    [SegmentType.Arc]: handleNotImplemented
  }
}

export interface SegmentIntersection {
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

const QUADRATIC_BEZIER_COMMANDS = [
  PathCommandType.QuadraticBezierAbsolute,
  PathCommandType.QuadraticBezierRelative,
  PathCommandType.QuadraticBezierSmoothAbsolute,
  PathCommandType.QuadraticBezierSmoothRelative
]

const CUBIC_BEZIER_COMMANDS = [
  PathCommandType.CubicBezierAbsolute,
  PathCommandType.CubicBezierRelative,
  PathCommandType.CubicBezierSmoothAbsolute,
  PathCommandType.CubicBezierSmoothRelative
]

const BEZIER_COMMANDS = [...QUADRATIC_BEZIER_COMMANDS, ...CUBIC_BEZIER_COMMANDS]

const ARC_COMMANDS = [PathCommandType.EllipticalArcAbsolute, PathCommandType.EllipticalArcRelative]

export interface FaceRegion {
  id: string
  segmentIds: string[]
  segmentReversed: boolean[]
  isHole: boolean
  parentRegionId?: string
  childRegionIds: string[]
  area: number
  interiorPoint: Point
  face: HalfEdge[]
}

// Simple segment map type
export type SegmentMap = Map<string, SplitSegment>

export class ProcessedPathV2 {
  constructor(
    public readonly segments: Segment[],
    public readonly segmentMap: SegmentMap,
    public readonly regions: FaceRegion[]
  ) {}

  public getSegment(id: string): SplitSegment {
    const segment = this.segmentMap.get(id)
    if (!segment) {
      throw new Error(`Segment ${id} not found.`)
    }
    return segment
  }
}

export interface FaceRegion {
  id: string
  segmentIds: string[]
  segmentReversed: boolean[]
  isHole: boolean
  parentRegionId?: string
  childRegionIds: string[]
  // Additional metadata
  area: number
  interiorPoint: Point
  face: HalfEdge[]
}

function extractTopologicalEdges(pieces: SplitSegment[]): SplitSegment[] {
  const edgeMap = new Map<string, SplitSegment>()

  for (const piece of pieces) {
    const start = piece.geometry.start
    const end = piece.geometry.end

    // Get quantized keys for start and end points
    const startResult = computeQuantizedPointAndKey(start)
    const endResult = computeQuantizedPointAndKey(end)

    // Create a more specific key that includes geometry type and path shape
    let geometryKey = 'line'

    if (piece.type === SegmentType.QuadraticBezier) {
      const pieceGeometry = piece.geometry as Bezier
      const ctrl = pieceGeometry.quadraticControl
      const ctrlResult = computeQuantizedPointAndKey(ctrl)
      geometryKey = `quad_ctrl${ctrlResult.key}`
    } else if (piece.type === SegmentType.CubicBezier) {
      const pieceGeometry = piece.geometry as Bezier
      const c1 = pieceGeometry.control1
      const c2 = pieceGeometry.control2
      const c1Result = computeQuantizedPointAndKey(c1)
      const c2Result = computeQuantizedPointAndKey(c2)
      geometryKey = `cube_ctrl1${c1Result.key}_ctrl2${c2Result.key}`
    }

    const key = `${startResult.key}>${endResult.key}_${geometryKey}`

    // Only deduplicate truly identical edges (same geometry + same path)
    if (!edgeMap.has(key)) {
      edgeMap.set(key, piece)
    }
  }

  return Array.from(edgeMap.values())
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
  const linkedSegmentPieces = splitSegments(allSegments, intersections)

  plotLinkedSplitSegments(linkedSegmentPieces, '01_linked_split_segments.png')

  // -----------------------------------------------------------------------------------
  // Flattened idea.
  // processSegments(linkedSegmentPieces, intersections)

  // -----------------------------------------------------------------------------------
  // DCEL
  const dcelFaces = processDcel(linkedSegmentPieces)

  // -----------------------------------------------------------------------------------

  // Now we need to actually build the hierarchy of regions.
  // 1: Get an interior point for each face.
  let interiorPoints: Point[] = []
  for (const face of dcelFaces) {
    const interiorPoint = computeInteriorPoint(face, 0.1)
    interiorPoints.push(interiorPoint)
  }

  // Plot faces and points.
  plotFacesAndPoints(dcelFaces, interiorPoints, '02_faces_and_points.png')

  // Now do the winding number and crossing number calculations.
  const regions = evaluateFaces(dcelFaces, interiorPoints, 100)

  // Get hierarchy.
  const processedFaces = resolveContainmentHierarchyV2(dcelFaces, regions, interiorPoints)

  // Now we can remove redundant faces.
  const cleanedProcessedFaces = cleanupFaceHierarchy(processedFaces)

  const result = createProcessedPathV2(linkedSegmentPieces, cleanedProcessedFaces)

  // Remove head and tail fields from face so we can write out.
  // const jsonSafeResult = {
  //   ...result,
  //   regions: result.regions.map(({ face, ...rest }) => rest)
  // }
  // writeToJsonFile(jsonSafeResult, 'processed_path_v2.json')

  return result
}

function convertToFaceRegions(
  processedFaces: ProcessedFace[],
  generateId: (index: number) => string = (i) => `region_${i}`
): FaceRegion[] {
  // Create regions with string IDs
  const regions: FaceRegion[] = processedFaces.map((face, index) => {
    // Extract segment IDs and reversed flags from the face
    const segmentIds: string[] = []
    const segmentReversed: boolean[] = []

    for (const halfEdge of face.face) {
      segmentIds.push(halfEdge.geometry.segmentID)
      segmentReversed.push(halfEdge.geometryReversed)
    }

    return {
      id: generateId(index),
      segmentIds,
      segmentReversed,
      isHole: face.isHole,
      parentRegionId: undefined, // Will be set below
      childRegionIds: [],
      area: face.area,
      interiorPoint: face.interiorPoint,
      face: face.face
    }
  })

  // Build ID mapping from face index to region ID
  const indexToIdMap = new Map<number, string>()
  regions.forEach((region, index) => {
    indexToIdMap.set(index, region.id)
  })

  // Set parent-child relationships using string IDs
  for (let i = 0; i < processedFaces.length; i++) {
    const face = processedFaces[i]
    const region = regions[i]

    // Set parent
    if (face.parentFaceIndex !== undefined) {
      const parentId = indexToIdMap.get(face.parentFaceIndex)
      if (parentId) {
        region.parentRegionId = parentId
      }
    }

    // Set children
    region.childRegionIds = face.childFaceIndices
      .map((childIndex) => indexToIdMap.get(childIndex))
      .filter((id) => id !== undefined) as string[]
  }

  return regions
}

export function createProcessedPathV2(
  linkedSegmentPieces: SplitSegment[],
  cleanedProcessedFaces: ProcessedFace[]
): ProcessedPathV2 {
  // Create segment map
  const segmentMap = new Map<string, SplitSegment>()
  linkedSegmentPieces.forEach((segment) => {
    segmentMap.set(segment.id, segment)
  })

  // Convert processed faces to regions
  const regions = convertToFaceRegions(cleanedProcessedFaces)

  return new ProcessedPathV2(linkedSegmentPieces, segmentMap, regions)
}

function processDcel(linkedSegmentPieces: SplitSegment[]): HalfEdge[][] {
  const topologicalEdges = extractTopologicalEdges(linkedSegmentPieces)
  const prunedTopologicalEdges = pruneExactDuplicates(topologicalEdges)
  const vertexCollection = new VertexCollection(EPS_INTERSECTION)
  const halfEdges = makeHalfEdges(prunedTopologicalEdges, vertexCollection)

  console.log('\n=== DEBUGGING NEXT POINTERS ===')
  halfEdges.forEach((edge, i) => {
    const nextIdx = edge.next ? halfEdges.indexOf(edge.next) : -1
    const twinIdx = halfEdges.indexOf(edge.twin!)
    console.log(
      `Edge ${i}: (${edge.tail.x},${edge.tail.y})->(${edge.head.x},${edge.head.y}) twin:${twinIdx} next:${nextIdx}`
    )
  })

  // DEBUG
  const v9050 = Array.from(vertexCollection.vertices()).find(
    (v) => Math.abs(v.x - 90) < 1e-3 && Math.abs(v.y - 50) < 1e-3
  )

  if (v9050) {
    console.log('\n[BEFORE SORT] Outgoing @ (90,50):')
    v9050.outgoing.forEach((e, i) => {
      const ang = (edgeAngle(e) * 180) / Math.PI
      console.log(
        `  ${i}: halfEdgeIdx=${halfEdges.indexOf(e)}, ` +
          `tail=(${e.tail.x},${e.tail.y}), head=(${e.head.x},${e.head.y}), ` +
          `angle=${ang.toFixed(2)}°, geom=${e.geometry.type}, rev=${e.geometryReversed}`
      )
    })
  }

  // Now we need to sort our outgoing edges.
  vertexCollection.finalizeRotation()

  if (v9050) {
    console.log('\n[SORT DEBUG] Normalized angles & tie-break keys @ (90,50):')
    const priority = {
      [SegmentType.Line]: 0,
      [SegmentType.QuadraticBezier]: 1,
      [SegmentType.CubicBezier]: 2,
      [SegmentType.Arc]: 3
    }
    v9050.outgoing.forEach((e, i) => {
      const rawAngle = edgeAngle(e)
      const normAngle = (normalizeAngle(rawAngle) * 180) / Math.PI
      const geomPrio = priority[e.geometry.type] ?? 99
      const revFlag = e.geometryReversed ? 1 : 0
      console.log(
        `  idx ${i}: halfEdgeIdx=${halfEdges.indexOf(e)}, ` +
          `head=(${e.head.x},${e.head.y}), ` +
          `angle(raw)=${((rawAngle * 180) / Math.PI).toFixed(2)}°, ` +
          `angle(norm)=${normAngle.toFixed(2)}°, ` +
          `prio=${geomPrio}, rev=${revFlag}`
      )
    })
  }

  // MORE DEBUG
  if (v9050) {
    console.log('\n[AFTER SORT] Outgoing @ (90,50):')
    v9050.outgoing.forEach((e, i) => {
      const ang = (edgeAngle(e) * 180) / Math.PI
      const idx = halfEdges.indexOf(e)
      const twinIdx = halfEdges.indexOf(e.twin!)
      const nextEdge = e.twin!.next
      const nextIdx = nextEdge ? halfEdges.indexOf(nextEdge) : -1

      console.log(
        `  ${i}: halfEdgeIdx=${idx}, ` +
          `tail=(${e.tail.x},${e.tail.y}), head=(${e.head.x},${e.head.y}), ` +
          `angle=${ang.toFixed(2)}°, geom=${e.geometry.type}, rev=${e.geometryReversed}, ` +
          `twin=${twinIdx}, twin.next=${nextIdx}`
      )
    })
  }

  // Quick peek at a handful of half-edges.
  console.table(
    halfEdges.map((e, i) => ({
      i,
      tail: `(${e.tail.x},${e.tail.y})`,
      head: `(${e.head.x},${e.head.y})`,
      dir: e.geometryReversed ? 'rev' : 'fwd',
      twin: halfEdges.indexOf(e.twin!),
      next: e.next ? halfEdges.indexOf(e.next) : -1
    }))
  )
  // Vertex stats.
  vertexCollection.dump()

  // Walk faces???
  const faces = findMinimalFaces(halfEdges)

  // Get debug list of face geometries.
  const faceGeometries = []
  for (const face of faces) {
    const faceGeometryElements = face.map((e) => {
      return {
        type: e.geometry.type,
        start: e.geometryReversed
          ? { x: e.geometry.payload.end.x, y: e.geometry.payload.end.y }
          : { x: e.geometry.payload.start.x, y: e.geometry.payload.start.y },
        end: e.geometryReversed
          ? { x: e.geometry.payload.start.x, y: e.geometry.payload.start.y }
          : { x: e.geometry.payload.end.x, y: e.geometry.payload.end.y }
      }
    })
    faceGeometries.push(faceGeometryElements)
  }
  writeToJsonFile(faceGeometries, 'face_geometries.json')
  plotLinkedSplitSegments(linkedSegmentPieces, '01_linked_split_segments.png')

  return faces
}

function pruneExactDuplicates(pieces: SplitSegment[]): SplitSegment[] {
  const seen = new Map<string, SplitSegment>()

  for (const piece of pieces) {
    const { start, end } = piece.geometry

    // Quantize & stringify endpoints
    const a = `${start.x.toFixed(3)},${start.y.toFixed(3)}`
    const b = `${end.x.toFixed(3)},${end.y.toFixed(3)}`
    // Directed key so reversed (A->B vs B->A) stay separate if geometry differs
    const endpointKey = `${a}|${b}`

    // Now append a 'geometry signature' so only identical curves collide
    let geomKey = piece.type as string
    if (piece.type === SegmentType.QuadraticBezier) {
      const c = (piece.geometry as Bezier).quadraticControl
      geomKey += `|ctrl:${c.x.toFixed(3)},${c.y.toFixed(3)}`
    } else if (piece.type === SegmentType.CubicBezier) {
      const { control1, control2 } = piece.geometry as any
      geomKey +=
        `|c1:${control1.x.toFixed(3)},${control1.y.toFixed(3)}` +
        `|c2:${control2.x.toFixed(3)},${control2.y.toFixed(3)}`
    }
    // Arcs could include radius/flags in geomKey similarly...

    const key = `${endpointKey}|${geomKey}`

    if (!seen.has(key)) {
      seen.set(key, piece)
    }
  }

  return Array.from(seen.values())
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
        id: newId('subpath'),
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

      result = Bezier.cubic({
        start: { x: currentPoint.x, y: currentPoint.y },
        control1: { x: x1, y: y1 },
        control2: { x: x2, y: y2 },
        end: { x, y }
      })
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

      result = Bezier.cubic({
        start: { x: currentPoint.x, y: currentPoint.y },
        control1: { x: x1Abs, y: y1Abs },
        control2: { x: x2Abs, y: y2Abs },
        end: { x: xAbs, y: yAbs }
      })
      break
    }
    case PathCommandType.CubicBezierSmoothAbsolute: {
      const [x2, y2, x, y] = command.parameters

      // Reflect the previous control point.
      const control1 = calculateReflectedControlPoint(previousControlPoint, currentPoint)

      result = Bezier.cubic({
        start: { x: currentPoint.x, y: currentPoint.y },
        control1: control1,
        control2: { x: x2, y: y2 },
        end: { x, y }
      })
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
      const control1 = calculateReflectedControlPoint(previousControlPoint, currentPoint)

      result = Bezier.cubic({
        start: { x: currentPoint.x, y: currentPoint.y },
        control1: control1,
        control2: { x: x2Abs, y: y2Abs },
        end: { x: xAbs, y: yAbs }
      })
      break
    }
    case PathCommandType.QuadraticBezierAbsolute: {
      const [x1, y1, x, y] = command.parameters

      const quadraticForm = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control: { x: x1, y: y1 },
        end: { x, y }
      }

      // This is a bit verbose but clear.
      result = Bezier.quadratic({
        start: quadraticForm.start,
        control: quadraticForm.control,
        end: quadraticForm.end
      })
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

      // This is a bit verbose but clear.
      result = Bezier.quadratic({
        start: quadraticForm.start,
        control: quadraticForm.control,
        end: quadraticForm.end
      })
      break
    }
    case PathCommandType.QuadraticBezierSmoothAbsolute: {
      const [x, y] = command.parameters

      // Reflect the previous control point.
      const control = calculateReflectedControlPoint(previousControlPoint, currentPoint)

      // Convert to cubic Bézier.
      const quadraticForm = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control: control,
        end: { x: x, y: y }
      }

      result = Bezier.quadratic({
        start: quadraticForm.start,
        control: quadraticForm.control,
        end: quadraticForm.end
      })
      break
    }
    case PathCommandType.QuadraticBezierSmoothRelative: {
      const [x, y] = command.parameters

      // Convert relative coordinates to absolute.
      const xAbs = currentPoint.x + x
      const yAbs = currentPoint.y + y

      // Reflect the previous control point.
      const control = calculateReflectedControlPoint(previousControlPoint, currentPoint)

      // Convert to cubic Bézier.
      const quadraticForm = {
        start: { x: currentPoint.x, y: currentPoint.y },
        control: control,
        end: { x: xAbs, y: yAbs }
      }

      // This is a bit verbose but clear.
      result = Bezier.quadratic({
        start: quadraticForm.start,
        control: quadraticForm.control,
        end: quadraticForm.end
      })
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
      idCurrentSegment = newId('segment')
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
      // For cubics:
      // - Smooth commands need to have their control point reflected and inserted.
      // - All must be converted to absolute.
      idCurrentSegment = newId('segment')
      const bezier = normalizeBezierCommand(
        command,
        command.startPositionAbsolute,
        previousControlPoint
      )

      let bezierType: SegmentType
      if (bezier.isCubic) {
        bezierType = SegmentType.CubicBezier
      } else if (bezier.isQuadratic) {
        bezierType = SegmentType.QuadraticBezier
      } else {
        throw new Error('Unknown Bézier type.')
      }
      const bezierSegment: Segment = {
        type: bezierType,
        id: idCurrentSegment,
        geometry: bezier,
        idSubpath: subpath.id,
        idPrevSegment: idPrevSegment,
        idNextSegment: null
      }

      segments.push(bezierSegment)
      newPreviousControlPoint = bezier.finalControlPoint
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

function isWithinTolerance(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) < tolerance
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

      // We need to look at topology; it's only an intersection point if it's not
      // the joining extrema of two connected segments.
      const segmentsSequential = seg1.idNextSegment === seg2.id && seg2.idPrevSegment === seg1.id
      const segmentsSequentialReversed =
        seg2.idNextSegment === seg1.id && seg1.idPrevSegment === seg2.id

      if (segmentsSequential || segmentsSequentialReversed) {
        intersections = intersections.filter((intersection) => {
          if (segmentsSequential) {
            // Remove t = 1 from seg1 and t = 0 from seg2.
            return (
              !isWithinTolerance(intersection.t1, 1, EPS_PARAM) &&
              !isWithinTolerance(intersection.t2, 0, EPS_PARAM)
            )
          } else {
            // Remove t = 0 from seg1 and t = 1 from seg2.
            return (
              !isWithinTolerance(intersection.t1, 0, EPS_PARAM) &&
              !isWithinTolerance(intersection.t2, 1, EPS_PARAM)
            )
          }
        })
      }

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

function splitLineBetween(line: Line, tMin: number, tMax: number): Line {
  // Split a line segment at the given tMin and tMax values.

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

function splitArcBetween(arc: Arc, tMin: number, tMax: number): SplitSegment[] {
  // Split an arc segment at the given tMin and tMax values.
  // For now, we will not implement this as arcs are not yet supported.
  throw new Error('Arc splitting is not yet implemented')
}

function deduplicateWithThreshold(arr: number[], threshold: number): number[] {
  if (arr.length === 0) return []

  const sorted = [...arr].sort((a, b) => a - b)
  const result = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i] - result[result.length - 1]) > threshold) {
      result.push(sorted[i])
    }
  }

  return result
}

function splitSegments(segments: Segment[], intersections: SegmentIntersection[]): SplitSegment[] {
  // Build map of segment IDs to their intersection t-values
  const segmentTMap = new Map<string, number[]>()
  const segmentIntersectionMap = new Map<string, Map<number, Point>>() // Change to map t-values to points

  // Initialize arrays for all segments first.
  for (const segment of segments) {
    segmentTMap.set(segment.id, [])
    segmentIntersectionMap.set(segment.id, new Map<number, Point>())
  }

  // Now populate the t-values.
  for (const intersection of intersections) {
    const seg1TValues = segmentTMap.get(intersection.idSeg1)
    const seg2TValues = segmentTMap.get(intersection.idSeg2)

    if (!seg1TValues || !seg2TValues) throw new Error('Intersection references unknown segment.')

    seg1TValues.push(intersection.intersection.t1)
    seg2TValues.push(intersection.intersection.t2)

    // Store the intersection points keyed by their t-values
    segmentIntersectionMap
      .get(intersection.idSeg1)
      ?.set(intersection.intersection.t1, intersection.intersection.point)
    segmentIntersectionMap
      .get(intersection.idSeg2)
      ?.set(intersection.intersection.t2, intersection.intersection.point)
  }

  // Create lookup for segments by ID.
  const segmentLookup = new Map<string, Segment>()
  for (const segment of segments) {
    segmentLookup.set(segment.id, segment)
  }

  const result: SplitSegment[] = []
  const segmentPieces = new Map<string, SplitSegment[]>() // Track pieces for each original segment

  for (const segment of segments) {
    // Get the t-values for this segment, filtering out endpoints because splitting there
    // doesn't do anything. We use EPS_PARAM to filter out very small t-values close to
    // 0 or 1.
    let currentSegmentT = segmentTMap.get(segment.id) || []
    currentSegmentT = currentSegmentT.filter((t) => t > EPS_PARAM && t < 1 - EPS_PARAM)

    // Segment has no intersections, so we can just push it as is.
    if (currentSegmentT.length === 0) {
      // Push this segment as is; no parent.
      const unsplitSegment = {
        ...segment,
        idParentSegment: null // No parent segment since this is not split.
      } as SplitSegment

      segmentPieces.set(segment.id, [unsplitSegment])
      result.push(unsplitSegment)

      continue
    }

    // Deduplicate the t-values so we don't get any weirdness here.
    currentSegmentT = deduplicateWithThreshold(currentSegmentT, EPS_PARAM)

    // Pad, sort, and filter the t-values.
    const currentSegmentTFull = [0, ...currentSegmentT, 1]
      .sort((a, b) => a - b)
      .filter((t, i, arr) => t >= 0 && t <= 1 && arr.indexOf(t) === i)

    // Create split segments for each t-range.
    const splitPieces: SplitSegment[] = []

    for (let i = 0; i < currentSegmentTFull.length - 1; i++) {
      const t1 = currentSegmentTFull[i]
      const t2 = currentSegmentTFull[i + 1]

      // Handle start and end vs. intersection points.
      const intersectionPointStart =
        segmentIntersectionMap.get(segment.id)?.get(t1) || segment.geometry.start
      const intersectionPointEnd =
        segmentIntersectionMap.get(segment.id)?.get(t2) || segment.geometry.end

      // Skip zero-length segments.
      if (t2 - t1 < EPS_PARAM) continue

      const splitSegmentId = newId('splitSegment')
      let splitSegment: SplitSegment

      switch (segment.type) {
        case SegmentType.Line:
          splitSegment = {
            id: splitSegmentId,
            idSubpath: segment.idSubpath,
            idParentSegment: segment.id,
            type: segment.type,
            geometry: splitLineBetween(segment.geometry as Line, t1, t2),
            idPrevSegment: null, // Will be set below.
            idNextSegment: null // Will be set below.
          }
          break
        case SegmentType.QuadraticBezier:
          const orginalQuad = segment.geometry as Bezier

          // Inject the intersection points into the split geometry.
          const rawSplitQuad = splitQuadraticBezierBetween(orginalQuad, t1, t2)
          const quad = Bezier.quadratic({
            start: intersectionPointStart,
            control: rawSplitQuad.quadraticControl,
            end: intersectionPointEnd
          })

          splitSegment = {
            id: splitSegmentId,
            idSubpath: segment.idSubpath,
            idParentSegment: segment.id,
            type: segment.type,
            geometry: quad,
            idPrevSegment: null,
            idNextSegment: null
          }
          break
        case SegmentType.CubicBezier:
          const originalCube = segment.geometry as Bezier

          // Inject the intersection points into the split geometry.
          const rawSplitCube = splitCubicBezierBetween(originalCube, t1, t2)
          const cube = Bezier.cubic({
            start: intersectionPointStart,
            control1: rawSplitCube.control1,
            control2: rawSplitCube.control2,
            end: intersectionPointEnd
          })

          splitSegment = {
            id: splitSegmentId,
            idSubpath: segment.idSubpath,
            idParentSegment: segment.id,
            type: segment.type,
            geometry: cube,
            idPrevSegment: null,
            idNextSegment: null
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

    segmentPieces.set(segment.id, splitPieces)
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
      if (computePointToPointDistance(p, { x: nx, y: ny }) < EPS_INTERSECTION) return i
    }
    const id = nodes.length
    nodes.push([p.x, p.y])
    return id
  }
}

function computePointToPointDistanceSq(p1: Point, p2: Point): number {
  const dx = p1.x - p2.x
  const dy = p1.y - p2.y
  return dx * dx + dy * dy
}

export function buildPlanarGraphFromFlattenedSegments(
  flattenedSegments: FlattenedSegment[],
  linkedSplitSegments: SplitSegment[]
): PlanarGraph {
  const nodes: Array<[number, number]> = []
  const edgeSegmentMap = new Map<string, EdgeSegmentInfo>()

  function getNodeId(point: Point): number {
    const epsilonSq = EPS_INTERSECTION * EPS_INTERSECTION
    for (let i = 0; i < nodes.length; i++) {
      const [nx, ny] = nodes[i]
      if (computePointToPointDistanceSq(point, { x: nx, y: ny }) < epsilonSq) {
        return i
      }
    }
    const newId = nodes.length
    nodes.push([point.x, point.y])
    return newId
  }

  const edgeSet = new Set<string>()

  // Build lookup for split segments
  const splitSegmentLookup = new Map<string, SplitSegment>()
  for (const segment of linkedSplitSegments) {
    splitSegmentLookup.set(segment.id, segment)
  }

  // Group flattened segments by their parent split segment ID
  const segmentGroups = new Map<string, FlattenedSegment[]>()
  for (const tinySegment of flattenedSegments) {
    const parentId = tinySegment.parentSegmentId
    if (!segmentGroups.has(parentId)) {
      segmentGroups.set(parentId, [])
    }
    segmentGroups.get(parentId)!.push(tinySegment)
  }

  // CRUCIAL: Process each split segment as a sequential chain
  for (const [parentSplitSegmentId, tinySegments] of segmentGroups) {
    if (tinySegments.length === 0) continue

    const parentSegment = splitSegmentLookup.get(parentSplitSegmentId)
    if (!parentSegment) continue

    // Sort by distance from parent start to ensure proper order
    const parentStart = getSegmentStartPoint(parentSegment)
    tinySegments.sort((a, b) => {
      const distA = computePointToPointDistanceSq(a.geometry.start, parentStart)
      const distB = computePointToPointDistanceSq(b.geometry.start, parentStart)
      return distA - distB
    })

    // Create sequential edges - this is what we were missing!
    for (let i = 0; i < tinySegments.length; i++) {
      const tinySegment = tinySegments[i]
      const startNodeId = getNodeId(tinySegment.geometry.start)
      const endNodeId = getNodeId(tinySegment.geometry.end)

      // Always connect start to end of each tiny segment
      if (startNodeId !== endNodeId) {
        const a = Math.min(startNodeId, endNodeId)
        const b = Math.max(startNodeId, endNodeId)
        const edgeKey = `${a},${b}`

        if (!edgeSet.has(edgeKey)) {
          edgeSet.add(edgeKey)
          edgeSegmentMap.set(edgeKey, {
            segmentId: parentSplitSegmentId,
            isReversed: false
          })
        }
      }

      // Connect to the next tiny segment in the sequence
      if (i < tinySegments.length - 1) {
        const nextTinySegment = tinySegments[i + 1]
        const currentEndNodeId = endNodeId
        const nextStartNodeId = getNodeId(nextTinySegment.geometry.start)

        if (currentEndNodeId !== nextStartNodeId) {
          const a = Math.min(currentEndNodeId, nextStartNodeId)
          const b = Math.max(currentEndNodeId, nextStartNodeId)
          const edgeKey = `${a},${b}`

          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey)
            edgeSegmentMap.set(edgeKey, {
              segmentId: parentSplitSegmentId,
              isReversed: false
            })
          }
        }
      }
    }
  }

  // Handle connections between split segments
  for (const splitSegment of linkedSplitSegments) {
    if (!splitSegment.idNextSegment) continue

    const nextSegment = splitSegmentLookup.get(splitSegment.idNextSegment)
    if (!nextSegment) continue

    const currentEndPoint = getSegmentEndPoint(splitSegment)
    const nextStartPoint = getSegmentStartPoint(nextSegment)

    const currentEndNodeId = getNodeId(currentEndPoint)
    const nextStartNodeId = getNodeId(nextStartPoint)

    if (currentEndNodeId !== nextStartNodeId) {
      const a = Math.min(currentEndNodeId, nextStartNodeId)
      const b = Math.max(currentEndNodeId, nextStartNodeId)
      const edgeKey = `${a},${b}`

      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey)
        edgeSegmentMap.set(edgeKey, {
          segmentId: `connection_${splitSegment.id}_${nextSegment.id}`,
          isReversed: false
        })
      }
    }
  }

  const edges: Array<[number, number]> = Array.from(edgeSet, (key) => {
    const [a, b] = key.split(',').map(Number)
    return [a, b]
  })

  return {
    nodes,
    edges,
    edgeSegmentMap
  }
}

// Helper functions
function getSegmentEndPoint(segment: SplitSegment): Point {
  switch (segment.type) {
    case SegmentType.Line:
      return (segment.geometry as Line).end
    case SegmentType.QuadraticBezier:
    case SegmentType.CubicBezier:
      return (segment.geometry as Bezier).end
    default:
      throw new Error(`Unsupported segment type: ${segment.type}`)
  }
}

function getSegmentStartPoint(segment: SplitSegment): Point {
  switch (segment.type) {
    case SegmentType.Line:
      return (segment.geometry as Line).start
    case SegmentType.QuadraticBezier:
    case SegmentType.CubicBezier:
      return (segment.geometry as Bezier).start
    default:
      throw new Error(`Unsupported segment type: ${segment.type}`)
  }
}

export function getFaces(graph: PlanarGraph): DiscoveryResult {
  const solver = new PlanarFaceTree()
  const faceForest = solver.discover(graph.nodes, graph.edges)
  if (faceForest.type === 'RESULT') return faceForest
  throw new Error('Face discovery failed')
}

function processFaceTree(regions: Region[], tree: any, parentRegionId?: string) {
  if (tree.cycle && tree.cycle.length >= 3) {
    // Minimum 3 nodes for a valid face.
    const regionId = newId('region')

    // Since we did planar graph discovery with flattened (sampled) segments,
    // we are expecting all faces to be composed of full split segments.

    // To check: iterate over the cycle (face) and collect segment IDs, the we can
    // deduplicate them.
    const segmentIds: string[] = []
    const segmentReversed: boolean[] = []
    for (const node of tree.cycle) {
      let x = 1
    }

    // Process children with this as the parent.
    if (tree.children && tree.children.length > 0) {
      for (const child of tree.children) {
        processFaceTree(child, regionId)
      }
    }
  }
  // Process children even if this face doesn't have a valid cycle.
  else if (tree.children && tree.children.length > 0) {
    for (const child of tree.children) {
      processFaceTree(child, parentRegionId)
    }
  }
}

export function buildRegionsFromFaces(
  graph: PlanarGraph,
  faceForest: DiscoveryResult,
  segmentsFlattened: FlattenedSegment[],
  segments: SplitSegment[]
): { regions: Region[]; regionVertexIds: number[][] } {
  const regions: Region[] = []
  const regionVertexIds: number[][] = []

  // Build a map of segment ID to linked split segment.
  const segmentMap = new Map<string, SplitSegment>()
  for (const seg of segments) {
    segmentMap.set(seg.id, seg)
  }

  // Build a map of vertex IDs to linked and split segments.
  // edgeSegmentMap on the graph object maps from edge (defined as a pair of vertex IDs)
  // to segment ID and direction (reversed or not).
  const x = 1

  // Iterate over face forst and process each face.
  for (const rootFace of faceForest.forest) {
    processFaceTree(regions, rootFace, undefined)
  }

  // -----------------------------------------------------------------------------------

  return { regions, regionVertexIds }
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
  vertexIds: number[], // Flattened vertex IDs.
  epsilonFraction = 1e-3 // Fraction of mean segment length to use as epsilon.
): Point {
  // Pull coords.
  const vertices: Point[] = vertexIds.map((idx: number) => {
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
  regionVertexIds: number[][],
  graph: PlanarGraph,
  fillRule: FillRule
): RegionAnnotated[] {
  // Build quick-reject bounding boxes for every region.
  const boundingBoxes = regions.map((region, i) => {
    let xMin = Infinity,
      yMin = Infinity
    let xMax = -Infinity,
      yMax = -Infinity

    for (const v of regionVertexIds[i]) {
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
      const candidateRegionVertexIds = regionVertexIds[j]
      const candidateBox = boundingBoxes[j]

      // Fast bounding-box containment test.
      const boxContains =
        candidateBox.xMin <= childBox.xMin &&
        candidateBox.xMax >= childBox.xMax &&
        candidateBox.yMin <= childBox.yMin &&
        candidateBox.yMax >= childBox.yMax

      if (!boxContains) continue

      // Precise point-in-polygon test using the child's test point..
      const candidatePolygon: Point[] = candidateRegionVertexIds.map((idx) => {
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
