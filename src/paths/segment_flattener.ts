import { SplitSegment, SegmentType } from './path_processor_v2'
import { Line, Arc } from '../intersections/intersections'
import { Bezier } from '../bezier/core'
import { splitCubicBezier } from '../bezier/split'
import { Plotter } from '../intersections/plotter'
import { newId } from '../utils/ids'

// A flattened, straight-line segment with a link back to its original segment.
export interface FlattenedSegment {
  id: string
  parentSegmentId: string
  geometry: Line
}

function pointToLineDistance(
  P: { x: number; y: number },
  A: { x: number; y: number },
  B: { x: number; y: number }
): number {
  const vx = B.x - A.x
  const vy = B.y - A.y
  const wx = P.x - A.x
  const wy = P.y - A.y
  return Math.abs(vx * wy - vy * wx) / Math.hypot(vx, vy)
}

function flattenBezier(
  bezier: Bezier,
  tol: number,
  parentId: string,
  out: FlattenedSegment[]
): void {
  const { start: p0, control1: p1, control2: p2, end: p3 } = bezier
  const d1 = pointToLineDistance(p1, p0, p3)
  const d2 = pointToLineDistance(p2, p0, p3)

  // If both control points lie within tol of the chord, approximate with a single line.
  if (Math.max(d1, d2) <= tol) {
    out.push({
      id: newId('flattenedSegment'),
      parentSegmentId: parentId,
      geometry: { start: p0, end: p3 }
    })
    return
  }

  // Otherwise split at t=0.5 and recurse.
  const { first, second } = splitCubicBezier(p0, p1, p2, p3, 0.5)
  const [l0, l1, l2, l3] = first
  const [r0, r1, r2, r3] = second

  flattenBezier(
    Bezier.cubic({ start: l0, control1: l1, control2: l2, end: l3 }),
    tol,
    parentId,
    out
  )
  flattenBezier(
    Bezier.cubic({ start: r0, control1: r1, control2: r2, end: r3 }),
    tol,
    parentId,
    out
  )
}

function flattenArc(arc: Arc, tol: number, parentId: string, out: FlattenedSegment[]): void {
  const { center, radius, startAngle, sweepAngle } = arc
  const absDelta = Math.abs(sweepAngle)

  // Determine max angle step so that chord height <= tol: h = r * (1 - cos(theta/2)).
  const maxStep = 2 * Math.acos(Math.max(0, 1 - tol / radius))
  const steps = Math.max(1, Math.ceil(absDelta / maxStep))

  for (let i = 0; i < steps; i++) {
    const a0 = startAngle + (sweepAngle * i) / steps
    const a1 = startAngle + (sweepAngle * (i + 1)) / steps
    const p0 = { x: center.x + radius * Math.cos(a0), y: center.y + radius * Math.sin(a0) }
    const p1 = { x: center.x + radius * Math.cos(a1), y: center.y + radius * Math.sin(a1) }
    out.push({
      id: newId('flattenedSegment'),
      parentSegmentId: parentId,
      geometry: { start: p0, end: p1 }
    })
  }
}

export function flattenSegment(segment: SplitSegment, tolerance: number): FlattenedSegment[] {
  const result: FlattenedSegment[] = []
  const parentId = segment.id

  switch (segment.type) {
    case SegmentType.Line:
      // Sample the line more densely
      const numPoints = 250
      const dx = (segment.geometry.end.x - segment.geometry.start.x) / numPoints
      const dy = (segment.geometry.end.y - segment.geometry.start.y) / numPoints

      // Create line segments between consecutive points
      for (let i = 0; i < numPoints; i++) {
        const x1 = segment.geometry.start.x + i * dx
        const y1 = segment.geometry.start.y + i * dy
        const x2 = segment.geometry.start.x + (i + 1) * dx
        const y2 = segment.geometry.start.y + (i + 1) * dy

        result.push({
          id: newId('flattenedSegment'),
          parentSegmentId: parentId,
          geometry: {
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 }
          }
        })
      }
      break

    case SegmentType.QuadraticBezier:
    case SegmentType.CubicBezier:
      flattenBezier(segment.geometry as Bezier, tolerance, parentId, result)
      break

    case SegmentType.Arc:
      flattenArc(segment.geometry as unknown as Arc, tolerance, parentId, result)
      break

    default:
      throw new Error(`Unsupported segment type for flattening: ${segment.type}`)
  }

  return result
}

export function flattenSegments(segments: SplitSegment[], tolerance: number): FlattenedSegment[] {
  const output: FlattenedSegment[] = []

  for (const segment of segments) {
    const flattenedSegments = flattenSegment(segment, tolerance)
    output.push(...flattenedSegments)
  }

  // --------------------------------------------------------------------------
  // Plot all flattened segments
  const xs: number[] = []
  const ys: number[] = []
  for (const f of output) {
    xs.push(f.geometry.start.x, f.geometry.end.x)
    ys.push(f.geometry.start.y, f.geometry.end.y)
  }
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)

  const plotter = new Plotter()
  plotter.clear()
  plotter.setBounds(xMin, yMin, xMax, yMax)

  for (const f of output) {
    plotter.plotLine(f.geometry, 'blue')
  }

  plotter.save('flattened_segments.png')
  // --------------------------------------------------------------------------

  return output
}
