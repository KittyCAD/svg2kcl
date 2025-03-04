import { Point } from '../types/base'
import { PathRegion } from '../types/regions'
import { PathFragment } from '../paths/fragments/fragment'
import { getRegionPoints } from '../paths/regions'
import { FragmentMap } from '../types/fragments'

function doesRayIntersectLineSegment(
  rayStart: Point,
  rayEnd: Point,
  segStart: Point,
  segEnd: Point
): boolean {
  // Fast reject: if segment is completely above or below the ray
  if (
    (segStart.y > rayStart.y && segEnd.y > rayStart.y) ||
    (segStart.y < rayStart.y && segEnd.y < rayStart.y)
  ) {
    return false
  }

  // Fast reject: if segment is completely to the left of ray start
  if (segStart.x < rayStart.x && segEnd.x < rayStart.x) {
    return false
  }

  // If the segment is horizontal and at the same height as the ray,
  // it's not considered an intersection
  if (Math.abs(segStart.y - segEnd.y) < 1e-10 && Math.abs(segStart.y - rayStart.y) < 1e-10) {
    return false
  }

  // Calculate intersection point
  if (Math.abs(segStart.y - segEnd.y) < 1e-10) {
    // Handle horizontal segment edge case
    return false // Horizontal segment at ray height doesn't count
  }

  // Calculate x-coordinate of intersection
  const t = (rayStart.y - segStart.y) / (segEnd.y - segStart.y)
  if (t < 0 || t > 1) {
    return false // Intersection point not on segment
  }

  const intersectX = segStart.x + t * (segEnd.x - segStart.x)

  // The ray goes right, so only count intersections to the right of ray start
  return intersectX >= rayStart.x
}

function calculateWindingDirection(rayStart: Point, segStart: Point, segEnd: Point): number {
  // Return +1 if segment crosses the ray going "upward" (in standard Y sense),
  // or -1 if it crosses "downward," or 0 if no crossing or to the left.
  // This is a simplified version; adjust logic as needed for your sign convention.
  const yTest = rayStart.y

  // Does the edge cross horizontal ray at yTest?
  // We also want to know if it crosses to the right of rayStart.x
  if (segStart.y > yTest !== segEnd.y > yTest) {
    // compute X of intersection
    const t = (yTest - segStart.y) / (segEnd.y - segStart.y)
    const x = segStart.x + t * (segEnd.x - segStart.x)
    if (x >= rayStart.x) {
      return segEnd.y < segStart.y ? -1 : +1
    }
  }
  return 0
}

export function determineInsideness(
  regions: PathRegion[],
  fragments: PathFragment[],
  fragmentMap: FragmentMap
): { evenOdd: PathRegion[]; nonZero: PathRegion[] } {
  // Make copies of regions to store both rule results
  const evenOddRegions = structuredClone(regions)
  const nonZeroRegions = structuredClone(regions)

  // Process each region
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]

    // Generate multiple test points for this region
    const testPoints = generateMultipleTestPoints(region, fragmentMap)

    let evenOddResults = []
    let nonZeroResults = []

    // Test each point
    for (const testPoint of testPoints) {
      const rayEnd = { x: Number.MAX_SAFE_INTEGER, y: testPoint.y }

      let intersectionCount = 0
      let windingNumber = 0

      // Check against all fragments
      for (const fragment of fragments) {
        if (!fragment.sampledPoints)
          throw new Error(`Missing sampledPoints in fragment ${fragment.id}`)

        for (let j = 0; j < fragment.sampledPoints.length - 1; j++) {
          const p1 = fragment.sampledPoints[j]
          const p2 = fragment.sampledPoints[j + 1]

          // Check if ray intersects this segment
          if (doesRayIntersectLineSegment(testPoint, rayEnd, p1, p2)) {
            // For even-odd rule
            intersectionCount++

            // For non-zero rule
            windingNumber += calculateWindingDirection(testPoint, p1, p2)
          }
        }
      }

      // Store results for this test point
      evenOddResults.push(intersectionCount % 2 !== 0) // true if inside
      nonZeroResults.push(windingNumber !== 0) // true if inside
    }

    // Determine final result by majority vote
    const evenOddInside = evenOddResults.filter(Boolean).length > testPoints.length / 2
    const nonZeroInside = nonZeroResults.filter(Boolean).length > testPoints.length / 2

    // Update even-odd result
    evenOddRegions[i].isHole = !evenOddInside
    evenOddRegions[i].basicWindingNumber = evenOddResults.reduce(
      (sum, isInside) => sum + (isInside ? 1 : 0),
      0
    )

    // Update non-zero result
    nonZeroRegions[i].isHole = !nonZeroInside
    nonZeroRegions[i].totalWindingNumber = nonZeroResults.reduce(
      (sum, isInside) => sum + (isInside ? 1 : 0),
      0
    )
  }

  return { evenOdd: evenOddRegions, nonZero: nonZeroRegions }
}

function generateMultipleTestPoints(region: PathRegion, fragmentMap: FragmentMap): Point[] {
  const points: Point[] = []

  // Get boundary
  const boundary = getRegionPoints(region, fragmentMap)

  // Use the existing test point if available
  if (region.testPoint) {
    points.push(region.testPoint)
  }

  // Process boundary points
  if (boundary && boundary.length > 2) {
    // Calculate centroid
    const centroid = calculateCentroid(boundary)

    // Come in 10% of the shape width... or height if that's smaller
    const maxWidth = boundary.reduce((max, p) => Math.max(max, p.x), -Infinity)
    const maxHeight = boundary.reduce((max, p) => Math.max(max, p.y), -Infinity)
    const minWidth = boundary.reduce((min, p) => Math.min(min, p.x), Infinity)
    const minHeight = boundary.reduce((min, p) => Math.min(min, p.y), Infinity)
    const width = maxWidth - minWidth
    const height = maxHeight - minHeight
    const inset_distance = Math.min(width, height) / 10

    // Take ~20 samples along the boundary
    const n_steps = 20
    const n_samples = boundary.length

    // Values n_steps value around the boundary
    const step = n_samples / n_steps
    const start = Math.floor(Math.random() * step)
    const indices = Array.from(
      { length: n_steps },
      (_, i) => Math.floor(start + i * step) % n_samples
    )

    for (const i of indices) {
      const p1 = boundary[i]
      const p2 = boundary[(i + 1) % boundary.length]

      // Calculate midpoint of the boundary segment
      const midpoint = {
        x: (p1.x + p2.x) / 2,
        y: (p1.y + p2.y) / 2
      }

      // Calculate vector from midpoint to centroid
      const toCentroid = {
        x: centroid.x - midpoint.x,
        y: centroid.y - midpoint.y
      }

      // Normalize the vector to centroid
      const lengthToCentroid = Math.sqrt(toCentroid.x * toCentroid.x + toCentroid.y * toCentroid.y)

      // Create inset point by moving toward centroid
      if (lengthToCentroid > 0) {
        const insetPoint = {
          x: midpoint.x + (toCentroid.x / lengthToCentroid) * inset_distance,
          y: midpoint.y + (toCentroid.y / lengthToCentroid) * inset_distance
        }
        points.push(insetPoint)
      } else {
        // If midpoint is already at centroid, just use midpoint
        points.push(midpoint)
      }
    }

    // Also add the centroid itself as a test point
    points.push(centroid)
  }

  return points
}

function calculateCentroid(points: Point[]): Point {
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
