import { Point } from './base'

export interface PathRegion {
  id: string
  fragmentIds: string[] // List of IDs of path fragments forming the region.
  fragmentReversed: boolean[] // Indicates if each fragment needs to be reversed
  boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number }
  testPoint: Point // A point inside the region for winding calculation.
  isHole: boolean
  basicWindingNumber: number
  totalWindingNumber: number
  parentRegionId?: string
  neighborRegionIds?: Set<string>
}
