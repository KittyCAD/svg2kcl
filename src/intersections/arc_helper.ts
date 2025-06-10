import { Point } from '../types/base'
import { Arc } from './intersections'
import { EPS_ANGLE_INTERSECTION } from './constants'

export function normalizeSweep(start: number, end: number, cw?: boolean): number {
  let s = end - start
  if (cw) {
    while (s > 0) s -= 2 * Math.PI
  } else {
    while (s < 0) s += 2 * Math.PI
  }
  return Math.abs(s)
}

export function normalizeAngle(a: number, ref: number, cw: boolean = false): number {
  const diff = a - ref
  if (cw) {
    // Clockwise: want positive angles, so wrap positive diffs to negative and flip sign.
    if (diff <= 0) {
      return -diff
    } else {
      return -(diff - 2 * Math.PI)
    }
  } else {
    // Anti-clockwise: want positive angles, so wrap negative diffs to positive.
    if (diff >= 0) {
      return diff
    } else {
      return diff + 2 * Math.PI
    }
  }
}

export function isPointOnArcSweep(point: Point, arc: Arc): boolean {
  const angle = Math.atan2(point.y - arc.center.y, point.x - arc.center.x)
  const angNorm = normalizeAngle(angle, arc.startAngle, arc.clockwise)
  const sweep = normalizeSweep(arc.startAngle, arc.endAngle, arc.clockwise)

  if (sweep >= 2 * Math.PI - EPS_ANGLE_INTERSECTION) {
    return true // Full circle
  }

  return angNorm >= -EPS_ANGLE_INTERSECTION && angNorm <= sweep + EPS_ANGLE_INTERSECTION
}

export function getArcParameter(point: Point, arc: Arc): number {
  const angle = Math.atan2(point.y - arc.center.y, point.x - arc.center.x)
  const angNorm = normalizeAngle(angle, arc.startAngle, arc.clockwise)
  const sweep = normalizeSweep(arc.startAngle, arc.endAngle, arc.clockwise)

  return angNorm / (sweep || 2 * Math.PI)
}
