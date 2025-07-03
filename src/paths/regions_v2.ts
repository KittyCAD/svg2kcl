import { FillRule, Point } from '../types/base'
import { HalfEdge } from './dcel/dcel'
import { SegmentType } from './path_processor_v2'
import { sampleCubicBezier, sampleQuadraticBezier } from '../utils/bezier'
import { Bezier } from '../bezier/core'
import { isPointInsidePolygon } from '../utils/polygon'
import { calculatePolygonArea } from '../utils/geometry'

const N_SAMPLES = 200

// ============================================================================
// INTERIOR POINT COMPUTATION
// ============================================================================

export function computeInteriorPoint(halfEdges: HalfEdge[], epsilon: number): Point {
  const candidates: Point[] = []
  const coarsePolygon: Point[] = []

  for (const edge of halfEdges) {
    // Sample points along the segment.
    const points = sampleHalfEdge(edge, N_SAMPLES)
    coarsePolygon.push(...points.slice(0, -1)) // Avoid duplicating the last point.

    // Compute midpoint.
    const mx = (points[0].x + points[1].x) / 2
    const my = (points[0].y + points[1].y) / 2

    // Compute tangent vector and normalize it.
    const dx = points[1].x - points[0].x
    const dy = points[1].y - points[0].y
    const len = Math.hypot(dx, dy)
    if (len === 0) continue

    // Unit normal (left-hand for ACW assumed).
    const nx = -dy / len
    const ny = dx / len

    const clockwise = isClockwise(coarsePolygon)
    const inStep = clockwise ? -epsilon : epsilon

    // Offset midpoint inward by epsilon.
    candidates.push({ x: mx + nx * inStep, y: my + ny * inStep })
  }

  for (const c of candidates) if (isPointInsidePolygon(c, coarsePolygon)) return c

  // This is a fallback if no candidate point is inside the polygon.
  // We will return the midpoint of the longest half-edge.
  let best: Point = coarsePolygon[0]
  let maxLen2 = -Infinity
  const nSamplesBackup = 20
  for (const e of halfEdges) {
    const [s, t] = sampleHalfEdge(e, nSamplesBackup)
    const len2 = (t.x - s.x) ** 2 + (t.y - s.y) ** 2
    if (len2 > maxLen2) {
      maxLen2 = len2
      best = { x: (s.x + t.x) * 0.5, y: (s.y + t.y) * 0.5 }
    }
  }
  return best
}

// ============================================================================
// SAMPLING FUNCTIONS
// ============================================================================

export function sampleHalfEdge(halfEdge: HalfEdge, numSamples: number): Point[] {
  const { geometry } = halfEdge
  switch (geometry.type) {
    case SegmentType.Line: {
      const line = geometry.payload
      return sampleLine(line.start, line.end, numSamples)
    }
    case SegmentType.QuadraticBezier: {
      const bezier = geometry.payload as Bezier
      return sampleQuadraticBezier(bezier.start, bezier.quadraticControl, bezier.end, numSamples)
    }
    case SegmentType.CubicBezier: {
      const bezier = geometry.payload as Bezier
      return sampleCubicBezier(
        bezier.start,
        bezier.control1,
        bezier.control2,
        bezier.end,
        numSamples
      )
    }
    default:
      throw new Error(`Unsupported segment type for sampling: ${geometry.type}`)
  }
}

export function sampleLine(start: Point, end: Point, numSamples: number): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples
    pts.push({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t
    })
  }
  return pts
}

// ============================================================================
// FACE EVALUATION (WINDING/CROSSING NUMBERS)
// ============================================================================

export type FaceInsideness = {
  crossingCount: number
  windingNumber: number
  evenOddInside: boolean
  nonZeroInside: boolean
}

function isClockwise(polygon: Point[]): boolean {
  const area = calculatePolygonArea(polygon)
  return area < 0 // Clockwise if area is negative.
}

function rayHitsRight(a: Point, b: Point, q: Point): boolean {
  // Is each endpoint above the horizontal line through q?
  const aAbove = a.y > q.y
  const bAbove = b.y > q.y

  // If both are on the same side, the segment cannot cross that line.
  if (aAbove === bAbove) return false

  // Compute the x-coordinate where the segment intersects the horizontal line.
  const xAtLine = a.x + ((q.y - a.y) * (b.x - a.x)) / (b.y - a.y)

  // True if the intersection is to the right of the test point.
  return xAtLine > q.x
}

function windingDelta(a: Point, b: Point, q: Point): number {
  const aAbove = a.y > q.y
  const bAbove = b.y > q.y

  // No vertical straddle: no contribution.
  if (aAbove === bAbove) return 0

  const xAtLine = a.x + ((q.y - a.y) * (b.x - a.x)) / (b.y - a.y)

  // Intersection left of the point: no contribution.
  if (xAtLine <= q.x) return 0

  // Upward crossing adds +1, downward crossing adds –1.
  return a.y < b.y ? 1 : -1
}

function sampleFaceSegments(face: HalfEdge[], samples: number): [Point, Point][] {
  const segs: [Point, Point][] = []
  for (const he of face) {
    const pts = sampleHalfEdge(he, samples)
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]])
  }
  return segs
}

function buildSegmentsByFace(dcelFaces: HalfEdge[][], samples: number): [Point, Point][][] {
  return dcelFaces.map((face) => sampleFaceSegments(face, samples))
}

export function evaluateFaces(
  dcelFaces: HalfEdge[][],
  interiorPoints: Point[],
  samples = 6
): FaceInsideness[] {
  const segByFace = buildSegmentsByFace(dcelFaces, samples)

  return interiorPoints.map((q) => {
    let crossings = 0
    let winding = 0

    for (const faceSegs of segByFace) {
      for (const [a, b] of faceSegs) {
        if (rayHitsRight(a, b, q)) crossings++
        winding += windingDelta(a, b, q)
      }
    }

    return {
      crossingCount: crossings,
      windingNumber: winding,
      evenOddInside: (crossings & 1) === 1,
      nonZeroInside: winding !== 0
    }
  })
}

// ============================================================================
// CONTAINMENT HIERARCHY
// ============================================================================

export interface ProcessedFace extends FaceInsideness {
  faceIndex: number
  face: HalfEdge[]
  interiorPoint: Point
  parentFaceIndex?: number
  childFaceIndices: number[]
  area: number
  isHole: boolean
}

export function resolveContainmentHierarchyV2(
  dcelFaces: HalfEdge[][],
  regions: FaceInsideness[],
  interiorPoints: Point[],
  fillRule: FillRule
): ProcessedFace[] {
  if (dcelFaces.length !== regions.length || dcelFaces.length !== interiorPoints.length) {
    throw new Error('dcelFaces, regions, and interiorPoints arrays must have the same length')
  }

  // Create processed faces with additional metadata
  const processedFaces: ProcessedFace[] = regions.map((region, index) => ({
    ...region,
    faceIndex: index,
    face: dcelFaces[index],
    interiorPoint: interiorPoints[index],
    childFaceIndices: [],
    area: calculateFaceArea(dcelFaces[index]),
    isHole: determineIfHole(region, fillRule)
  }))

  // Sort by area in ascending order (smallest first)
  const facesWithIndices = processedFaces.map((face, originalIndex) => ({
    face,
    originalIndex,
    area: face.area
  }))

  facesWithIndices.sort((a, b) => a.area - b.area)

  // Work from smallest to largest
  for (let i = 0; i < facesWithIndices.length; i++) {
    const current = facesWithIndices[i]

    // Skip if already has a parent
    if (current.face.parentFaceIndex !== undefined) {
      continue
    }

    // Find the smallest face that contains this one
    let smallestContainer: { face: ProcessedFace; originalIndex: number } | null = null
    let smallestContainerArea = Infinity

    for (let j = i + 1; j < facesWithIndices.length; j++) {
      const potential = facesWithIndices[j]

      // Check if current face's interior point is inside potential container
      if (isInteriorPointInside(current.face.interiorPoint, potential.face)) {
        if (potential.area < smallestContainerArea) {
          smallestContainer = { face: potential.face, originalIndex: potential.originalIndex }
          smallestContainerArea = potential.area
        }
      }
    }

    // Set parent-child relationship
    if (smallestContainer) {
      current.face.parentFaceIndex = smallestContainer.originalIndex
      smallestContainer.face.childFaceIndices.push(current.originalIndex)
    }
  }

  return processedFaces
}

function isInteriorPointInside(interiorPoint: Point, containerFace: ProcessedFace): boolean {
  // Convert container face to polygon
  const containerPolygon: Point[] = []
  for (const halfEdge of containerFace.face) {
    const points = sampleHalfEdge(halfEdge, N_SAMPLES)
    containerPolygon.push(...points.slice(0, -1))
  }

  return isPointInsidePolygon(interiorPoint, containerPolygon)
}

function determineIfHole(region: FaceInsideness, fillRule: FillRule): boolean {
  // Determine if this face should be considered a hole based on the fill rule
  if (fillRule === FillRule.NonZero) {
    return !region.nonZeroInside
  } else if (fillRule === FillRule.EvenOdd) {
    return !region.evenOddInside
  } else {
    throw new Error(`Unsupported fill rule: ${fillRule}`)
  }
}

function calculateFaceArea(face: HalfEdge[]): number {
  // Convert face to polygon and calculate area
  const polygon: Point[] = []

  for (const halfEdge of face) {
    // Sample the half edge to get points along the curve
    const points = sampleHalfEdge(halfEdge, N_SAMPLES)
    // Add all but the last point to avoid duplication
    polygon.push(...points.slice(0, -1))
  }

  return Math.abs(calculatePolygonArea(polygon))
}

// ============================================================================
// CLEANUP FUNCTIONS
// ============================================================================

export function cleanupFaceHierarchy(processedFaces: ProcessedFace[]): ProcessedFace[] {
  const facesToRemove = new Set<number>()

  // Build children map
  const childrenMap = new Map<number, ProcessedFace[]>()
  for (const face of processedFaces) {
    if (face.parentFaceIndex !== undefined) {
      if (!childrenMap.has(face.parentFaceIndex)) {
        childrenMap.set(face.parentFaceIndex, [])
      }
      childrenMap.get(face.parentFaceIndex)!.push(face)
    }
  }

  // Remove redundant faces based on correct fill logic
  for (const face of processedFaces) {
    if (facesToRemove.has(face.faceIndex)) continue

    const parentFace = processedFaces.find((f) => f.faceIndex === face.parentFaceIndex)
    if (!parentFace) continue

    // Remove redundant faces:
    // - Solid inside solid (merge)
    // - Hole inside hole (cancel out)
    const shouldRemove = (face.isHole && parentFace.isHole) || (!face.isHole && !parentFace.isHole)

    if (shouldRemove) {
      facesToRemove.add(face.faceIndex)

      // Reassign children to grandparent
      const children = childrenMap.get(face.faceIndex) || []
      for (const child of children) {
        child.parentFaceIndex = parentFace.faceIndex
        if (!parentFace.childFaceIndices.includes(child.faceIndex)) {
          parentFace.childFaceIndices.push(child.faceIndex)
        }
      }

      // Remove from parent's children list
      const parentChildIndex = parentFace.childFaceIndices.indexOf(face.faceIndex)
      if (parentChildIndex !== -1) {
        parentFace.childFaceIndices.splice(parentChildIndex, 1)
      }
    }
  }

  // Filter out the faces marked for removal
  const cleanedFaces = processedFaces.filter((face) => !facesToRemove.has(face.faceIndex))

  // Reindex the faces and update all references
  const oldToNewIndexMap = new Map<number, number>()
  cleanedFaces.forEach((face, newIndex) => {
    oldToNewIndexMap.set(face.faceIndex, newIndex)
    face.faceIndex = newIndex
  })

  // Update all parent and child references
  for (const face of cleanedFaces) {
    if (face.parentFaceIndex !== undefined) {
      const newParentIndex = oldToNewIndexMap.get(face.parentFaceIndex)
      face.parentFaceIndex = newParentIndex
    }

    face.childFaceIndices = face.childFaceIndices
      .map((oldIndex) => oldToNewIndexMap.get(oldIndex))
      .filter((newIndex) => newIndex !== undefined) as number[]
  }

  return cleanedFaces
}

function getFacePoints(face: ProcessedFace): Point[] {
  const points: Point[] = []

  for (const halfEdge of face.face) {
    // Sample the half edge to get points along the curve
    const edgePoints = sampleHalfEdge(halfEdge, N_SAMPLES)
    // Add all but the last point to avoid duplication
    points.push(...edgePoints.slice(0, -1))
  }

  return points
}

function isPolygonInsidePolygon(innerPolygon: Point[], outerPolygon: Point[]): boolean {
  // Check if all vertices of the inner polygon are inside the outer polygon
  for (const point of innerPolygon) {
    if (!isPointInsidePolygon(point, outerPolygon)) {
      return false
    }
  }

  // Additional check: ensure no edges of inner polygon intersect with outer polygon
  return !doPolygonsIntersect(innerPolygon, outerPolygon)
}

function doPolygonsIntersect(poly1: Point[], poly2: Point[]): boolean {
  // Check if any edge of poly1 intersects with any edge of poly2
  for (let i = 0; i < poly1.length; i++) {
    const p1 = poly1[i]
    const p2 = poly1[(i + 1) % poly1.length]

    for (let j = 0; j < poly2.length; j++) {
      const p3 = poly2[j]
      const p4 = poly2[(j + 1) % poly2.length]

      if (doLineSegmentsIntersect(p1, p2, p3, p4)) {
        return true
      }
    }
  }

  return false
}

function doLineSegmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  // Check if line segments p1-p2 and p3-p4 intersect
  const d1 = orientation(p3, p4, p1)
  const d2 = orientation(p3, p4, p2)
  const d3 = orientation(p1, p2, p3)
  const d4 = orientation(p1, p2, p4)

  // General case: segments intersect if they have different orientations
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }

  // Special cases: segments are collinear and overlap
  if (d1 === 0 && onSegment(p3, p1, p4)) return true
  if (d2 === 0 && onSegment(p3, p2, p4)) return true
  if (d3 === 0 && onSegment(p1, p3, p2)) return true
  if (d4 === 0 && onSegment(p1, p4, p2)) return true

  return false
}

function orientation(p: Point, q: Point, r: Point): number {
  // Calculate the orientation of the ordered triplet (p, q, r)
  return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y)
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  // Check if point q lies on segment pr (assuming p, q, r are collinear)
  return (
    q.x <= Math.max(p.x, r.x) &&
    q.x >= Math.min(p.x, r.x) &&
    q.y <= Math.max(p.y, r.y) &&
    q.y >= Math.min(p.y, r.y)
  )
}

// ============================================================================
// HIERARCHY UTILITY FUNCTIONS
// ============================================================================

export function getRootFaces(processedFaces: ProcessedFace[]): ProcessedFace[] {
  return processedFaces.filter((face) => face.parentFaceIndex === undefined)
}

export function getChildFaces(
  processedFaces: ProcessedFace[],
  parentIndex: number
): ProcessedFace[] {
  return processedFaces.filter((face) => face.parentFaceIndex === parentIndex)
}

export function traverseHierarchy(
  processedFaces: ProcessedFace[],
  visitor: (face: ProcessedFace, depth: number) => void,
  startFromRoots: boolean = true
): void {
  const visited = new Set<number>()

  function traverse(faceIndex: number, depth: number) {
    if (visited.has(faceIndex)) return
    visited.add(faceIndex)

    const face = processedFaces[faceIndex]
    visitor(face, depth)

    // Traverse children
    for (const childIndex of face.childFaceIndices) {
      traverse(childIndex, depth + 1)
    }
  }

  if (startFromRoots) {
    const rootFaces = getRootFaces(processedFaces)
    for (const rootFace of rootFaces) {
      traverse(rootFace.faceIndex, 0)
    }
  } else {
    // Traverse all faces
    for (let i = 0; i < processedFaces.length; i++) {
      traverse(i, 0)
    }
  }
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

export function validateFaceHierarchy(processedFaces: ProcessedFace[]): boolean {
  const faceIndexSet = new Set(processedFaces.map((f) => f.faceIndex))

  for (const face of processedFaces) {
    // Check that parent exists if specified
    if (face.parentFaceIndex !== undefined) {
      if (!faceIndexSet.has(face.parentFaceIndex)) {
        console.error(
          `Face ${face.faceIndex} references non-existent parent ${face.parentFaceIndex}`
        )
        return false
      }
    }

    // Check that all children exist
    for (const childIndex of face.childFaceIndices) {
      if (!faceIndexSet.has(childIndex)) {
        console.error(`Face ${face.faceIndex} references non-existent child ${childIndex}`)
        return false
      }
    }

    // Check for circular references
    if (hasCircularReference(face, processedFaces)) {
      console.error(`Circular reference detected starting from face ${face.faceIndex}`)
      return false
    }
  }

  return true
}

function hasCircularReference(
  face: ProcessedFace,
  allFaces: ProcessedFace[],
  visited = new Set<number>()
): boolean {
  if (visited.has(face.faceIndex)) {
    return true
  }

  visited.add(face.faceIndex)

  if (face.parentFaceIndex !== undefined) {
    const parent = allFaces.find((f) => f.faceIndex === face.parentFaceIndex)
    if (parent && hasCircularReference(parent, allFaces, new Set(visited))) {
      return true
    }
  }

  return false
}
