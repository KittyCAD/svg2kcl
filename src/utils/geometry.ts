import { EPSILON_INTERSECT } from '../constants'
import { Point, LineSegment } from '../types/base'
import { Subpath } from '../types/paths'

export interface Intersection {
  intersectionPoint: Point // Intersection coordinates
  iSegmentA: number // Index of segment A in the segment array
  iSegmentB: number // Index of segment B in the segment array
  tA: number // How far into segment A the intersection is, [0, 1]
  tB: number // How far into segment B the intersection is, [0, 1]
}

export function computePointToPointDistance(point1: Point, point2: Point): number {
  return Math.sqrt((point1.x - point2.x) ** 2 + (point1.y - point2.y) ** 2)
}

export function sampleLine(start: Point, end: Point, numSamples: number): Point[] {
  const points: Point[] = []
  for (let i = 0; i < numSamples; i++) {
    const t = i / (numSamples - 1)
    points.push(interpolateLine(start, end, t))
  }
  return points
}

export function interpolateLine(start: Point, end: Point, t: number): Point {
  return {
    x: (1 - t) * start.x + t * end.x,
    y: (1 - t) * start.y + t * end.y
  }
}

export function isPointOnLineSegment(
  point: Point,
  segmentStart: Point,
  segmentEnd: Point
): boolean {
  // Check if point is collinear with the line segment.
  const crossProduct =
    (point.y - segmentStart.y) * (segmentEnd.x - segmentStart.x) -
    (point.x - segmentStart.x) * (segmentEnd.y - segmentStart.y)

  if (Math.abs(crossProduct) > EPSILON_INTERSECT) {
    return false // Not collinear.
  }

  // Check if point is within the segment bounds using dot product.
  const dotProduct =
    (point.x - segmentStart.x) * (segmentEnd.x - segmentStart.x) +
    (point.y - segmentStart.y) * (segmentEnd.y - segmentStart.y)

  if (dotProduct < 0) {
    return false // Point is beyond segmentStart..
  }

  const squaredLengthSegment =
    (segmentEnd.x - segmentStart.x) ** 2 + (segmentEnd.y - segmentStart.y) ** 2

  if (dotProduct > squaredLengthSegment) {
    return false // Point is beyond segmentEnd.
  }

  return true // Point lies on the segment.
}

export function calculateCentroid(points: Point[]): Point {
  if (points.length === 0) {
    throw new Error('Cannot calculate centroid of empty points array.')
  }

  let sumX = 0
  let sumY = 0

  for (const point of points) {
    sumX += point.x
    sumY += point.y
  }

  return {
    x: sumX / points.length,
    y: sumY / points.length
  }
}

export function calculatePolygonArea(points: Point[]): number {
  // Calculate the area of a polygon using the shoelace formula.
  // https://en.wikipedia.org/wiki/Shoelace_formula
  let area = 0
  const n = points.length

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y
    area -= points[j].x * points[i].y
  }

  return area / 2
}

export function getBoundingBoxArea(boundingBox: {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}): number {
  return (boundingBox.xMax - boundingBox.xMin) * (boundingBox.yMax - boundingBox.yMin)
}

export function isLeft(lineStart: Point, lineEnd: Point, point: Point): number {
  // The 2D cross product of AB and AP vectors.
  return (
    (lineEnd.x - lineStart.x) * (point.y - lineStart.y) -
    (point.x - lineStart.x) * (lineEnd.y - lineStart.y)
  )
}

export function doesRayIntersectLineSegment(
  rayStart: Point,
  rayEnd: Point,
  segmentStart: Point,
  segmentEnd: Point
): boolean {
  // Fast reject: if segment is completely above or below the ray.
  if (
    (segmentStart.y > rayStart.y && segmentEnd.y > rayStart.y) ||
    (segmentStart.y < rayStart.y && segmentEnd.y < rayStart.y)
  ) {
    return false
  }

  // Fast reject: if segment is completely to the left of ray start.
  if (segmentStart.x < rayStart.x && segmentEnd.x < rayStart.x) {
    return false
  }

  // If the segment is horizontal and at the same height as the ray,
  // it's not considered an intersection.
  if (
    Math.abs(segmentStart.y - segmentEnd.y) < EPSILON_INTERSECT &&
    Math.abs(segmentStart.y - rayStart.y) < EPSILON_INTERSECT
  ) {
    return false
  }

  // Calculate intersection point.
  if (Math.abs(segmentStart.y - segmentEnd.y) < EPSILON_INTERSECT) {
    // Handle horizontal segment edge case.
    return false // Horizontal segment at ray height doesn't count.
  }

  // Calculate x-coordinate of intersection.
  const t = (rayStart.y - segmentStart.y) / (segmentEnd.y - segmentStart.y)
  if (t < 0 || t > 1) {
    return false // Intersection point not on segment.
  }

  const intersectX = segmentStart.x + t * (segmentEnd.x - segmentStart.x)

  // The ray goes right, so only count intersections to the right of ray start.
  return intersectX >= rayStart.x
}

export function findSelfIntersections(points: Point[], startIndex: number): Intersection[] {
  let intersections: Intersection[] = []
  const segments: LineSegment[] = [] // Segments composed of two points.

  // Break path into segments
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      start: points[i],
      end: points[i + 1]
    } as LineSegment)
  }

  let comparedPairs: Map<number, number[]> = new Map()

  // Compare each segment pair for intersections.
  // Skip adjacent segments because these would always intersect:
  // Segment 1: A----B
  // Segment 2:      B----C
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 2; j < segments.length; j++) {
      // Track
      if (!comparedPairs.has(i)) {
        comparedPairs.set(i, [])
      }
      comparedPairs.get(i)!.push(j)

      const seg1 = segments[i]
      const seg2 = segments[j]

      // Cross product of AB and CD. Our vectors are 2D, so we only need the z component.
      const [abx, aby] = [seg1.end.x - seg1.start.x, seg1.end.y - seg1.start.y]
      const [cdx, cdy] = [seg2.end.x - seg2.start.x, seg2.end.y - seg2.start.y]

      // Calculate determinant (z-component of cross product).
      const det = abx * cdy - aby * cdx

      // If determinant is zero, then the two segments are parallel.
      if (Math.abs(det) < EPSILON_INTERSECT) {
        continue
      }

      // Use Cramer's Rule to find intersection parameters.
      const detA1 =
        (seg2.end.x - seg2.start.x) * (seg1.start.y - seg2.start.y) -
        (seg2.end.y - seg2.start.y) * (seg1.start.x - seg2.start.x)
      let ua = detA1 / det

      const detA2 =
        (seg1.end.x - seg1.start.x) * (seg1.start.y - seg2.start.y) -
        (seg1.end.y - seg1.start.y) * (seg1.start.x - seg2.start.x)
      let ub = detA2 / det

      // Check if intersection parameters are within valid range.
      const isUaValid = ua >= -EPSILON_INTERSECT && ua <= 1 + EPSILON_INTERSECT
      const isUbValid = ub >= -EPSILON_INTERSECT && ub <= 1 + EPSILON_INTERSECT

      if (!isUaValid || !isUbValid) {
        continue
      }

      // Check if intersection is at endpoints of both segments.
      const isUaAtEndpoint =
        Math.abs(ua) < EPSILON_INTERSECT || Math.abs(ua - 1) < EPSILON_INTERSECT
      const isUbAtEndpoint =
        Math.abs(ub) < EPSILON_INTERSECT || Math.abs(ub - 1) < EPSILON_INTERSECT

      if (isUaAtEndpoint && isUbAtEndpoint) {
        continue
      }

      // Clamp intersection parameters to valid range [0,1].
      ua = Math.max(0, Math.min(1, ua))
      ub = Math.max(0, Math.min(1, ub))

      // Calculate the intersection point.
      const intersectionPoint = {
        x: seg1.start.x + ua * (seg1.end.x - seg1.start.x),
        y: seg1.start.y + ua * (seg1.end.y - seg1.start.y)
      }

      // Adjust indices to be relative to the full path sample set.
      const globalSegmentAIndex = i + startIndex
      const globalSegmentBIndex = j + startIndex

      intersections.push({
        iSegmentA: globalSegmentAIndex,
        iSegmentB: globalSegmentBIndex,
        intersectionPoint,
        tA: ua,
        tB: ub
      })
    }
  }

  // Deduplicate intersections.
  // This could happen where our splitline runs through adjacent segments.
  intersections = intersections.filter(
    (inter, index, self) =>
      index ===
      self.findIndex(
        (other) =>
          other.iSegmentB === inter.iSegmentB &&
          Math.sqrt(
            (other.intersectionPoint.x - inter.intersectionPoint.x) ** 2 +
              (other.intersectionPoint.y - inter.intersectionPoint.y) ** 2
          ) < EPSILON_INTERSECT
      )
  )

  return intersections
}

export function findIntersectionsBetweenSubpaths(
  subpathA: Subpath,
  subpathB: Subpath,
  iFirstPointA: number,
  iFirstPointB: number
): Intersection[] {
  const intersections: Intersection[] = []
  const points1 = subpathA.samplePoints
  const points2 = subpathB.samplePoints

  // Compare each line segment in subpath1 with each line segment in subpath2.
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

      // Use Cramer's Rule to find intersection point.
      const detA1 =
        (seg2End.x - seg2Start.x) * (seg1Start.y - seg2Start.y) -
        (seg2End.y - seg2Start.y) * (seg1Start.x - seg2Start.x)
      const detA2 =
        (seg1End.x - seg1Start.x) * (seg1Start.y - seg2Start.y) -
        (seg1End.y - seg1Start.y) * (seg1Start.x - seg2Start.x)

      const t1 = detA1 / det
      const t2 = detA2 / det

      // Check if intersection lies within both segments.
      if (
        t1 > EPSILON_INTERSECT &&
        t1 < 1 - EPSILON_INTERSECT &&
        t2 > EPSILON_INTERSECT &&
        t2 < 1 - EPSILON_INTERSECT
      ) {
        // Calculate intersection point.
        const intersectionPoint = {
          x: seg1Start.x + t1 * (seg1End.x - seg1Start.x),
          y: seg1Start.y + t1 * (seg1End.y - seg1Start.y)
        }

        // Adjust indices to be relative to the full path sample set.
        const globalSegmentAIndex = i + iFirstPointA
        const globalSegmentBIndex = j + iFirstPointB

        intersections.push({
          iSegmentA: globalSegmentAIndex,
          iSegmentB: globalSegmentBIndex,
          intersectionPoint,
          tA: t1,
          tB: t2
        })
      }
    }
  }

  return intersections
}

export function polarAngle(dx: number, dy: number): number {
  return Math.atan2(dy, dx)
}
