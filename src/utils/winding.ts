import { PathFragment } from '../paths/fragments/fragment'
import { Point } from '../types/base'
import { FragmentMap } from '../types/fragments'
import { PathRegion } from '../types/regions'
import { isPolygonInsidePolygon } from './geometry'

export class WindingAnalyzer {
  private fragmentMap: FragmentMap

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

        return isPolygonInsidePolygon(regionPoints, this.getRegionPoints(candidate))
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
