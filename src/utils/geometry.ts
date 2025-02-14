import { Point } from '../types/base'
import { PathElement } from '../types/elements'
import { PathCommand, PathCommandType } from '../types/path'
import { BezierUtils } from './bezier'

export const EPSILON_INTERSECT = 1e-9

export interface LineSegment {
  start: Point
  end: Point
}

export interface EnrichedCommand extends PathCommand {
  iFirstPoint: number // Index of the first point of this command in the global path sample array.
  iLastPoint: number // Index of the last point of this command in the global path sample array.
  iCommand: number // Index of this command in the global path command array.
}

export interface Intersection {
  // Describes an intersection between two segments, with segments produced by
  // sampling a path.
  intersectionPoint: Point // Intersection coordinates.
  iSegmentA: number // Index of segment A in the segment array.
  iSegmentB: number // Index of segment B in the segment array.
  tA: number // How far into segment A the intersection is, [0, 1].
  tB: number // How far into segment B the intersection is, [0, 1].
}

export function isClockwise(points: Point[]): boolean {
  let sum = 0
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i]
    const next = points[i + 1]
    sum += (next.x - curr.x) * (next.y + curr.y)
  }
  return sum > 0
}

export function separateSubpaths(path: PathElement): {
  commands: PathCommand[]
}[] {
  const subpaths: { commands: PathCommand[] }[] = []
  let currentCommands: PathCommand[] = []

  // First split paths at explicit move commands
  path.commands.forEach((command) => {
    if (
      currentCommands.length > 0 &&
      (command.type === PathCommandType.MoveAbsolute ||
        command.type === PathCommandType.MoveRelative)
    ) {
      subpaths.push({ commands: currentCommands })
      currentCommands = []
    }
    currentCommands.push(command)
  })

  if (currentCommands.length > 0) {
    subpaths.push({ commands: currentCommands })
  }

  // Then check each subpath for self-intersections
  const finalSubpaths: { commands: PathCommand[] }[] = []

  for (const subpath of subpaths) {
    const points = []
    let currentPoint = subpath.commands[0].endPositionAbsolute

    // Collect all points including bezier curve points
    for (const command of subpath.commands) {
      points.push(currentPoint)
      if (BezierUtils.isBezierCommand(command.type)) {
        points.push(...BezierUtils.getBezierPoints(command))
      }
      currentPoint = command.endPositionAbsolute
    }

    finalSubpaths.push(subpath)

    // const intersections = findSelfIntersections(points)
    // if (intersections.length > 0) {
    //   // Split at intersections
    //   const splitPaths = splitPathAtIntersections(subpath.commands, intersections)
    //   finalSubpaths.push(...splitPaths.map((commands) => ({ commands })))
    // } else {
    //   finalSubpaths.push(subpath)
    // }
  }

  return finalSubpaths
}

export function findSelfIntersections(points: Point[]): Intersection[] {
  const intersections: Intersection[] = []
  const segments: LineSegment[] = [] // Segments composed two points.

  // Break path into segments.
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      start: points[i],
      end: points[i + 1]
    } as LineSegment)
  }

  // Compare each segment pair for intersections.
  // Skip adjacent segments because these would always intersect.
  // Segment 1: A----B
  // Segment 2:      B----C
  for (let i = 0; i < segments.length - 1; i++) {
    for (let j = i + 2; j < segments.length; j++) {
      // Compare each segment pair for intersections.
      // Skip adjacent segments because these would always intersect.
      // Segment 1: A----B
      // Segment 2:      B----C
      const seg1 = segments[i]
      const seg2 = segments[j]

      // Cross product of AB and CD. Our vectors are 2D, so we only need the z component.
      // https://www.mathsisfun.com/algebra/vectors-cross-product.html
      // KA Stroud, Engineering Mathematics, 7th Edition, p535
      const [abx, aby, ,] = [seg1.end.x - seg1.start.x, seg1.end.y - seg1.start.y, 0]
      const [cdx, cdy, ,] = [seg2.end.x - seg2.start.x, seg2.end.y - seg2.start.y, 0]

      // const cx = aby * cdz - abz * cdy // Will always be zero.
      // const cy = abz * cdx - abx * cdz // Will always be zero.
      const cz = abx * cdy - aby * cdx

      // Handily, cz is the determinant of the matrix:
      const det = cz

      // If A cross B is zero, then the two segments are parallel.
      if (det === 0) continue

      // Using parametric equations for the two lines, we can find intersection point.
      // P(t) = P1 + t(P2 - P1)
      // http://www.it.hiof.no/~borres/j3d/math/param/p-param.html
      //
      // This gives us a t value that increases as we move along the line; fraction
      // into the segment where the intersection occurs.
      //
      // Do the actual solve with Cramer's Rule.
      // https://en.wikipedia.org/wiki/Cramer%27s_rule
      //
      // Ax=b
      // xi = det(Ai)/det(A) for i = 1:n, where Ai is A with column i replaced by b.
      const detA1 =
        (seg2.end.x - seg2.start.x) * (seg1.start.y - seg2.start.y) -
        (seg2.end.y - seg2.start.y) * (seg1.start.x - seg2.start.x)
      const ua = detA1 / det

      const detA2 =
        (seg1.end.x - seg1.start.x) * (seg1.start.y - seg2.start.y) -
        (seg1.end.y - seg1.start.y) * (seg1.start.x - seg2.start.x)
      const ub = detA2 / det

      // Check if intersection lies within both segments, excluding endpoints.
      if (
        ua > EPSILON_INTERSECT &&
        ua < 1 - EPSILON_INTERSECT &&
        ub > EPSILON_INTERSECT &&
        ub < 1 - EPSILON_INTERSECT
      ) {
        const intersectionPoint = {
          x: seg1.start.x + ua * (seg1.end.x - seg1.start.x),
          y: seg1.start.y + ua * (seg1.end.y - seg1.start.y)
        }

        intersections.push({
          iSegmentA: i,
          iSegmentB: j,
          intersectionPoint: intersectionPoint, // Actual coordinates of the intersection.
          tA: ua, // Fraction along segment A: ua.
          tB: ub // Fraction along segment B: ub.
        })
      }
    }
  }

  return intersections
}

export function interpolateLine(p0: Point, p1: Point, t: number): Point {
  return {
    x: (1 - t) * p0.x + t * p1.x,
    y: (1 - t) * p0.y + t * p1.y
  }
}
