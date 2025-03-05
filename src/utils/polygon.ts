import { N_BOUNDARY_SAMPLES_FILLRULE } from '../constants'
import { PathFragment } from '../paths/fragments/fragment'
import { getRegionPoints } from '../paths/regions'
import { Point } from '../types/base'
import { FragmentMap } from '../types/fragments'
import { PathRegion } from '../types/regions'
import {
  calculateCentroid,
  doesRayIntersectLineSegment,
  isLeft,
  isPointOnLineSegment
} from './geometry'

export function isPointOnPolygonEdge(point: Point, polygon: Point[]): boolean {
  for (let i = 0; i < polygon.length; i++) {
    const currentVertex = polygon[i]
    const nextVertex = polygon[(i + 1) % polygon.length] // Wrap around to first point

    if (isPointOnLineSegment(point, currentVertex, nextVertex)) {
      return true
    }
  }
  return false
}

export function isPointInsidePolygon(point: Point, polygon: Point[]): boolean {
  let windingNumber = 0
  let j = polygon.length - 1

  for (let i = 0; i < polygon.length; i++) {
    const currentVertex = polygon[i]
    const prevVertex = polygon[j]

    // Check if edge crosses horizontal ray from point.
    if (prevVertex.y <= point.y) {
      if (currentVertex.y > point.y && isLeft(prevVertex, currentVertex, point) > 0) {
        // Upward crossing, ray crosses edge from right to left
        windingNumber++
      }
    } else {
      if (currentVertex.y <= point.y && isLeft(prevVertex, currentVertex, point) < 0) {
        // Downward crossing, ray crosses edge from left to right.
        windingNumber--
      }
    }

    j = i
  }

  // Non-zero winding number means point is inside.
  return windingNumber !== 0
}

export function isPolygonInsidePolygon(inner: Point[], outer: Point[]): boolean {
  for (const vertex of inner) {
    // If any vertex is outside, it cannot be the case that the whole shape is inside.
    if (!isPointInsidePolygon(vertex, outer) && !isPointOnPolygonEdge(vertex, outer)) {
      return false
    }
  }
  return true
}

export function calculateWindingDirection(
  rayStart: Point,
  segmentStart: Point,
  segmentEnd: Point
): number {
  // Return +1 if segment crosses the ray going up, -1 if it crosses down.
  const yTest = rayStart.y

  // We also want to know if it crosses to the right of rayStart.x
  if (segmentStart.y > yTest !== segmentEnd.y > yTest) {
    const t = (yTest - segmentStart.y) / (segmentEnd.y - segmentStart.y)
    const x = segmentStart.x + t * (segmentEnd.x - segmentStart.x)
    if (x >= rayStart.x) {
      return segmentEnd.y < segmentStart.y ? -1 : +1
    }
  }
  return 0
}

export function determineInsideness(
  regions: PathRegion[],
  fragments: PathFragment[],
  fragmentMap: FragmentMap
): { evenOdd: PathRegion[]; nonZero: PathRegion[] } {
  // Make copies of regions to store both rule results.
  const evenOddRegions = structuredClone(regions)
  const nonZeroRegions = structuredClone(regions)

  // Process each region.
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]

    // Generate multiple test points for this region.
    const testPoints = generateMultipleTestPoints(region, fragmentMap)

    let evenOddResults: boolean[] = []
    let nonZeroResults: boolean[] = []

    // Test each point.
    for (const testPoint of testPoints) {
      const rayEnd = { x: Number.MAX_SAFE_INTEGER, y: testPoint.y }

      let intersectionCount = 0
      let windingNumber = 0

      // Check against all fragments.
      for (const fragment of fragments) {
        if (!fragment.sampledPoints)
          throw new Error(`Missing sampledPoints in fragment ${fragment.id}`)

        for (let j = 0; j < fragment.sampledPoints.length - 1; j++) {
          const p1 = fragment.sampledPoints[j]
          const p2 = fragment.sampledPoints[j + 1]

          // Check if ray intersects this segment.
          if (doesRayIntersectLineSegment(testPoint, rayEnd, p1, p2)) {
            // For even-odd rule.
            intersectionCount++

            // For non-zero rule
            windingNumber += calculateWindingDirection(testPoint, p1, p2)
          }
        }
      }

      // Store results for this test point.
      evenOddResults.push(intersectionCount % 2 !== 0)
      nonZeroResults.push(windingNumber !== 0)
    }

    // Determine final result by majority vote
    const evenOddInside = evenOddResults.filter(Boolean).length > testPoints.length / 2
    const nonZeroInside = nonZeroResults.filter(Boolean).length > testPoints.length / 2

    // Update even-odd result.
    evenOddRegions[i].isHole = !evenOddInside
    evenOddRegions[i].basicWindingNumber = evenOddResults.reduce(
      (sum, isInside) => sum + (isInside ? 1 : 0),
      0
    )

    // Update non-zero result.
    nonZeroRegions[i].isHole = !nonZeroInside
    nonZeroRegions[i].totalWindingNumber = nonZeroResults.reduce(
      (sum, isInside) => sum + (isInside ? 1 : 0),
      0
    )
  }

  return { evenOdd: evenOddRegions, nonZero: nonZeroRegions }
}

export function generateMultipleTestPoints(region: PathRegion, fragmentMap: FragmentMap): Point[] {
  const points: Point[] = []

  // Get boundary.
  const boundary = getRegionPoints(region, fragmentMap)

  // Use the existing test point if available.
  if (region.testPoint) {
    points.push(region.testPoint)
  }

  // Process boundary points.
  if (boundary && boundary.length > 2) {
    // Calculate centroid.
    const centroid = calculateCentroid(boundary)

    // Come in 10% of the shape width... or height if that's smaller.
    const maxWidth = boundary.reduce((max, p) => Math.max(max, p.x), -Infinity)
    const maxHeight = boundary.reduce((max, p) => Math.max(max, p.y), -Infinity)
    const minWidth = boundary.reduce((min, p) => Math.min(min, p.x), Infinity)
    const minHeight = boundary.reduce((min, p) => Math.min(min, p.y), Infinity)
    const width = maxWidth - minWidth
    const height = maxHeight - minHeight
    const inset_distance = Math.min(width, height) / 10

    // Take samples along the boundary.
    const n_samples = boundary.length

    // Values n_steps value around the boundary.
    const step = n_samples / N_BOUNDARY_SAMPLES_FILLRULE
    const start = Math.floor(Math.random() * step)
    const indices = Array.from(
      { length: N_BOUNDARY_SAMPLES_FILLRULE },
      (_, i) => Math.floor(start + i * step) % n_samples
    )

    for (const i of indices) {
      const p1 = boundary[i]
      const p2 = boundary[(i + 1) % boundary.length]

      // Calculate midpoint of the boundary segment.
      const midpoint = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
      }

      // Calculate vector from midpoint to centroid.
      const toCentroid = {
        x: centroid.x - midpoint.x,
        y: centroid.y - midpoint.y
      }

      // Normalize the vector to centroid.
      const lengthToCentroid = Math.sqrt(toCentroid.x * toCentroid.x + toCentroid.y * toCentroid.y)

      // Create inset point by moving toward centroid.
      if (lengthToCentroid > 0) {
        const insetPoint = {
          x: midpoint.x + (toCentroid.x / lengthToCentroid) * inset_distance,
          y: midpoint.y + (toCentroid.y / lengthToCentroid) * inset_distance
        }
        points.push(insetPoint)
      } else {
        // If midpoint is already at centroid, just use midpoint.
        points.push(midpoint)
      }
    }

    // Also add the centroid itself as a test point.
    points.push(centroid)
  }

  return points
}
