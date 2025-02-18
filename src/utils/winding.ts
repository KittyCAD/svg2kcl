import { Point } from '../types/base'
import { PathRegion, PathFragment } from '../writer/path_processor' // Ensure this imports the updated `PathRegion` type

export class WindingAnalyzer {
  private fragmentMap: Map<string, PathFragment>

  constructor(fragments: PathFragment[]) {
    // Initialize lookup map for quick fragment access
    this.fragmentMap = new Map(fragments.map((f) => [f.id, f]))
  }

  private getRegionPoints(region: PathRegion): Point[] {
    //  Extracts the ordered boundary points of a region based on its fragment IDs.
    //  This ensures the path reconstruction follows the original path direction.
    const points: Point[] = []

    for (const fragmentId of region.fragmentIds) {
      const fragment = this.fragmentMap.get(fragmentId)
      if (!fragment) continue

      // Ensure continuity in the path sequence
      if (
        points.length === 0 ||
        points[points.length - 1].x !== fragment.start.x ||
        points[points.length - 1].y !== fragment.start.y
      ) {
        points.push(fragment.start)
      }

      points.push(fragment.end) // Append endpoint
    }

    return points
  }

  private getPolygonWinding(points: Point[]): number {
    // Computes the winding number for a polygon using the shoelace formula.
    // This determines if a shape is positively (counterclockwise) or negatively (clockwise) wound.
    let area = 0

    for (let i = 0; i < points.length; i++) {
      const p1 = points[i]
      const p2 = points[(i + 1) % points.length]
      area += p1.x * p2.y - p2.x * p1.y // Shoelace theorem sum.
    }

    return area > 0 ? 1 : -1 // Positive: counterclockwise (+1), Negative: clockwise (-1)
  }

  private isPointInsidePolygon(point: Point, polygon: Point[]): boolean {
    // Determines if a point is inside a polygon using the nonzero winding rule.
    // See: https://oreillymedia.github.io/Using_SVG/extras/ch06-fill-rule.html
    // And: https://ocw.mit.edu/courses/18-900-geometry-and-topology-in-the-plane-spring-2023/mit18_900s23_lec3.pdf
    let wn = 0 // Winding number counter
    let j = polygon.length - 1

    for (let i = 0; i < polygon.length; i++) {
      const pi = polygon[i]
      const pj = polygon[j]

      // Determine crossing direction
      if (pi.y <= point.y) {
        if (pj.y > point.y && this.isLeft(pi, pj, point) > 0) {
          wn++ // Upward crossing adds to winding number.
        }
      } else {
        if (pj.y <= point.y && this.isLeft(pi, pj, point) < 0) {
          wn-- // Downward crossing subtracts from winding number.
        }
      }

      j = i // Move to next segment
    }

    return wn !== 0 // A nonzero winding number means the point is inside.
  }

  private isLeft(p0: Point, p1: Point, p2: Point): number {
    // Computes whether a point lies to the left (+) or right (-) of a directed line segment.
    // This is a determinant-based test for relative orientation.
    return (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
  }

  public computeWindingNumbers(regions: PathRegion[]): void {
    // Computes winding numbers for all regions, classifying them as holes or solids.
    let x = 1
    for (const region of regions) {
      const regionPoints = this.getRegionPoints(region)

      // Determine the winding order of the polygon.
      region.windingNumber = this.getPolygonWinding(regionPoints)

      // Note that this is not yet enough to flag if geometry forms a hole or not,
      // because we also need to check if the region is inside another region.
      // Effectively, direction doesn't matter if the region is not enclosed by another
      // region.
    }
  }

  public assignParentRegions(regions: PathRegion[]): void {
    // Separate out potential holes and solids.
    const potentialHoles = regions.filter((r) => r.windingNumber < 0)
    const solids = regions.filter((r) => r.windingNumber > 0)

    for (const hole of potentialHoles) {
      for (const candidate of solids) {
        const candidatePoints = this.getRegionPoints(candidate)

        // Holes are only holes if the parent region encloses them.
        if (this.isPointInsidePolygon(hole.testPoint, candidatePoints)) {
          hole.parentRegionId = candidate.id
          hole.isHole = true
          break // Stop once we assign a parent
        }
      }
    }
  }
}
