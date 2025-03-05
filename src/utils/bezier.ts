import { Point } from '../types/base'
import { PathCommandType } from '../types/paths'
import { N_CURVE_SAMPLES } from '../constants'

export interface SplitBezierResult {
  first: Point[] // Parameters for first curve.
  second: Point[] // Parameters for second curve.
  splitPoint: Point // Point where curve was split.
}

export interface SplitBezierRangeResult {
  before: Point[] // Curve segment before t0.
  range: Point[] // Curve segment between t0 and t1.
  after: Point[] // Curve segment after t1.
  splitPoint1: Point // Point at t1.
  splitPoint2: Point // Point at t2.
}

export class BezierUtils {
  private static readonly BEZIER_COMMAND_TYPES = new Set([
    PathCommandType.QuadraticBezierAbsolute,
    PathCommandType.QuadraticBezierRelative,
    PathCommandType.QuadraticBezierSmoothAbsolute,
    PathCommandType.QuadraticBezierSmoothRelative,
    PathCommandType.CubicBezierAbsolute,
    PathCommandType.CubicBezierRelative,
    PathCommandType.CubicBezierSmoothAbsolute,
    PathCommandType.CubicBezierSmoothRelative
  ])

  public static isBezierCommand(type: PathCommandType): boolean {
    return BezierUtils.BEZIER_COMMAND_TYPES.has(type)
  }

  public static sampleQuadraticBezier(
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
      points.push(BezierUtils.evaluateQuadraticBezier(t, start, control, end))
    }

    // We want [start, ...samples, end), so we don't need to push the end point.
    // points.push(end)

    return points
  }

  public static sampleCubicBezier(
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
      points.push(BezierUtils.evaluateCubicBezier(t, start, control1, control2, end))
    }

    // We want [start, ...samples, end), so we don't need to push the end point.
    // points.push(end)

    return points
  }

  public static evaluateQuadraticBezier(
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

  public static evaluateCubicBezier(
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

  public static splitQuadraticBezier(
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

  public static splitQuadraticBezierRange(
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
    const splitT2 = BezierUtils.splitQuadraticBezier(start, control, end, t2)
    const beforeT2 = splitT2.first
    const afterT2 = splitT2.second

    // Then split the first portion at t1/t2 to get the range.
    const relativeT1 = t1 / t2 // Normalize t1 relative to t2.
    const splitT1 = BezierUtils.splitQuadraticBezier(
      beforeT2[0],
      beforeT2[1],
      beforeT2[2],
      relativeT1
    )

    return {
      before: splitT1.first, // Curve segment [0, t1].
      range: splitT1.second, // Curve segment [t1, t2].
      after: afterT2, // Curve segment [t2, 1].
      splitPoint1: splitT1.splitPoint, // Point at t1.
      splitPoint2: splitT2.splitPoint // Point at t2.
    }
  }

  public static splitCubicBezier(
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

  public static splitCubicBezierRange(
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
    const splitT2 = BezierUtils.splitCubicBezier(start, control1, control2, end, t2)
    const beforeT2 = splitT2.first // [start, p01, p02, splitPoint2]
    const afterT2 = splitT2.second // [splitPoint2, p12, p21, end]

    // Then split the first portion at t1/t2 to get the range.
    const relativeT1 = t1 / t2 // Normalize t1 relative to t2.
    const splitT1 = BezierUtils.splitCubicBezier(
      beforeT2[0], // original start
      beforeT2[1], // p01
      beforeT2[2], // p02
      beforeT2[3], // splitPoint2
      relativeT1
    )

    return {
      before: splitT1.first, // Curve segment [0, t1].
      range: splitT1.second, // Curve segment [t1, t2].
      after: afterT2, // Curve segment [t2, 1].
      splitPoint1: splitT1.splitPoint, // Point at t1.
      splitPoint2: splitT2.splitPoint // Point at t2.
    }
  }

  public static splitQuadraticBezierSmooth(
    start: Point,
    prevControl: Point | undefined,
    end: Point,
    t: number
  ): SplitBezierResult {
    const control = prevControl
      ? { x: 2 * start.x - prevControl.x, y: 2 * start.y - prevControl.y } // Reflect previous control.
      : start // If no previous control, assume it's the start point (degenerate).

    return BezierUtils.splitQuadraticBezier(start, control, end, t)
  }

  public static splitCubicBezierSmooth(
    start: Point,
    control2: Point,
    end: Point,
    t: number
  ): SplitBezierResult {
    const p21 = {
      x: control2.x + t * (end.x - control2.x),
      y: control2.y + t * (end.y - control2.y)
    }
    const splitPoint = {
      x: start.x + t * (p21.x - start.x),
      y: start.y + t * (p21.y - start.y)
    }

    return {
      first: [start, splitPoint],
      second: [splitPoint, p21, end],
      splitPoint
    }
  }

  public static calculateReflectedControlPoint(
    previousControlPoint: Point,
    currentPoint: Point
  ): Point {
    // Reflect the previous control point about current point.
    return {
      x: 2 * currentPoint.x - previousControlPoint.x,
      y: 2 * currentPoint.y - previousControlPoint.y
    }
  }
}
