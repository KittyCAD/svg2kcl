import { EPS_INTERSECTION } from '../intersections/constants.js'
import { Vector } from '../types/base'
import { BezierPointsCubic, BezierPointsQuadratic } from './core.js'

export function solveQuadratic(a: number, b: number, c: number): number[] {
  // Quadratic formula: x = (-b ± sqrt(b² - 4ac)) / (2a)
  // Thank you Mr. Collins, I actually even remember this one.
  if (Math.abs(a) < EPS_INTERSECTION) {
    return Math.abs(b) < EPS_INTERSECTION ? [] : [-c / b]
  }

  const discriminant = Math.pow(b, 2) - 4 * a * c
  if (discriminant < -EPS_INTERSECTION) {
    return []
  }
  if (Math.abs(discriminant) < EPS_INTERSECTION) {
    return [-b / (2 * a)]
  }

  const sqrt_d = Math.sqrt(discriminant)
  return [(-b - sqrt_d) / (2 * a), (-b + sqrt_d) / (2 * a)]
}

export function solveCubic(a: number, b: number, c: number, d: number): number[] {
  // This is a little more gnarly.
  // See: https://math.vanderbilt.edu/schectex/courses/cubic/
  // See: https://people.eecs.berkeley.edu/~wkahan/Math128/Cubic.pdf
  if (Math.abs(a) < EPS_INTERSECTION) {
    return solveQuadratic(b, c, d)
  }

  const p = c / a - (b * b) / (3 * a * a)
  const q = (2 * b * b * b) / (27 * a * a * a) - (b * c) / (3 * a * a) + d / a
  const discriminant = (q * q) / 4 + (p * p * p) / 27

  if (discriminant > EPS_INTERSECTION) {
    const sqrt_d = Math.sqrt(discriminant)
    const u = Math.cbrt(-q / 2 + sqrt_d)
    const v = Math.cbrt(-q / 2 - sqrt_d)
    return [u + v - b / (3 * a)]
  } else if (Math.abs(discriminant) < EPS_INTERSECTION) {
    if (Math.abs(q) < EPS_INTERSECTION) {
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

export function computeTangentToQuadratic(object: BezierPointsQuadratic, t: number): Vector {
  // Quadratic Bézier derivative.
  // B'(t) = 2(1-t)(P1-P0) + 2t(P2-P1)
  const { start, control, end } = object

  if (!control) {
    throw new Error('control1 missing for quadratic bezier fragment')
  }

  return {
    x: 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x),
    y: 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y)
  }
}

export function computeTangentToCubic(object: BezierPointsCubic, t: number): Vector {
  // Cubic Bézier derivative.
  // B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)
  const { start, control1, control2, end } = object

  if (!control1 || !control2) {
    throw new Error('Control points missing for cubic bezier fragment')
  }

  return {
    x:
      3 * (1 - t) ** 2 * (control1.x - start.x) +
      6 * (1 - t) * t * (control2.x - control1.x) +
      3 * t ** 2 * (end.x - control2.x),
    y:
      3 * (1 - t) ** 2 * (control1.y - start.y) +
      6 * (1 - t) * t * (control2.y - control1.y) +
      3 * t ** 2 * (end.y - control2.y)
  }
}
