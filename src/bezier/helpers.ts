import { Point } from '../types/base'
import { EPS_INTERSECTION } from '../intersections/constants'
import { Bezier } from './core'
import { solveQuadratic } from './math'

export interface Bounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export enum BezierDegeneracyType {
  NORMAL = 'NORMAL',
  POINT = 'POINT',
  LINE = 'LINE'
}

// Actual Bezier stuff.
function arePointsCollinear(points: Point[], epsilon: number): boolean {
  if (points.length < 2) {
    throw new Error('At least two points are required to check collinearity.')
  }
  if (points.length == 2) {
    return true
  }

  // Find the two points that are furthest apart to use as the baseline.
  let maxDistSq = 0
  let baselineStart = 0
  let baselineEnd = 1

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x
      const dy = points[j].y - points[i].y
      const distSq = dx * dx + dy * dy

      if (distSq > maxDistSq) {
        maxDistSq = distSq
        baselineStart = i
        baselineEnd = j
      }
    }
  }

  // If all points are essentially the same, they're collinear.
  if (Math.sqrt(maxDistSq) < epsilon) {
    return true
  }

  const p1 = points[baselineStart]
  const p2 = points[baselineEnd]

  // Check if all other points lie on the line defined by p1 and p2.
  for (let i = 0; i < points.length; i++) {
    if (i === baselineStart || i === baselineEnd) continue

    const p = points[i]

    // Use point-to-line distance formula: |ax + by + c| / sqrt(a^2 + b^2)
    // Line equation: (y2-y1)x - (x2-x1)y + (x2-x1)y1 - (y2-y1)x1 = 0
    const a = p2.y - p1.y
    const b = -(p2.x - p1.x)
    const c = (p2.x - p1.x) * p1.y - (p2.y - p1.y) * p1.x

    const distance = Math.abs(a * p.x + b * p.y + c) / Math.sqrt(a * a + b * b)

    if (distance > epsilon) {
      return false
    }
  }

  return true
}

export function checkBezierDegeneracy(b: Bezier): BezierDegeneracyType {
  const { start, control1, control2, end } = b
  const points = [start, control1, control2, end]

  // Check for point degeneracy - all points within epsilon distance of start.
  const allPointsClose = points.every((p) => {
    const dx = p.x - start.x
    const dy = p.y - start.y
    return Math.sqrt(dx * dx + dy * dy) < EPS_INTERSECTION
  })

  if (allPointsClose) {
    return BezierDegeneracyType.POINT
  }
  // Check for line degeneracy - all points are collinear.
  if (arePointsCollinear(points, EPS_INTERSECTION)) {
    return BezierDegeneracyType.LINE
  }

  return BezierDegeneracyType.NORMAL
}

export function convertQuadraticToCubic(start: Point, control: Point, end: Point): Bezier {
  // Degree elevationn for quadratic to cubic only.
  // https://en.wikipedia.org/wiki/Bézier_curve#Degree_elevation

  const control1 = {
    x: start.x + (2 / 3) * (control.x - start.x),
    y: start.y + (2 / 3) * (control.y - start.y)
  }
  const control2 = {
    x: end.x + (2 / 3) * (control.x - end.x),
    y: end.y + (2 / 3) * (control.y - end.y)
  }

  return Bezier.cubic({ start, control1, control2, end })
}

export function evaluateBezier(t: number, bezier: Bezier): Point {
  const mt = 1 - t
  const mt2 = mt * mt
  const mt3 = mt2 * mt
  const t2 = t * t
  const t3 = t2 * t

  return {
    x:
      mt3 * bezier.start.x +
      3 * mt2 * t * bezier.control1.x +
      3 * mt * t2 * bezier.control2.x +
      t3 * bezier.end.x,
    y:
      mt3 * bezier.start.y +
      3 * mt2 * t * bezier.control1.y +
      3 * mt * t2 * bezier.control2.y +
      t3 * bezier.end.y
  }
}

export function getBezierBounds(b: Bezier): Bounds {
  // Find extrema in x and y for cubic Bezier
  function cubicDerivativeRoots(p0: number, p1: number, p2: number, p3: number) {
    // Derivative: 3(-p0 + 3p1 - 3p2 + p3)t^2 + 6(p0 - 2p1 + p2)t + 3(p1 - p0)
    const a = -3 * p0 + 9 * p1 - 9 * p2 + 3 * p3
    const b_ = 6 * p0 - 12 * p1 + 6 * p2
    const c = 3 * (p1 - p0)
    const roots = solveQuadratic(a, b_, c)
    return roots.filter((t) => t > 0 && t < 1)
  }

  const ts = [0, 1]
  ts.push(...cubicDerivativeRoots(b.start.x, b.control1.x, b.control2.x, b.end.x))
  ts.push(...cubicDerivativeRoots(b.start.y, b.control1.y, b.control2.y, b.end.y))

  const xs = ts.map((t) => evaluateBezier(t, b).x)
  const ys = ts.map((t) => evaluateBezier(t, b).y)

  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys)
  }
}

export function getBezierBoundsSimple(b: Bezier): Bounds {
  const xs = [b.start.x, b.control1.x, b.control2.x, b.end.x]
  const ys = [b.start.y, b.control1.y, b.control2.y, b.end.y]
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys)
  }
}

export function doBoxesOverlap(a: Bounds, b: Bounds): boolean {
  const xOverlap = a.xMin <= b.xMax && a.xMax >= b.xMin
  const yOverlap = a.yMin <= b.yMax && a.yMax >= b.yMin
  return xOverlap && yOverlap
}

export function calculateReflectedControlPoint(
  previousControlPoint: Point,
  referencePoint: Point
): Point {
  // Reflect the previous control point about the reference point.
  return {
    x: 2 * referencePoint.x - previousControlPoint.x,
    y: 2 * referencePoint.y - previousControlPoint.y
  }
}
