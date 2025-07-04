import { FillRule, Point } from '../types/base'
import { HalfEdge } from './dcel/dcel'
import { SegmentType } from './path_processor_v2'
import { sampleCubicBezier, sampleQuadraticBezier } from '../utils/bezier'
import { Bezier } from '../bezier/core'
import { isPointInsidePolygon } from '../utils/polygon'
import { calculatePolygonArea } from '../utils/geometry'
import { Segment } from './path_processor_v2'
import { plotFacesAndPoints } from './plot_segments'

const N_SAMPLES = 1000

// ============================================================================
// INTERIOR POINT COMPUTATION
// ============================================================================

export function computeInteriorPoint(halfEdges: HalfEdge[], epsilon: number): Point {
  const candidates: Point[] = []
  const coarsePolygon: Point[] = []

  for (const edge of halfEdges) {
    // Sample points along the segment.
    const points = sampleHalfEdge(edge, 100)
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
    // candidates.push({ x: mx - nx * inStep, y: my - ny * inStep }) // Opposite direction.
  }

  // plotFacesAndPoints([halfEdges], candidates, 'test.png')

  for (const c of candidates) {
    if (isPointInsidePolygon(c, coarsePolygon)) {
      return c
    }
  }

  // We need to plot the polygon and the candidate points to debug why no point is inside.

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
  const { geometry, geometryReversed } = halfEdge
  let output: Point[] = []
  switch (geometry.type) {
    case SegmentType.Line: {
      const line = geometry.payload

      if (geometryReversed) {
        output = sampleLine(line.end, line.start, numSamples)
      } else {
        output = sampleLine(line.start, line.end, numSamples)
      }
      break
    }
    case SegmentType.QuadraticBezier: {
      const bezier = geometry.payload as Bezier
      if (geometryReversed) {
        output = sampleQuadraticBezier(
          bezier.reversed.start,
          bezier.reversed.quadraticControl,
          bezier.reversed.end,
          numSamples
        )
      } else {
        output = sampleQuadraticBezier(
          bezier.start,
          bezier.quadraticControl,
          bezier.end,
          numSamples
        )
      }
      break
    }
    case SegmentType.CubicBezier: {
      const bezier = geometry.payload as Bezier
      if (geometryReversed) {
        output = sampleCubicBezier(
          bezier.reversed.start,
          bezier.reversed.control1,
          bezier.reversed.control2,
          bezier.reversed.end,
          numSamples
        )
      } else {
        output = sampleCubicBezier(
          bezier.start,
          bezier.control1,
          bezier.control2,
          bezier.end,
          numSamples
        )
      }
      break
    }
    default:
      throw new Error(`Unsupported segment type for sampling: ${geometry.type}`)
  }

  return output
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

export function evaluateFaces(
  interiorPoints: Point[],
  originalSegments: Segment[],
  samples = N_SAMPLES
): FaceInsideness[] {
  // Sample the ORIGINAL path segments, not the face boundaries
  const originalSegmentSamples: [Point, Point][] = []

  for (const segment of originalSegments) {
    const points = sampleOriginalSegment(segment, samples)
    for (let i = 0; i < points.length - 1; i++) {
      originalSegmentSamples.push([points[i], points[i + 1]])
    }
  }

  return interiorPoints.map((q) => {
    let crossings = 0
    let winding = 0

    // Test against the original path segments only
    for (const [a, b] of originalSegmentSamples) {
      if (rayHitsRight(a, b, q)) crossings++
      winding += windingDelta(a, b, q)
    }

    return {
      crossingCount: crossings,
      windingNumber: winding
    }
  })
}

// Helper function to sample original segments
function sampleOriginalSegment(segment: Segment, numSamples: number): Point[] {
  switch (segment.type) {
    case SegmentType.Line: {
      const line = segment.geometry as any // Line type
      return sampleLine(line.start, line.end, numSamples)
    }
    case SegmentType.QuadraticBezier: {
      const bezier = segment.geometry as Bezier
      return sampleQuadraticBezier(bezier.start, bezier.quadraticControl, bezier.end, numSamples)
    }
    case SegmentType.CubicBezier: {
      const bezier = segment.geometry as Bezier
      return sampleCubicBezier(
        bezier.start,
        bezier.control1,
        bezier.control2,
        bezier.end,
        numSamples
      )
    }
    default:
      throw new Error(`Unsupported segment type for sampling: ${segment.type}`)
  }
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

  // Sort by area in descending order (largest first) - like your old method
  const facesWithArea = processedFaces.map((face, index) => ({
    face,
    area: face.area,
    originalIndex: index
  }))
  facesWithArea.sort((a, b) => b.area - a.area)

  // PASS 1: Build hierarchy for solid regions only (non-holes)
  for (let i = 0; i < facesWithArea.length; i++) {
    const current = facesWithArea[i].face

    // Skip holes in first pass
    if (current.isHole) {
      continue
    }

    // Get all smaller regions
    const smallerFaces = facesWithArea.slice(i + 1)

    for (const { face: smaller } of smallerFaces) {
      // Skip if already has parent, is a hole, or is same region
      if (
        smaller.parentFaceIndex !== undefined ||
        smaller.isHole ||
        smaller.faceIndex === current.faceIndex
      ) {
        continue
      }

      // Check if smaller is contained in current
      if (isInteriorPointInside(smaller.interiorPoint, current)) {
        // Find most immediate parent (smallest containing region)
        let mostImmediateParent = current
        let mostImmediateParentArea = facesWithArea[i].area

        // Check for more immediate parents
        for (let j = i + 1; j < facesWithArea.length; j++) {
          const potentialParent = facesWithArea[j].face

          if (
            potentialParent.isHole ||
            potentialParent.parentFaceIndex !== undefined ||
            potentialParent.faceIndex === smaller.faceIndex
          ) {
            continue
          }

          // If potential parent contains smaller AND is contained by current
          if (
            isInteriorPointInside(smaller.interiorPoint, potentialParent) &&
            isInteriorPointInside(potentialParent.interiorPoint, current) &&
            facesWithArea[j].area < mostImmediateParentArea
          ) {
            mostImmediateParent = potentialParent
            mostImmediateParentArea = facesWithArea[j].area
          }
        }

        // Set parent relationship
        if (mostImmediateParent.faceIndex !== smaller.faceIndex) {
          smaller.parentFaceIndex = mostImmediateParent.faceIndex
          mostImmediateParent.childFaceIndices.push(smaller.faceIndex)
        }
      }
    }
  }

  // PASS 2: Assign holes to their containing solid regions
  for (const { face: hole } of facesWithArea) {
    if (!hole.isHole) {
      continue
    }

    let smallestContainingSolid: ProcessedFace | null = null
    let smallestArea = Infinity

    for (const { face: potentialParent, area } of facesWithArea) {
      // Skip holes and same region
      if (potentialParent.isHole || potentialParent.faceIndex === hole.faceIndex) {
        continue
      }

      if (isInteriorPointInside(hole.interiorPoint, potentialParent) && area < smallestArea) {
        smallestContainingSolid = potentialParent
        smallestArea = area
      }
    }

    if (smallestContainingSolid) {
      hole.parentFaceIndex = smallestContainingSolid.faceIndex
      smallestContainingSolid.childFaceIndices.push(hole.faceIndex)
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
  if (fillRule === FillRule.NonZero) {
    // Zero winding = unfilled (hole), non-zero = filled
    return region.windingNumber === 0
  } else if (fillRule === FillRule.EvenOdd) {
    // Even crossings = unfilled (hole), odd = filled
    return region.crossingCount % 2 === 0
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

  // Sort faces by area (SMALLEST TO LARGEST) - this is key!
  const facesByArea = [...processedFaces].sort((a, b) => a.area - b.area)

  // Process from smallest to largest
  for (const face of facesByArea) {
    if (facesToRemove.has(face.faceIndex)) continue

    const parentFace = processedFaces.find((f) => f.faceIndex === face.parentFaceIndex)
    if (!parentFace) continue

    // Remove redundant faces: same fill state as parent
    // - Solid inside solid (redundant - remove child)
    // - Hole inside hole (redundant - remove child)
    const shouldRemove = (face.isHole && parentFace.isHole) || (!face.isHole && !parentFace.isHole)

    if (shouldRemove) {
      facesToRemove.add(face.faceIndex)

      // Reassign this face's children to its parent (skip this redundant level)
      const children = childrenMap.get(face.faceIndex) || []
      for (const child of children) {
        child.parentFaceIndex = parentFace.faceIndex
        if (!parentFace.childFaceIndices.includes(child.faceIndex)) {
          parentFace.childFaceIndices.push(child.faceIndex)
        }
      }

      // Remove this face from parent's children list
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
