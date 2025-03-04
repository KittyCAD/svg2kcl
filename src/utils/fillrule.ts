import { Point } from '../types/base'
import { PathRegion } from '../types/regions'
import { PathFragment } from '../paths/fragments/fragment'

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

function getFragmentReversedForRegion(region: PathRegion, fragId: string): boolean {
  const idx = region.fragmentIds.indexOf(fragId)
  if (idx >= 0) {
    return region.fragmentReversed[idx]
  }
  return false
}

export function determineInsideness(
  regions: PathRegion[],
  fragments: PathFragment[]
): { evenOdd: PathRegion[]; nonZero: PathRegion[] } {
  // Make copies of regions to store both rule results
  const evenOddRegions = JSON.parse(JSON.stringify(regions))
  const nonZeroRegions = JSON.parse(JSON.stringify(regions))

  // Process each region
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]
    const rayStart = region.testPoint
    const rayEnd = { x: Number.MAX_SAFE_INTEGER, y: rayStart.y }

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
        if (doesRayIntersectLineSegment(rayStart, rayEnd, p1, p2)) {
          // For even-odd rule
          intersectionCount++

          // For non-zero rule
          windingNumber += calculateWindingDirection(rayStart, p1, p2)
        }
      }
    }

    // Update even-odd result
    evenOddRegions[i].isHole = intersectionCount % 2 === 0
    evenOddRegions[i].basicWindingNumber = intersectionCount

    // Update non-zero result
    nonZeroRegions[i].isHole = windingNumber === 0
    nonZeroRegions[i].totalWindingNumber = windingNumber
  }

  return { evenOdd: evenOddRegions, nonZero: nonZeroRegions }
}
