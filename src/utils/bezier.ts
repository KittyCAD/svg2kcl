import { Point } from '../types/base'
import { PathCommand, PathCommandType } from '../types/path'

export interface SplitBezierResult {
  first: Point[] // Parameters for first curve.
  second: Point[] // Parameters for second curve.
  splitPoint: Point // Point where curve was split.
}

export class BezierUtils {
  private static readonly CURVE_SAMPLES = 50

  public static isBezierCommand(type: PathCommandType): boolean {
    return (
      type === PathCommandType.QuadraticBezierAbsolute ||
      type === PathCommandType.QuadraticBezierRelative ||
      type === PathCommandType.QuadraticBezierSmoothAbsolute ||
      type === PathCommandType.QuadraticBezierSmoothRelative ||
      type === PathCommandType.CubicBezierAbsolute ||
      type === PathCommandType.CubicBezierRelative ||
      type === PathCommandType.CubicBezierSmoothAbsolute ||
      type === PathCommandType.CubicBezierSmoothRelative
    )
  }

  public static sampleQuadraticBezier(
    start: Point,
    control: Point,
    end: Point,
    numSamples: number = BezierUtils.CURVE_SAMPLES
  ): Point[] {
    if (numSamples < 2) {
      throw new Error('Number of samples must be at least 2')
    }

    const points: Point[] = [start] // Include start point

    // Sample points along the curve
    for (let i = 1; i < numSamples - 1; i++) {
      const t = i / (numSamples - 1)
      points.push(BezierUtils.evaluateQuadraticBezier(t, start, control, end))
    }

    points.push(end) // Include end point

    return points
  }

  public static getBezierPoints(cmd: PathCommand): Point[] {
    const points: Point[] = []
    const start = cmd.position

    switch (cmd.type) {
      case PathCommandType.QuadraticBezierAbsolute:
      case PathCommandType.QuadraticBezierRelative: {
        const control = { x: cmd.parameters[0], y: cmd.parameters[1] }
        const end = { x: cmd.parameters[2], y: cmd.parameters[3] }
        for (let i = 1; i < BezierUtils.CURVE_SAMPLES; i++) {
          const t = i / BezierUtils.CURVE_SAMPLES
          points.push(BezierUtils.evaluateQuadraticBezier(t, start, control, end))
        }
        break
      }
      case PathCommandType.CubicBezierAbsolute:
      case PathCommandType.CubicBezierRelative: {
        const control1 = { x: cmd.parameters[0], y: cmd.parameters[1] }
        const control2 = { x: cmd.parameters[2], y: cmd.parameters[3] }
        const end = { x: cmd.parameters[4], y: cmd.parameters[5] }
        for (let i = 1; i < BezierUtils.CURVE_SAMPLES; i++) {
          const t = i / BezierUtils.CURVE_SAMPLES
          points.push(BezierUtils.evaluateCubicBezier(t, start, control1, control2, end))
        }
        break
      }
    }

    return points
  }

  public static evaluateQuadraticBezier(t: number, p0: Point, p1: Point, p2: Point): Point {
    const mt = 1 - t
    return {
      x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
      y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y
    }
  }

  public static evaluateCubicBezier(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
    const mt = 1 - t
    const mt2 = mt * mt
    const t2 = t * t
    return {
      x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
      y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y
    }
  }

  // public static splitQuadraticBezier(points: Point[], t: number): SplitBezierResult {
  //   const p0 = points[0]
  //   const p1 = points[1]
  //   const p2 = points[2]

  //   // Calculate split point using de Casteljau's algorithm
  //   const p01 = {
  //     x: p0.x + t * (p1.x - p0.x),
  //     y: p0.y + t * (p1.y - p0.y)
  //   }
  //   const p11 = {
  //     x: p1.x + t * (p2.x - p1.x),
  //     y: p1.y + t * (p2.y - p1.y)
  //   }
  //   const splitPoint = {
  //     x: p01.x + t * (p11.x - p01.x),
  //     y: p01.y + t * (p11.y - p01.y)
  //   }

  //   // Each curve needs 3 points: start, control, end
  //   let first = [
  //     p0, // Start point of first curve
  //     p01, // Control point of first curve
  //     splitPoint // End point of first curve
  //   ]

  //   let second = [
  //     splitPoint, // Start point of second curve
  //     p11, // Control point of second curve
  //     p2 // End point of second curve
  //   ]

  //   return {
  //     first: first,
  //     second: second,
  //     splitPoint
  //   }
  // }

  // public static splitCubicBezier(points: Point[], t: number): SplitBezierResult {
  //   const p0 = points[0]
  //   const p1 = points[1]
  //   const p2 = points[2]
  //   const p3 = points[3]

  //   // Calculate split points using de Casteljau's algorithm
  //   const p01 = {
  //     x: p0.x + t * (p1.x - p0.x),
  //     y: p0.y + t * (p1.y - p0.y)
  //   }
  //   const p11 = {
  //     x: p1.x + t * (p2.x - p1.x),
  //     y: p1.y + t * (p2.y - p1.y)
  //   }
  //   const p21 = {
  //     x: p2.x + t * (p3.x - p2.x),
  //     y: p2.y + t * (p3.y - p2.y)
  //   }
  //   const p02 = {
  //     x: p01.x + t * (p11.x - p01.x),
  //     y: p01.y + t * (p11.y - p01.y)
  //   }
  //   const p12 = {
  //     x: p11.x + t * (p21.x - p11.x),
  //     y: p11.y + t * (p21.y - p11.y)
  //   }
  //   const splitPoint = {
  //     x: p02.x + t * (p12.x - p02.x),
  //     y: p02.y + t * (p12.y - p02.y)
  //   }

  //   let first = [
  //     p0, // Start point
  //     p01, // First control point
  //     p02, // Second control point
  //     splitPoint // End point
  //   ]

  //   let second = [
  //     splitPoint, // Start point
  //     p12, // First control point
  //     p21, // Second control point
  //     p3 // End point
  //   ]

  //   return {
  //     first: first,
  //     second: second,
  //     splitPoint
  //   }
  // }

  public static splitQuadraticBezier(
    { start, control, end }: { start: Point; control: Point; end: Point },
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
      first: [start, p01, splitPoint],
      second: [splitPoint, p11, end],
      splitPoint
    }
  }

  public static splitCubicBezier(
    {
      start,
      control1,
      control2,
      end
    }: { start: Point; control1: Point; control2: Point; end: Point },
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

  public static splitQuadraticBezierSmooth(
    { start, prevControl, end }: { start: Point; prevControl?: Point; end: Point },
    t: number
  ): SplitBezierResult {
    const control = prevControl
      ? { x: 2 * start.x - prevControl.x, y: 2 * start.y - prevControl.y } // Reflect previous control.
      : start // If no previous control, assume it's the start point (degenerate).

    return BezierUtils.splitQuadraticBezier({ start, control, end }, t)
  }

  public static splitCubicBezierSmooth(
    { start, control2, end }: { start: Point; control2: Point; end: Point },
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
}
