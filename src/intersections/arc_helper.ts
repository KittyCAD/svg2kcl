import { Point } from '../types/base'
import { Arc } from './intersections'
import { EPS_ANGLE_INTERSECTION } from './constants'
import { EPSILON_INTERSECT } from '../constants'

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
