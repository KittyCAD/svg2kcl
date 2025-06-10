import { Point } from '../types/base'
import { splitCubicBezier } from '../utils/bezier'
import { Bezier } from './intersections'
import { EPS_LINE_INTERSECTION } from './constants'
import { EPS_DEGENERATE } from './constants'

export interface Bounds {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

export interface FatLine {
  A: number
  B: number
  C: number
  dMin: number
  dMax: number
}

export enum BezierDegeneracyType {
  NORMAL = 'NORMAL',
  POINT = 'POINT',
  LINE = 'LINE'
}

// Utilities, not necessarily Bezier related.
export function solveQuadratic(a: number, b: number, c: number): number[] {
  // Quadratic formula: x = (-b ± sqrt(b² - 4ac)) / (2a)
  // Thank you Mr. Collins, I actually even remember this one.
  if (Math.abs(a) < EPS_LINE_INTERSECTION) {
    return Math.abs(b) < EPS_LINE_INTERSECTION ? [] : [-c / b]
  }

  const discriminant = Math.pow(b, 2) - 4 * a * c
  if (discriminant < -EPS_LINE_INTERSECTION) {
    return []
  }
  if (Math.abs(discriminant) < EPS_LINE_INTERSECTION) {
    return [-b / (2 * a)]
  }

  const sqrt_d = Math.sqrt(discriminant)
  return [(-b - sqrt_d) / (2 * a), (-b + sqrt_d) / (2 * a)]
}

export function solveCubic(a: number, b: number, c: number, d: number): number[] {
  // This is a little more gnarly.
  // See: https://math.vanderbilt.edu/schectex/courses/cubic/
  // See: https://people.eecs.berkeley.edu/~wkahan/Math128/Cubic.pdf
  if (Math.abs(a) < EPS_LINE_INTERSECTION) {
    return solveQuadratic(b, c, d)
  }

  const p = c / a - (b * b) / (3 * a * a)
  const q = (2 * b * b * b) / (27 * a * a * a) - (b * c) / (3 * a * a) + d / a
  const discriminant = (q * q) / 4 + (p * p * p) / 27

  if (discriminant > EPS_LINE_INTERSECTION) {
    const sqrt_d = Math.sqrt(discriminant)
    const u = Math.cbrt(-q / 2 + sqrt_d)
    const v = Math.cbrt(-q / 2 - sqrt_d)
    return [u + v - b / (3 * a)]
  } else if (Math.abs(discriminant) < EPS_LINE_INTERSECTION) {
    if (Math.abs(q) < EPS_LINE_INTERSECTION) {
      return [-b / (3 * a)]
    } else {
      const temp = Math.cbrt(-q / 2)
      return [2 * temp - b / (3 * a), -temp - b / (3 * a)]
    }
  } else {
    const rho = Math.sqrt(-(p * p * p) / 27)
    const theta = Math.acos(-q / (2 * rho))
    const offset = -b / (3 * a)
    const factor = 2 * Math.cbrt(rho)

    return [
      factor * Math.cos(theta / 3) + offset,
      factor * Math.cos((theta + 2 * Math.PI) / 3) + offset,
      factor * Math.cos((theta + 4 * Math.PI) / 3) + offset
    ]
  }
}

export function doBoxesOverlap(a: Bounds, b: Bounds): boolean {
  const xOverlap = a.xMin <= b.xMax && a.xMax >= b.xMin
  const yOverlap = a.yMin <= b.yMax && a.yMax >= b.yMin
  return xOverlap && yOverlap
}

export function makeFatLine(bez: Bezier): FatLine {
  const dx = bez.end.x - bez.start.x
  const dy = bez.end.y - bez.start.y
  const len = Math.hypot(dx, dy) || EPS_LINE_INTERSECTION
  const A = dy / len
  const B = -dx / len
  const C = -(A * bez.start.x + B * bez.start.y)

  const distances = [
    A * bez.start.x + B * bez.start.y + C,
    A * bez.control1.x + B * bez.control1.y + C,
    A * bez.control2.x + B * bez.control2.y + C,
    A * bez.end.x + B * bez.end.y + C
  ]
  return {
    A,
    B,
    C,
    dMin: Math.min(...distances),
    dMax: Math.max(...distances)
  }
}

export function fatLineReject(b: Bezier, fl: FatLine): boolean {
  const d = [
    fl.A * b.start.x + fl.B * b.start.y + fl.C,
    fl.A * b.control1.x + fl.B * b.control1.y + fl.C,
    fl.A * b.control2.x + fl.B * b.control2.y + fl.C,
    fl.A * b.end.x + fl.B * b.end.y + fl.C
  ]
  const localMin = Math.min(...d)
  const localMax = Math.max(...d)
  return localMax < fl.dMin - EPS_LINE_INTERSECTION || localMin > fl.dMax + EPS_LINE_INTERSECTION
}

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

// Actual Bezier stuff.
export function checkBezierDegeneracy(b: Bezier): BezierDegeneracyType {
  const { start, control1, control2, end } = b
  const points = [start, control1, control2, end]

  // Check for point degeneracy - all points within epsilon distance of start.
  const allPointsClose = points.every((p) => {
    const dx = p.x - start.x
    const dy = p.y - start.y
    return Math.sqrt(dx * dx + dy * dy) < EPS_DEGENERATE
  })

  if (allPointsClose) {
    return BezierDegeneracyType.POINT
  }
  // Check for line degeneracy - all points are collinear.
  if (arePointsCollinear(points, EPS_DEGENERATE)) {
    return BezierDegeneracyType.LINE
  }

  return BezierDegeneracyType.NORMAL
}

export function convertQuadraticToCubic(start: Point, control: Point, end: Point): Bezier {
  // Degree elevationn for quadratic to cubic only.
  // https://en.wikipedia.org/wiki/Bézier_curve#Degree_elevation
  return {
    start,
    control1: {
      x: start.x + (2 / 3) * (control.x - start.x),
      y: start.y + (2 / 3) * (control.y - start.y)
    },
    control2: {
      x: end.x + (2 / 3) * (control.x - end.x),
      y: end.y + (2 / 3) * (control.y - end.y)
    },
    end
  }
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

export function subdivideBezier(
  bez: Bezier,
  t: number,
  t0: number,
  t1: number
): [Bezier, [number, number], Bezier, [number, number]] {
  const { first, second } = splitCubicBezier(bez.start, bez.control1, bez.control2, bez.end, t)

  const toBezier = (pts: Point[]): Bezier => ({
    start: pts[0],
    control1: pts[1],
    control2: pts[2],
    end: pts[3]
  })

  const left = toBezier(first as Point[])
  const right = toBezier(second as Point[])

  const tm = t0 + (t1 - t0) * t
  return [left, [t0, tm], right, [tm, t1]]
}
