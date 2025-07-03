import { Bezier } from '../../bezier/core'
import { Line } from '../../intersections/intersections'
import { Point } from '../../types/base'
import { SegmentType } from '../path_processor_v2'

export interface EdgeGeometry {
  readonly type: SegmentType
  readonly payload: Line | Bezier
  readonly segmentID: string

  // We can also maybe add utility methods here in the future,
  // like evals, tangent computations, etc.
  tangent(t: number): Point
}
