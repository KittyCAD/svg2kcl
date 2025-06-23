import { Bezier } from './core'
import { Point } from '../types/base'
import { EPS_INTERSECTION } from '../intersections/constants'

export interface FatLine {
  A: number
  B: number
  C: number
  dMin: number
  dMax: number
}

export interface SplitBezierResult {
  first: Point[] // Parameters for first curve
  second: Point[] // Parameters for second curve
  splitPoint: Point // Point where curve was split
}

export interface SplitBezierRangeResult {
  before: Point[] // Curve segment before t0
  range: Point[] // Curve segment between t0 and t1
  after: Point[] // Curve segment after t1
  splitPoint1: Point // Point at t1
  splitPoint2: Point // Point at t2
}

export function subdivideBezier(
  bez: Bezier,
  t: number,
  t0: number,
  t1: number
): [Bezier, [number, number], Bezier, [number, number]] {
  let left: Bezier
  let right: Bezier

  if (bez.isQuadratic) {
    // Use quadratic splitting for quadratic input.
    const { first, second } = splitQuadraticBezier(bez.start, bez.quadraticControl, bez.end, t)

    // First/second are [start, control, end] for quadratics.
    left = Bezier.quadratic({
      start: first[0],
      control: first[1],
      end: first[2]
    })
    right = Bezier.quadratic({
      start: second[0],
      control: second[1],
      end: second[2]
    })
  } else {
    // Use cubic splitting for cubic input
    const { first, second } = splitCubicBezier(bez.start, bez.control1, bez.control2, bez.end, t)

    // first/second are [start, control1, control2, end] for cubics
    left = Bezier.cubic({ start: first[0], control1: first[1], control2: first[2], end: first[3] })
    right = Bezier.cubic({
      start: second[0],
      control1: second[1],
      control2: second[2],
      end: second[3]
    })
  }

  const tm = t0 + (t1 - t0) * t
  return [left, [t0, tm], right, [tm, t1]]
}

export function makeFatLine(bez: Bezier): FatLine {
  const dx = bez.end.x - bez.start.x
  const dy = bez.end.y - bez.start.y
  const len = Math.hypot(dx, dy) || EPS_INTERSECTION
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
  return localMax < fl.dMin - EPS_INTERSECTION || localMin > fl.dMax + EPS_INTERSECTION
}

export function splitQuadraticBezier(
  start: Point,
  control: Point,
  end: Point,
  t: number
): SplitBezierResult {
  const p01 = {
    x: start.x + t * (control.x - start.x),
    y: start.y + t * (control.y - start.y)
  }
  const p11 = {
    x: control.x + t * (end.x - control.x),
    y: control.y + t * (end.y - control.y)
  }
  const splitPoint = {
    x: p01.x + t * (p11.x - p01.x),
    y: p01.y + t * (p11.y - p01.y)
  }

  return {
    first: [start, p01, splitPoint], // Start, control, end (split).
    second: [splitPoint, p11, end], // Start (split), control, end.
    splitPoint
  }
}

export function splitQuadraticBezierRange(
  start: Point,
  control: Point,
  end: Point,
  t1: number,
  t2: number
): SplitBezierRangeResult {
  if (t1 > t2) {
    throw new Error('Invalid split parameters: t1 must be less than t2.')
  }

  // First split at t2 (point further along the curve).
  const splitT2 = splitQuadraticBezier(start, control, end, t2)
  const beforeT2 = splitT2.first
  const afterT2 = splitT2.second

  // Then split the first portion at t1/t2 to get the range.
  const relativeT1 = t1 / t2 // Normalize t1 relative to t2.
  const splitT1 = splitQuadraticBezier(beforeT2[0], beforeT2[1], beforeT2[2], relativeT1)

  return {
    before: splitT1.first, // Curve segment [0, t1]
    range: splitT1.second, // Curve segment [t1, t2]
    after: afterT2, // Curve segment [t2, 1]
    splitPoint1: splitT1.splitPoint, // Point at t1
    splitPoint2: splitT2.splitPoint // Point at t2
  }
}

export function splitCubicBezier(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number
): SplitBezierResult {
  const p01 = {
    x: start.x + t * (control1.x - start.x),
    y: start.y + t * (control1.y - start.y)
  }
  const p11 = {
    x: control1.x + t * (control2.x - control1.x),
    y: control1.y + t * (control2.y - control1.y)
  }
  const p21 = {
    x: control2.x + t * (end.x - control2.x),
    y: control2.y + t * (end.y - control2.y)
  }
  const p02 = {
    x: p01.x + t * (p11.x - p01.x),
    y: p01.y + t * (p11.y - p01.y)
  }
  const p12 = {
    x: p11.x + t * (p21.x - p11.x),
    y: p11.y + t * (p21.y - p11.y)
  }
  const splitPoint = {
    x: p02.x + t * (p12.x - p02.x),
    y: p02.y + t * (p12.y - p02.y)
  }

  return {
    first: [start, p01, p02, splitPoint],
    second: [splitPoint, p12, p21, end],
    splitPoint
  }
}

export function splitCubicBezierRange(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t1: number,
  t2: number
): SplitBezierRangeResult {
  if (t1 > t2) {
    throw new Error('Invalid split parameters: t1 must be less than t2.')
  }

  // First split at t2 (point further along the curve).
  const splitT2 = splitCubicBezier(start, control1, control2, end, t2)
  const beforeT2 = splitT2.first // [start, p01, p02, splitPoint2]
  const afterT2 = splitT2.second // [splitPoint2, p12, p21, end]

  // Then split the first portion at t1/t2 to get the range
  const relativeT1 = t1 / t2 // Normalize t1 relative to t2
  const splitT1 = splitCubicBezier(
    beforeT2[0], // original start
    beforeT2[1], // p01
    beforeT2[2], // p02
    beforeT2[3], // splitPoint2
    relativeT1
  )

  return {
    before: splitT1.first, // Curve segment [0, t1]
    range: splitT1.second, // Curve segment [t1, t2]
    after: afterT2, // Curve segment [t2, 1]
    splitPoint1: splitT1.splitPoint, // Point at t1
    splitPoint2: splitT2.splitPoint // Point at t2
  }
}
