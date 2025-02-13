import { Point } from '../types/base'
import { PathCommand, PathCommandType } from '../types/path'

export class BezierUtils {
  private static readonly CURVE_SAMPLES = 20

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
}
