import { EPSILON_INTERSECT } from '../constants'
import { PathFragment } from '../paths/fragments/fragment'
import { Point } from '../types/base'
import { PathRegion } from '../writer/path_processor' // Ensure this imports the updated `PathRegion` type

export class WindingAnalyzer {
  private fragmentMap: Map<string, PathFragment>

  constructor(fragments: PathFragment[]) {
    // Initialize lookup map for quick fragment access
    this.fragmentMap = new Map(fragments.map((f) => [f.id, f]))
  }

  public getRegionPoints(region: PathRegion): Point[] {
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

  public isPolygonInsidePolygon(inner: Point[], outer: Point[]): boolean {
    for (const vertex of inner) {
      // If ANY vertex is outside, the whole shape is not inside
      if (!this.isPointInsidePolygon(vertex, outer) && !this.isPointOnEdge(vertex, outer)) {
        return false
      }
    }
    return true
  }

  // Helper function to check if a point is on the polygon's edge
  private isPointOnEdge(point: Point, polygon: Point[]): boolean {
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i]
      const p2 = polygon[(i + 1) % polygon.length] // Wraps around to first point

      if (this.isPointOnSegment(point, p1, p2)) {
        return true // Point lies exactly on an edge
      }
    }
    return false
  }

  private isPointOnSegment(p: Point, a: Point, b: Point): boolean {
    // Helper function to check if a point lies on a line segment
    const crossProduct = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y)
    if (Math.abs(crossProduct) > EPSILON_INTERSECT) return false // Not collinear

    const dotProduct = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)
    if (dotProduct < 0) return false // Beyond 'a'

    const squaredLengthBA = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y)
    if (dotProduct > squaredLengthBA) return false // Beyond 'b'

    return true // Lies within the segment bounds
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
    // Sort regions by area first (larger regions first)
    const sortedRegions = [...regions].sort((a, b) => {
      const areaA =
        (a.boundingBox.xMax - a.boundingBox.xMin) * (a.boundingBox.yMax - a.boundingBox.yMin)
      const areaB =
        (b.boundingBox.xMax - b.boundingBox.xMin) * (b.boundingBox.yMax - b.boundingBox.yMin)
      return areaB - areaA // Descending order
    })

    // Process each region to find its parent
    for (const region of sortedRegions) {
      const regionPoints = this.getRegionPoints(region)

      // Find potential containing regions
      const potentialParents = sortedRegions.filter((candidate) => {
        if (candidate === region) return false
        if (candidate.parentRegionId === region.id) return false

        const candidateArea =
          (candidate.boundingBox.xMax - candidate.boundingBox.xMin) *
          (candidate.boundingBox.yMax - candidate.boundingBox.yMin)
        const regionArea =
          (region.boundingBox.xMax - region.boundingBox.xMin) *
          (region.boundingBox.yMax - region.boundingBox.yMin)
        if (candidateArea <= regionArea) return false

        return this.isPolygonInsidePolygon(regionPoints, this.getRegionPoints(candidate))
      })

      if (potentialParents.length > 0) {
        // Find the smallest containing region (immediate parent)
        const parent = potentialParents.reduce((closest, current) => {
          if (!closest) return current

          const closestArea =
            (closest.boundingBox.xMax - closest.boundingBox.xMin) *
            (closest.boundingBox.yMax - closest.boundingBox.yMin)
          const currentArea =
            (current.boundingBox.xMax - current.boundingBox.xMin) *
            (current.boundingBox.yMax - current.boundingBox.yMin)
          return currentArea < closestArea ? current : closest
        })

        region.parentRegionId = parent.id

        // For nonzero fill rule:
        // If this region plus its parent's winding numbers sum to zero, it's a hole
        region.isHole = region.windingNumber + parent.windingNumber === 0
      } else {
        region.parentRegionId = undefined
        region.isHole = false
      }
    }
  }
}
