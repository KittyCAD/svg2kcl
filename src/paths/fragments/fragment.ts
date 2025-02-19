import { v4 as uuidv4 } from 'uuid'
import { Point } from '../../types/base'
import { FragmentMap, PathFragmentData, PathFragmentType } from '../../types/fragments'
import { BezierUtils } from '../../utils/bezier'
import { N_CURVE_SAMPLES_BOUNDARY } from '../../constants'
import { sampleLine } from '../../utils/geometry'

export class PathFragment implements PathFragmentData {
  id: string
  type: PathFragmentType

  // The main points for this geometry:
  start: Point
  end: Point

  // Optionally store additional data for Bézier curves.
  control1?: Point
  control2?: Point

  // Store a link to the original command index in our input path command list.
  iCommand: number

  // Sampled points for this fragment.
  sampledPoints?: Point[]

  // Store a list of fragments that are connected to this one.
  connectedFragments?: {
    fragmentId: string
    angle: number
  }[]

  constructor(params: Omit<PathFragmentData, 'id'>) {
    this.id = this.getNextFragmentId()
    this.type = params.type
    this.start = params.start
    this.end = params.end
    this.iCommand = params.iCommand
    this.control1 = params.control1
    this.control2 = params.control2
    this.connectedFragments = params.connectedFragments
  }

  private getNextFragmentId(): string {
    return uuidv4()
  }
}

export function calculateBoundingBox(
  fragmentIds: string[],
  fragmentMap: FragmentMap
): {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
} {
  let xMin = Infinity,
    yMin = Infinity,
    xMax = -Infinity,
    yMax = -Infinity

  for (const id of fragmentIds) {
    const fragment = fragmentMap.get(id)
    if (!fragment) continue

    if (!fragment.sampledPoints) {
      throw new Error('Fragment has no sampled points')
    }

    const points = fragment.sampledPoints

    // Check all sampled points.
    for (const point of points) {
      xMin = Math.min(xMin, point.x)
      yMin = Math.min(yMin, point.y)
      xMax = Math.max(xMax, point.x)
      yMax = Math.max(yMax, point.y)
    }
  }

  return { xMin, yMin, xMax, yMax }
}

export function calculateTestPoint(fragmentIds: string[], fragmentMap: FragmentMap): Point {
  // Use centroid of bounding box as a simple approximation.
  const bbox = calculateBoundingBox(fragmentIds, fragmentMap)
  return {
    x: (bbox.xMin + bbox.xMax) / 2,
    y: (bbox.yMin + bbox.yMax) / 2
  }
}

export function sampleFragment(fragment: PathFragment): Point[] {
  switch (fragment.type) {
    case PathFragmentType.Line:
      return sampleLine(fragment.start, fragment.end, N_CURVE_SAMPLES_BOUNDARY)

    case PathFragmentType.Quad:
      return BezierUtils.sampleQuadraticBezier(
        fragment.start,
        fragment.control1!,
        fragment.end,
        N_CURVE_SAMPLES_BOUNDARY
      )

    case PathFragmentType.Cubic:
      return BezierUtils.sampleCubicBezier(
        fragment.start,
        fragment.control1!,
        fragment.control2!,
        fragment.end,
        N_CURVE_SAMPLES_BOUNDARY
      )
  }
}
