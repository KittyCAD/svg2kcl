import { v4 as uuidv4 } from 'uuid'
import { Point } from '../../types/base'
import { PathFragmentData, PathFragmentType } from '../../types/fragments'

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
  fragmentMap: Map<string, PathFragment> = new Map()
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

    xMin = Math.min(xMin, fragment.start.x, fragment.end.x)
    yMin = Math.min(yMin, fragment.start.y, fragment.end.y)
    xMax = Math.max(xMax, fragment.start.x, fragment.end.x)
    yMax = Math.max(yMax, fragment.start.y, fragment.end.y)
  }

  return { xMin: xMin, yMin: yMin, xMax: xMax, yMax: yMax }
}

export function calculateTestPoint(fragmentIds: string[]): Point {
  // Use centroid of bounding box as a simple approximation.
  const bbox = calculateBoundingBox(fragmentIds)
  return {
    x: (bbox.xMin + bbox.xMax) / 2,
    y: (bbox.yMin + bbox.yMax) / 2
  }
}
