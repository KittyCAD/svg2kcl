import { Point } from '../types/base'
import { N_CURVE_SAMPLES } from '../constants'

export function sampleQuadraticBezier(
  start: Point,
  control: Point,
  end: Point,
  numSamples: number = N_CURVE_SAMPLES
): Point[] {
  if (numSamples < 2) {
    throw new Error('Number of samples must be at least 2')
  }

  // Grab start and end points plus sampled central points.
  const points: Point[] = [start]

  for (let i = 1; i < numSamples - 1; i++) {
    const t = i / (numSamples - 1)
    points.push(evaluateQuadraticBezier(t, start, control, end))
  }

  // We want [start, ...samples, end), so we don't need to push the end point
  // points.push(end)

  return points
}

export function sampleCubicBezier(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  numSamples: number = N_CURVE_SAMPLES
): Point[] {
  if (numSamples < 2) {
    throw new Error('Number of samples must be at least 2')
  }

  // Grab start and end points plus sampled central points.
  const points: Point[] = [start]

  for (let i = 1; i < numSamples - 1; i++) {
    const t = i / (numSamples - 1)
    points.push(evaluateCubicBezier(t, start, control1, control2, end))
  }

  // We want [start, ...samples, end), so we don't need to push the end point
  // points.push(end)

  return points
}

export function evaluateQuadraticBezier(
  t: number,
  start: Point,
  control: Point,
  end: Point
): Point {
  const mt = 1 - t
  return {
    x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
    y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y
  }
}

export function evaluateCubicBezier(
  t: number,
  start: Point,
  control1: Point,
  control2: Point,
  end: Point
): Point {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  return {
    x: mt2 * mt * start.x + 3 * mt2 * t * control1.x + 3 * mt * t2 * control2.x + t2 * t * end.x,
    y: mt2 * mt * start.y + 3 * mt2 * t * control1.y + 3 * mt * t2 * control2.y + t2 * t * end.y
  }
}

// export function splitQuadraticBezierSmooth(
//   start: Point,
//   prevControl: Point | undefined,
//   end: Point,
//   t: number
// ): SplitBezierResult {
//   const control = prevControl
//     ? { x: 2 * start.x - prevControl.x, y: 2 * start.y - prevControl.y } // Reflect previous control.
//     : start // If no previous control, assume it's the start point (degenerate).

//   return splitQuadraticBezier(start, control, end, t)
// }

// export function splitCubicBezierSmooth(
//   start: Point,
//   control2: Point,
//   end: Point,
//   t: number
// ): SplitBezierResult {
//   const p21 = {
//     x: control2.x + t * (end.x - control2.x),
//     y: control2.y + t * (end.y - control2.y)
//   }
//   const splitPoint = {
//     x: start.x + t * (p21.x - start.x),
//     y: start.y + t * (p21.y - start.y)
//   }

//   return {
//     first: [start, splitPoint],
//     second: [splitPoint, p21, end],
//     splitPoint
//   }
// }
