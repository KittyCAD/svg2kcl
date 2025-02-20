import { v4 as uuidv4 } from 'uuid'
import { Point } from '../types/base'
import { FragmentMap, PathFragmentType } from '../types/fragments'
import { PathFragment } from './fragments/fragment'
import {
  computeAngleBetweenVectors,
  isPointInsidePolygon,
  computeTangentToCubicFragment,
  computeTangentToQuadraticFragment
} from '../utils/geometry'
import { PathRegion } from '../types/regions'
import { EPSILON_INTERSECT } from '../constants'
import { orderRegions } from './regions'
import { calculateBoundingBox } from './fragments/fragment'

const CURVED_TYPE = [PathFragmentType.Cubic, PathFragmentType.Quad]

const tangentMap = {
  [PathFragmentType.Cubic]: computeTangentToCubicFragment,
  [PathFragmentType.Quad]: computeTangentToQuadraticFragment
}

class HalfEdge {
  id: string
  startVertexKey: string
  endVertexKey: string
  fragmentId: string
  fragment: PathFragment // Store the actual fragment for curve info

  twin?: HalfEdge
  next?: HalfEdge
  faceId?: string

  constructor(startKey: string, endKey: string, fragment: PathFragment) {
    this.id = uuidv4()
    this.startVertexKey = startKey
    this.endVertexKey = endKey
    this.fragmentId = fragment.id
    this.fragment = fragment
  }
}

class Vertex {
  key: string
  point: Point
  outgoing: HalfEdge[]

  constructor(key: string, point: Point) {
    this.key = key
    this.point = point
    this.outgoing = []
  }
}

class PlanarGraph {
  vertices: Map<string, Vertex> = new Map()
  halfEdges: HalfEdge[] = []
}

function pointKey(pt: Point, precision: number = 1e-5): string {
  const rx = Math.round(pt.x / precision) * precision
  const ry = Math.round(pt.y / precision) * precision
  return `${rx},${ry}`
}

function buildPlanarGraph(fragments: PathFragment[]): PlanarGraph {
  const graph = new PlanarGraph()

  // Collect vertices from both endpoints and sampled points for curves
  for (const fr of fragments) {
    // Add start and end points
    const startK = pointKey(fr.start)
    const endK = pointKey(fr.end)

    if (!graph.vertices.has(startK)) {
      graph.vertices.set(startK, new Vertex(startK, fr.start))
    }
    if (!graph.vertices.has(endK)) {
      graph.vertices.set(endK, new Vertex(endK, fr.end))
    }

    // For curved fragments, add intermediate sampled points
    if (fr.sampledPoints && fr.sampledPoints.length > 2) {
      for (let i = 1; i < fr.sampledPoints.length - 1; i++) {
        const pt = fr.sampledPoints[i]
        const k = pointKey(pt)
        if (!graph.vertices.has(k)) {
          graph.vertices.set(k, new Vertex(k, pt))
        }
      }
    }
  }

  // Create half-edges, handling curves appropriately
  for (const fr of fragments) {
    const points = fr.sampledPoints || [fr.start, fr.end]

    for (let i = 0; i < points.length - 1; i++) {
      const startK = pointKey(points[i])
      const endK = pointKey(points[i + 1])

      // Create forward and reverse half-edges
      const fwd = new HalfEdge(startK, endK, fr)
      const rev = new HalfEdge(endK, startK, fr)
      fwd.twin = rev
      rev.twin = fwd

      graph.halfEdges.push(fwd, rev)
    }
  }

  // Attach half-edges to vertices
  for (const he of graph.halfEdges) {
    const v = graph.vertices.get(he.startVertexKey)
    if (!v) continue
    v.outgoing.push(he)
  }

  return graph
}

function linkHalfEdges(graph: PlanarGraph) {
  for (const vertex of graph.vertices.values()) {
    const vPt = vertex.point

    // Sort edges by angle, considering curve tangents when available
    vertex.outgoing.sort((a, b) => {
      const aEnd = graph.vertices.get(a.endVertexKey)?.point
      const bEnd = graph.vertices.get(b.endVertexKey)?.point
      if (!aEnd || !bEnd) return 0

      let angleA: number, angleB: number

      // For curves, use tangent direction. For lines, use vector to endpoint
      if (CURVED_TYPE.includes(a.fragment.type)) {
        const getTangent =
          tangentMap[a.fragment.type as PathFragmentType.Cubic | PathFragmentType.Quad]
        const tangentA = getTangent?.(a.fragment, 0) || { x: aEnd.x - vPt.x, y: aEnd.y - vPt.y }
        angleA = computeAngleBetweenVectors(tangentA, { x: 1, y: 0 })
      } else {
        angleA = computeAngleBetweenVectors(
          { x: aEnd.x - vPt.x, y: aEnd.y - vPt.y },
          { x: 1, y: 0 }
        )
      }

      if (CURVED_TYPE.includes(b.fragment.type)) {
        const getTangent =
          tangentMap[b.fragment.type as PathFragmentType.Cubic | PathFragmentType.Quad]
        const tangentB = getTangent?.(b.fragment, 0) || { x: bEnd.x - vPt.x, y: bEnd.y - vPt.y }
        angleB = computeAngleBetweenVectors(tangentB, { x: 1, y: 0 })
      } else {
        angleB = computeAngleBetweenVectors(
          { x: bEnd.x - vPt.x, y: bEnd.y - vPt.y },
          { x: 1, y: 0 }
        )
      }

      return angleA - angleB
    })

    // Link edges
    for (let i = 0; i < vertex.outgoing.length; i++) {
      const curr = vertex.outgoing[i]
      const next = vertex.outgoing[(i + 1) % vertex.outgoing.length]
      curr.next = next.twin
    }
  }
}

function findTestPoint(points: Point[]): Point {
  // Try centroid first
  const centroid = {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length
  }

  // Verify centroid is inside using your existing point-in-polygon test
  if (isPointInsidePolygon(centroid, points)) {
    return centroid
  }

  // Fallback: try midpoint of a segment slightly offset inward
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]
    const mid = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2
    }

    // Offset slightly inward
    const normal = {
      x: -(p2.y - p1.y),
      y: p2.x - p1.x
    }
    const len = Math.sqrt(normal.x * normal.x + normal.y * normal.y)
    const offset = {
      x: mid.x + (normal.x / len) * EPSILON_INTERSECT * 10,
      y: mid.y + (normal.y / len) * EPSILON_INTERSECT * 10
    }

    if (isPointInsidePolygon(offset, points)) {
      return offset
    }
  }

  // If all else fails, return centroid but mark it for validation
  return centroid
}

function findFaces(graph: PlanarGraph, fragmentMap: FragmentMap): PathRegion[] {
  const regions: PathRegion[] = []
  const processedEdges = new Set<string>()

  for (const he of graph.halfEdges) {
    if (processedEdges.has(he.id)) continue

    const faceId = uuidv4()
    const cycleEdges: HalfEdge[] = []
    const fragmentIds: string[] = []
    const boundaryPoints: Point[] = []

    let current: HalfEdge | undefined = he
    let safetyCounter = 0
    const MAX_ITERATIONS = 10000 // Prevent infinite loops

    while (current && !processedEdges.has(current.id) && safetyCounter < MAX_ITERATIONS) {
      processedEdges.add(current.id)
      cycleEdges.push(current)
      fragmentIds.push(current.fragmentId)

      const vertex = graph.vertices.get(current.startVertexKey)
      if (vertex) {
        boundaryPoints.push(vertex.point)
      }

      current = current.next
      if (current === he) break
      safetyCounter++
    }

    if (cycleEdges.length > 0) {
      const uniqueFragmentIds = Array.from(new Set(fragmentIds))
      const testPoint = findTestPoint(boundaryPoints)

      regions.push({
        id: faceId,
        fragmentIds: uniqueFragmentIds,
        boundingBox: calculateBoundingBox(uniqueFragmentIds, fragmentMap),
        testPoint,
        isHole: false, // Will be determined later
        basicWindingNumber: 0,
        totalWindingNumber: 0
      })
    }
  }

  return regions
}

export function detectAllPlanarFaces(
  fragments: PathFragment[],
  fragmentMap: FragmentMap
): PathRegion[] {
  const graph = buildPlanarGraph(fragments)
  linkHalfEdges(graph)
  const regions = findFaces(graph, fragmentMap)

  // Additional processing to handle holes and containment
  const orderedRegions = orderRegions(regions)

  return orderedRegions
}
