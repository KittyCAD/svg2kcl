import { PathFragment } from '../paths/fragments/fragment'
import { getRegionPoints } from '../paths/regions'
import { FillRule, Point } from '../types/base'
import { FragmentMap } from '../types/fragments'
import { PathRegion } from '../types/regions'
import { getBoundingBoxArea, isPolygonInsidePolygon } from './geometry'

interface ContainmentInfo {
  region: PathRegion
  containedBy: PathRegion[]
}

abstract class RegionAnalyzer {
  private readonly fragmentMap: FragmentMap

  constructor(fragments: PathFragment[]) {
    this.fragmentMap = new Map(fragments.map((f) => [f.id, f]))
  }

  public analyzeRegions(regions: PathRegion[]): PathRegion[] {
    this.calculateBasicWinding(regions)
    const containmentInfo = this.findContainmentRelationships(regions)
    this.resolveContainmentHierarchy(containmentInfo)

    return regions
  }

  private getPolygonWinding(points: Point[]): number {
    // Computes the winding number for a polygon using the shoelace formula.
    // This determines if a shape is positively (counterclockwise) or negatively
    // (clockwise) wound.
    let area = 0

    for (let i = 0; i < points.length; i++) {
      const p1 = points[i]
      const p2 = points[(i + 1) % points.length]
      area += p1.x * p2.y - p2.x * p1.y
    }

    return area > 0 ? 1 : -1 // Positive: counterclockwise (+1), Negative: clockwise (-1)
  }

  private calculateBasicWinding(regions: PathRegion[]): void {
    // Get the winding number for a given polygon without considering containment.
    for (const region of regions) {
      const regionPoints = getRegionPoints(region, this.fragmentMap)
      const localWindingNumber = this.getPolygonWinding(regionPoints)
      region.basicWindingNumber = localWindingNumber
      region.totalWindingNumber = localWindingNumber
    }
  }

  private findContainmentRelationships(regions: PathRegion[]): ContainmentInfo[] {
    // Sort largest to smallest area.
    const sortedRegions = [...regions].sort((a, b) => {
      const areaA = getBoundingBoxArea(a.boundingBox)
      const areaB = getBoundingBoxArea(b.boundingBox)
      return areaB - areaA
    })

    return sortedRegions.map((region) => ({
      region,
      containedBy: this.findContainingRegions(region, sortedRegions)
    }))
  }

  private findContainingRegions(region: PathRegion, allRegions: PathRegion[]): PathRegion[] {
    const regionBBox = region.boundingBox
    const EPSILON = 1e-10

    // We can eliminate regions where the bounding boxes don't overlap,
    // and where we have parent/child cycles.
    const boundingBoxContainers = allRegions.filter((candidate) => {
      if (candidate === region) return false
      if (candidate.parentRegionId === region.id) return false

      const candidateBBox = candidate.boundingBox
      return (
        regionBBox.xMin > candidateBBox.xMin + EPSILON &&
        regionBBox.xMax < candidateBBox.xMax - EPSILON &&
        regionBBox.yMin > candidateBBox.yMin + EPSILON &&
        regionBBox.yMax < candidateBBox.yMax - EPSILON
      )
    })

    if (boundingBoxContainers.length === 0) return []

    // Do the more expensive polygon containment check.
    const regionPoints = getRegionPoints(region, this.fragmentMap)
    return boundingBoxContainers.filter((candidate) =>
      isPolygonInsidePolygon(regionPoints, getRegionPoints(candidate, this.fragmentMap))
    )
  }

  abstract resolveContainmentHierarchy(containmentInfo: ContainmentInfo[]): void
}

export class WindingAnalyzer extends RegionAnalyzer {
  private calculateCumulativeWinding(
    region: PathRegion,
    regionsMap: Map<string, PathRegion>
  ): number {
    let winding = region.basicWindingNumber
    let currentRegion = region

    while (currentRegion.parentRegionId) {
      const parent = regionsMap.get(currentRegion.parentRegionId)
      if (!parent) break
      winding += parent.basicWindingNumber
      currentRegion = parent
    }

    return winding
  }

  public resolveContainmentHierarchy(containmentInfo: ContainmentInfo[]): void {
    const regionsMap = new Map(containmentInfo.map((info) => [info.region.id, info.region]))

    for (const { region, containedBy } of containmentInfo) {
      if (containedBy.length === 0) {
        region.parentRegionId = undefined
        region.isHole = false
        continue
      }

      containedBy.sort(
        (a, b) => getBoundingBoxArea(a.boundingBox) - getBoundingBoxArea(b.boundingBox)
      )
      const immediateParent = containedBy[0]
      region.parentRegionId = immediateParent.id

      const totalWindingNumber = this.calculateCumulativeWinding(region, regionsMap)
      region.totalWindingNumber = totalWindingNumber

      // Nonzero.
      region.isHole = totalWindingNumber === 0
    }
  }
}

export class EvenOddAnalyzer extends RegionAnalyzer {
  public resolveContainmentHierarchy(containmentInfo: ContainmentInfo[]): void {
    const regionsMap = new Map(containmentInfo.map((info) => [info.region.id, info.region]))

    for (const { region, containedBy } of containmentInfo) {
      if (containedBy.length === 0) {
        region.parentRegionId = undefined
        region.isHole = false
        continue
      }

      containedBy.sort(
        (a, b) => getBoundingBoxArea(a.boundingBox) - getBoundingBoxArea(b.boundingBox)
      )
      const immediateParent = containedBy[0]
      region.parentRegionId = immediateParent.id

      // Count nesting level by walking up the parent chain
      let nestingLevel = 0
      let currentRegion = region
      while (currentRegion.parentRegionId) {
        nestingLevel++
        currentRegion = regionsMap.get(currentRegion.parentRegionId)!
      }

      // Even-odd rule: alternate between fill/hole based on nesting level
      region.isHole = nestingLevel % 2 === 0
      region.totalWindingNumber = nestingLevel // Store nesting level for debugging
    }
  }
}
