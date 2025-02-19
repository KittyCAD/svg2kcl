import { Point } from './base'

export interface PathRegion {
  id: string
  fragmentIds: string[] // List of IDs of path fragments forming the region.
  boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number }
  testPoint: Point // A point inside the region for winding calculation.
  isHole: boolean
  windingNumber: number
  parentRegionId?: string
  neighborRegionIds?: Set<string>
}
