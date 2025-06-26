import { Vertex } from './vertex_collection'
import { EdgeGeometry } from './edge'
import { SplitSegment, SegmentType } from '../path_processor_v2'
import { VertexCollection } from './vertex_collection'
import { Point } from '../../types/base'
import { Line } from '../../intersections/intersections'
import { Bezier } from '../../bezier/core'
import { EPS_INTERSECTION } from '../../intersections/constants'
import { polarAngle } from '../../utils/geometry'

export interface HalfEdge {
  tail: Vertex
  head: Vertex
  twin?: HalfEdge
  next?: HalfEdge

  geometry: EdgeGeometry
  geometryReversed: boolean
}

function startPoint(seg: SplitSegment): Point {
  switch (seg.type) {
    case SegmentType.Line:
      return (seg.geometry as Line).start
    case SegmentType.QuadraticBezier:
    case SegmentType.CubicBezier:
      return (seg.geometry as Bezier).start
    case SegmentType.Arc:
      throw new Error('Arc segments are not yet supported')
  }
}
function endPoint(seg: SplitSegment): Point {
  switch (seg.type) {
    case SegmentType.Line:
      return (seg.geometry as Line).end
    case SegmentType.QuadraticBezier:
    case SegmentType.CubicBezier:
      return (seg.geometry as Bezier).end
    case SegmentType.Arc:
      throw new Error('Arc segments are not yet supported')
  }
}
function lengthSq(p: Point, q: Point): number {
  const dx = q.x - p.x,
    dy = q.y - p.y
  return dx * dx + dy * dy
}

export function buildEdgeGeometry(seg: SplitSegment): EdgeGeometry {
  switch (seg.type) {
    case SegmentType.Line: {
      const line = seg.geometry as Line
      const dx = line.end.x - line.start.x
      const dy = line.end.y - line.start.y
      return {
        type: seg.type,
        payload: line,
        tangent: () => ({ x: dx, y: dy }) // constant for a line
      }
    }

    case SegmentType.QuadraticBezier:
    case SegmentType.CubicBezier: {
      const bezier = seg.geometry as Bezier
      return {
        type: seg.type,
        payload: bezier,
        tangent: (t: number) => bezier.tangent(t) // Bezier helper already exists
      }
    }
    case SegmentType.Arc:
      throw new Error('Arc segments are not yet supported')
  }
}

export function makeHalfEdges(pieces: SplitSegment[], V: VertexCollection): HalfEdge[] {
  const halfEdges: HalfEdge[] = []

  for (const piece of pieces) {
    const pTail = startPoint(piece)
    const pHead = endPoint(piece)

    // Skip degens.
    if (lengthSq(pTail, pHead) < EPS_INTERSECTION) continue

    const vertexTail = V.getOrCreate(pTail)
    const vertexHead = V.getOrCreate(pHead)

    const geom = buildEdgeGeometry(piece)

    // Forward and reverse half-edges share the same geometry.
    const edgeForward: HalfEdge = {
      tail: vertexTail,
      head: vertexHead,
      geometry: geom,
      geometryReversed: false
    }
    const edgeReverse: HalfEdge = {
      tail: vertexHead,
      head: vertexTail,
      geometry: geom,
      geometryReversed: true
    }
    edgeForward.twin = edgeReverse
    edgeReverse.twin = edgeForward

    vertexTail.outgoing.push(edgeForward)
    vertexHead.outgoing.push(edgeReverse)

    halfEdges.push(edgeForward, edgeReverse)
  }

  return halfEdges
}

export function edgeAngle(e: HalfEdge): number {
  const t = e.geometryReversed ? 1 : 0
  const v = e.geometry.tangent(t)
  return polarAngle(v.x, v.y)
}

// export function edgeAngle(e: HalfEdge): number {
//   // Choose which end of the curve we're standing at.
//   const t = e.geometryReversed ? 1 : 0
//   let vec = e.geometry.tangent(t)

//   // Flip the vector if we're reversed.
//   if (e.geometryReversed) {
//     vec = { x: -vec.x, y: -vec.y }
//   }

//   // Fall back on chord if the tangent is (numerically) zero.
//   if (Math.abs(vec.x) + Math.abs(vec.y) < 1e-12) {
//     vec = { x: e.head.x - e.tail.x, y: e.head.y - e.tail.y }
//   }

//   return Math.atan2(vec.y, vec.x)
// }

export function findMinimalFaces(halfEdges: HalfEdge[]): HalfEdge[][] {
  // Step 1: Build adjacency structure
  const adjacency = new Map<string, HalfEdge[]>()

  for (const edge of halfEdges) {
    const headKey = `${edge.head.x},${edge.head.y}`
    if (!adjacency.has(headKey)) {
      adjacency.set(headKey, [])
    }
    adjacency.get(headKey)!.push(edge)
  }

  // Step 2: Find ALL possible faces by exhaustive search
  const allFaces: HalfEdge[][] = []
  const usedPairs = new Set<string>()

  function edgePairKey(e1: HalfEdge, e2: HalfEdge): string {
    const idx1 = halfEdges.indexOf(e1)
    const idx2 = halfEdges.indexOf(e2)
    return `${idx1}->${idx2}`
  }

  function findFacesFromEdge(startEdge: HalfEdge, path: HalfEdge[] = []): void {
    if (path.length > 15) return // Prevent infinite recursion

    const currentVertex = startEdge.head
    const vertexKey = `${currentVertex.x},${currentVertex.y}`
    const nextEdges = adjacency.get(vertexKey) || []

    for (const nextEdge of nextEdges) {
      // Don't go back on the twin edge immediately
      if (nextEdge === startEdge.twin) continue

      // Check if we've completed a cycle
      if (path.length > 0 && nextEdge === path[0]) {
        // Found a face! Check if all pairs are unused
        const fullPath = [...path, startEdge]
        let validFace = true

        for (let i = 0; i < fullPath.length; i++) {
          const curr = fullPath[i]
          const next = fullPath[(i + 1) % fullPath.length]
          const pairKey = edgePairKey(curr, next)
          if (usedPairs.has(pairKey)) {
            validFace = false
            break
          }
        }

        if (validFace && fullPath.length >= 3) {
          allFaces.push([...fullPath])
        }
        return
      }

      // Continue exploring if we haven't seen this edge in current path
      if (!path.includes(nextEdge)) {
        findFacesFromEdge(nextEdge, [...path, startEdge])
      }
    }
  }

  // Step 3: Try starting from every edge
  for (const startEdge of halfEdges) {
    findFacesFromEdge(startEdge)
  }

  // Step 4: Select minimal faces (shortest path to each region)
  // Group faces by their "region" (same set of vertices)
  const facesByRegion = new Map<string, HalfEdge[][]>()

  for (const face of allFaces) {
    const vertices = face
      .map((e) => `${e.tail.x},${e.tail.y}`)
      .sort()
      .join('|')
    if (!facesByRegion.has(vertices)) {
      facesByRegion.set(vertices, [])
    }
    facesByRegion.get(vertices)!.push(face)
  }

  // Step 5: Take the shortest face for each region
  const minimalFaces: HalfEdge[][] = []

  for (const [region, faces] of facesByRegion) {
    const shortestFace = faces.reduce((shortest, current) =>
      current.length < shortest.length ? current : shortest
    )
    minimalFaces.push(shortestFace)
  }

  // Step 6: Mark used pairs and return non-conflicting faces
  const finalFaces: HalfEdge[][] = []
  const finalUsedPairs = new Set<string>()

  // Sort by face length to prioritize smaller faces
  minimalFaces.sort((a, b) => a.length - b.length)

  for (const face of minimalFaces) {
    let canUse = true
    const facePairs: string[] = []

    for (let i = 0; i < face.length; i++) {
      const curr = face[i]
      const next = face[(i + 1) % face.length]
      const pairKey = edgePairKey(curr, next)

      if (finalUsedPairs.has(pairKey)) {
        canUse = false
        break
      }
      facePairs.push(pairKey)
    }

    if (canUse) {
      finalFaces.push(face)
      facePairs.forEach((pair) => finalUsedPairs.add(pair))
    }
  }

  return finalFaces
}
