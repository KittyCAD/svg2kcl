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
