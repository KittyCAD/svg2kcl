import { EPSILON_INTERSECT } from '../constants'
import { PathFragment } from '../paths/fragments/fragment'
import { LineSegment, Point, Vector } from '../types/base'
import { Subpath } from '../types/paths'

export interface Intersection {
  // Describes an intersection between two segments, with segments produced by
  // sampling a path.
  intersectionPoint: Point // Intersection coordinates.
  iSegmentA: number // Index of segment A in the segment array.
  iSegmentB: number // Index of segment B in the segment array.
  tA: number // How far into segment A the intersection is, [0, 1].
  tB: number // How far into segment B the intersection is, [0, 1].
}

export function computePointToPointDistance(p1: Point, p2: Point): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)
}

export function interpolateLine(p0: Point, p1: Point, t: number): Point {
  return {
    x: (1 - t) * p0.x + t * p1.x,
    y: (1 - t) * p0.y + t * p1.y
  }
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

export function findIntersectionsBetweenSubpaths(
  subpath1: Subpath,
  subpath2: Subpath
): Intersection[] {
  const intersections: Intersection[] = []
  const points1 = subpath1.samplePoints
  const points2 = subpath2.samplePoints

  // Compare each line segment in subpath1 with each line segment in subpath2
  for (let i = 0; i < points1.length - 1; i++) {
    const seg1Start = points1[i]
    const seg1End = points1[i + 1]

    for (let j = 0; j < points2.length - 1; j++) {
      const seg2Start = points2[j]
      const seg2End = points2[j + 1]

      // Use vector cross product to determine if segments intersect
      const [abx, aby] = [seg1End.x - seg1Start.x, seg1End.y - seg1Start.y]
      const [cdx, cdy] = [seg2End.x - seg2Start.x, seg2End.y - seg2Start.y]

      // Calculate determinant
      const det = abx * cdy - aby * cdx

      // If determinant is zero, lines are parallel
      if (Math.abs(det) < EPSILON_INTERSECT) continue

      // Use Cramer's Rule to find intersection point
      const detA1 =
        (seg2End.x - seg2Start.x) * (seg1Start.y - seg2Start.y) -
        (seg2End.y - seg2Start.y) * (seg1Start.x - seg2Start.x)
      const detA2 =
        (seg1End.x - seg1Start.x) * (seg1Start.y - seg2Start.y) -
        (seg1End.y - seg1Start.y) * (seg1Start.x - seg2Start.x)

      const t1 = detA1 / det
      const t2 = detA2 / det

      // Check if intersection lies within both segments
      if (
        t1 > EPSILON_INTERSECT &&
        t1 < 1 - EPSILON_INTERSECT &&
        t2 > EPSILON_INTERSECT &&
        t2 < 1 - EPSILON_INTERSECT
      ) {
        // Calculate intersection point
        const intersectionPoint = {
          x: seg1Start.x + t1 * (seg1End.x - seg1Start.x),
          y: seg1Start.y + t1 * (seg1End.y - seg1Start.y)
        }

        // Adjust indices to be relative to the full path
        const globalSegment1Index = i + subpath1.startIndex
        const globalSegment2Index = j + subpath2.startIndex

        intersections.push({
          iSegmentA: globalSegment1Index,
          iSegmentB: globalSegment2Index,
          intersectionPoint: intersectionPoint,
          tA: t1,
          tB: t2
        })
      }
    }
  }

  return intersections
}

export function computeTangentToLineFragment(fragment: PathFragment): Vector {
  return {
    x: fragment.end.x - fragment.start.x,
    y: fragment.end.y - fragment.start.y
  }
}

export function computeTangentToQuadraticFragment(fragment: PathFragment, t: number): Vector {
  // Quadratic Bézier derivative.
  // https://en.wikipedia.org/wiki/B%C3%A9zier_curve
  const { start, control1, end } = fragment
  return {
    x: 2 * (1 - t) * (control1!.x - start.x) + 2 * t * (end.x - control1!.x),
    y: 2 * (1 - t) * (control1!.y - start.y) + 2 * t * (end.y - control1!.y)
  }
}

export function computeTangentToCubicFragment(fragment: PathFragment, t: number): Vector {
  // Cubic Bézier derivative.
  // https://stackoverflow.com/questions/4089443/find-the-tangent-of-a-point-on-a-cubic-bezier-curve
  // https://en.wikipedia.org/wiki/B%C3%A9zier_curve
  const { start, control1, control2, end } = fragment
  return {
    x:
      3 * (1 - t) ** 2 * (control1!.x - start.x) +
      6 * (1 - t) * t * (control2!.x - control1!.x) +
      3 * t ** 2 * (end.x - control2!.x),
    y:
      3 * (1 - t) ** 2 * (control1!.y - start.y) +
      6 * (1 - t) * t * (control2!.y - control1!.y) +
      3 * t ** 2 * (end.y - control2!.y)
  }
}
