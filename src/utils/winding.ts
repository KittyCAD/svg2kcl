import { Point } from '../types/base'
import { PathRegion, PathFragment } from '../writer/path_processor' // Ensure this imports the updated `PathRegion` type

export class WindingAnalyzer {
  private fragmentMap: Map<string, PathFragment> // Store fragment lookup

  constructor(fragments: PathFragment[]) {
    this.fragmentMap = new Map(fragments.map((f) => [f.id, f])) // Build lookup map
  }

  private getRegionPoints(region: PathRegion): Point[] {
    // Extracts the ordered boundary points of a region from its fragment IDs
    const points: Point[] = []
    for (const fragmentId of region.fragmentIds) {
      const fragment = this.fragmentMap.get(fragmentId)
      if (fragment) {
        if (
          points.length === 0 ||
          points[points.length - 1].x !== fragment.start.x ||
          points[points.length - 1].y !== fragment.start.y
        ) {
          points.push(fragment.start)
        }
        points.push(fragment.end)
      }
    }

    const pointsExport = points.map((p) => [p.x, p.y])
    return points
  }

  private getPolygonWinding(points: Point[]): number {
    // Computes the winding number for a polygon using the shoelace formula.
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i]
      const p2 = points[(i + 1) % points.length]
      area += p1.x * p2.y - p2.x * p1.y // Shoelace theorem.
    }
    return area > 0 ? 1 : -1 // Counterclockwise: +1, Clockwise: -1.
  }

  private isPointInsidePolygon(point: Point, polygon: Point[]): boolean {
    // Determines if a point is inside a polygon using the winding number method.
    // https://ocw.mit.edu/courses/18-900-geometry-and-topology-in-the-plane-spring-2023/mit18_900s23_lec3.pdf
    let wn = 0 // Winding number counter
    let j = polygon.length - 1

    for (let i = 0; i < polygon.length; i++) {
      const pi = polygon[i]
      const pj = polygon[j]

      if (pi.y <= point.y) {
        if (pj.y > point.y && this.isLeft(pi, pj, point) > 0) {
          wn++
        }
      } else {
        if (pj.y <= point.y && this.isLeft(pi, pj, point) < 0) {
          wn--
        }
      }
      j = i
    }
    return wn !== 0 // Outside only when winding number = 0
  }

  private isLeft(p0: Point, p1: Point, p2: Point): number {
    return (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
  }

  public computeWindingNumbers(regions: PathRegion[]): void {
    for (const region of regions) {
      const regionPoints = this.getRegionPoints(region)
      region.windingNumber = this.getPolygonWinding(regionPoints)
      region.isHole = region.windingNumber < 0
    }
  }

  public assignParentRegions(regions: PathRegion[]): void {
    for (const hole of regions.filter((r) => r.windingNumber < 0)) {
      for (const candidate of regions.filter((r) => r.windingNumber > 0)) {
        const candidatePoints = this.getRegionPoints(candidate)
        if (this.isPointInsidePolygon(hole.testPoint, candidatePoints)) {
          hole.parentRegionId = candidate.id
          break
        }
      }
    }
  }
}
