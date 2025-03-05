import { v4 as uuidv4 } from 'uuid'
import { Point } from '../../types/base'
import { FragmentMap, PathFragmentData, PathFragmentType } from '../../types/fragments'
import { N_CURVE_SAMPLES_BOUNDARY } from '../../constants'
import { sampleLine } from '../../utils/geometry'
import { sampleQuadraticBezier, sampleCubicBezier } from '../../utils/bezier'
import { Vector } from '../../types/base'

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

  private static fragmentIdCounter: number = 0

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

  // private getNextFragmentId(): string {
  //   return uuidv4()
  // }

  public getNextFragmentId(): string {
    // Start with A (ASCII 65) and increment
    const asciiA = 65
    const lettersInAlphabet = 26

    // Calculate the ID
    let id = ''
    let counter = PathFragment.fragmentIdCounter++

    // Generate multi-letter IDs when we exceed Z (e.g., AA, AB, etc.)
    do {
      const remainder = counter % lettersInAlphabet
      id = String.fromCharCode(asciiA + remainder) + id
      counter = Math.floor(counter / lettersInAlphabet) - 1
    } while (counter >= 0)

    return id
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
      return sampleQuadraticBezier(
        fragment.start,
        fragment.control1!,
        fragment.end,
        N_CURVE_SAMPLES_BOUNDARY
      )

    case PathFragmentType.Cubic:
      return sampleCubicBezier(
        fragment.start,
        fragment.control1!,
        fragment.control2!,
        fragment.end,
        N_CURVE_SAMPLES_BOUNDARY
      )
  }
}

export function computeTangentToLineFragment(fragment: PathFragment): Vector {
  return {
    x: fragment.end.x - fragment.start.x,
    y: fragment.end.y - fragment.start.y
  }
}

export function computeTangentToQuadraticFragment(fragment: PathFragment, t: number): Vector {
  // Quadratic Bézier derivative.
  // B'(t) = 2(1-t)(P1-P0) + 2t(P2-P1)
  const { start, control1, end } = fragment

  if (!control1) {
    throw new Error('control1 missing for quadratic bezier fragment')
  }

  return {
    x: 2 * (1 - t) * (control1.x - start.x) + 2 * t * (end.x - control1.x),
    y: 2 * (1 - t) * (control1.y - start.y) + 2 * t * (end.y - control1.y)
  }
}

export function computeTangentToCubicFragment(fragment: PathFragment, t: number): Vector {
  // Cubic Bézier derivative
  // B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)
  const { start, control1, control2, end } = fragment

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
