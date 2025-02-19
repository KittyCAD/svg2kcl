import { PathFragment } from '../paths/fragments/fragment'
import { Point } from '../types/base'
import { FragmentMap } from '../types/fragments'
import { PathRegion } from '../types/regions'
import { isPolygonInsidePolygon } from './geometry'
import { exportPointsToCSV } from '../utils/debug'
import { getBoundingBoxArea } from './geometry'

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

      // Use the sampled points if available, otherwise throw an error.
      if (!fragment.sampledPoints) {
        throw new Error('Fragment has no sampled points')
      }
      points.push(...fragment.sampledPoints)
    }

    exportPointsToCSV(points)

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
    const sortedRegions = [...regions].sort((a, b) => {
      const areaA = getBoundingBoxArea(a.boundingBox)
      const areaB = getBoundingBoxArea(b.boundingBox)
      return areaB - areaA // Sort largest to smallest.
    })

    // Helper function to get cumulative winding number through containment hierarchy.
    const getCumulativeWinding = (
      region: PathRegion,
      regionsMap: Map<string, PathRegion>
    ): number => {
      let winding = region.windingNumber
      let currentRegion = region

      while (currentRegion.parentRegionId) {
        const parent = regionsMap.get(currentRegion.parentRegionId)
        if (!parent) break
        winding += parent.windingNumber
        currentRegion = parent
      }

      return winding
    }

    // Create a map for quick region lookup.
    const regionsMap = new Map(regions.map((r) => [r.id, r]))

    // Process each region to find its parent.
    for (const region of sortedRegions) {
      const regionBBox = region.boundingBox
      let immediateParent: PathRegion | undefined

      // First do a quick bounding box check.
      const potentialParents = sortedRegions.filter((candidate) => {
        if (candidate === region) return false
        if (candidate.parentRegionId === region.id) return false

        const candidateBBox = candidate.boundingBox

        const EPSILON = 1e-10
        return (
          regionBBox.xMin > candidateBBox.xMin + EPSILON &&
          regionBBox.xMax < candidateBBox.xMax - EPSILON &&
          regionBBox.yMin > candidateBBox.yMin + EPSILON &&
          regionBBox.yMax < candidateBBox.yMax - EPSILON
        )
      })

      if (potentialParents.length > 0) {
        const regionPoints = this.getRegionPoints(region)

        const containingRegions = potentialParents.filter((candidate) =>
          isPolygonInsidePolygon(regionPoints, this.getRegionPoints(candidate))
        )

        containingRegions.sort(
          (a, b) => getBoundingBoxArea(a.boundingBox) - getBoundingBoxArea(b.boundingBox)
        )

        if (containingRegions.length > 0) {
          immediateParent = containingRegions[0]
        }
      }

      // Assign parent.
      if (immediateParent) {
        region.parentRegionId = immediateParent.id
        // Calculate cumulative winding number through entire containment hierarchy.
        const cumulativeWinding = getCumulativeWinding(region, regionsMap)
        region.isHole = cumulativeWinding === 0
      } else {
        region.parentRegionId = undefined
        region.isHole = false
      }
    }
  }
}
