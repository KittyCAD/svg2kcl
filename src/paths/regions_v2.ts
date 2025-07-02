import { Point } from '../types/base'
import { HalfEdge } from './dcel/dcel'
import { SegmentType } from './path_processor_v2'
import { sampleCubicBezier, sampleQuadraticBezier } from '../utils/bezier'
import { Bezier } from '../bezier/core'
import { isPointInsidePolygon } from '../utils/polygon'
import { calculatePolygonArea } from '../utils/geometry'

export function computeInteriorPoint(halfEdges: HalfEdge[], epsilon: number): Point {
  const candidates: Point[] = []
  const coarsePolygon: Point[] = []

  for (const edge of halfEdges) {
    // Sample points along the segment.
    const points = sampleHalfEdge(edge, 10)
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
  for (const e of halfEdges) {
    const [s, t] = sampleHalfEdge(e, 10)
    const len2 = (t.x - s.x) ** 2 + (t.y - s.y) ** 2
    if (len2 > maxLen2) {
      maxLen2 = len2
      best = { x: (s.x + t.x) * 0.5, y: (s.y + t.y) * 0.5 }
    }
  }
  return best
}

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

function isClockwise(polygon: Point[]): boolean {
  const area = calculatePolygonArea(polygon)
  return area < 0 // Clockwise if area is negative.
}
