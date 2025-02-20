import { v4 as uuidv4 } from 'uuid'
import { EPSILON_INTERSECT } from '../constants'
import { calculateBoundingBox, calculateTestPoint, PathFragment } from '../paths/fragments/fragment'
import { Point } from '../types/base'
import { FragmentMap } from '../types/fragments'
import { PathRegion } from '../types/regions'
import { computePointToPointDistance } from '../utils/geometry'
// import { exportPointsToCSV } from '../utils/debug'

export function identifyClosedRegions(
  fragments: PathFragment[],
  fragmentMap: FragmentMap
): PathRegion[] {
  const detectedRegions: PathRegion[] = []
  const processedLoops = new Set<string>()

  for (const startFragment of fragments) {
    const startConnections = startFragment.connectedFragments || []

    for (const startConnection of startConnections) {
      // Start the path with just our first fragment, and follow the specific connection
      const loop = dfsFindLoop(
        startConnection.fragmentId,
        startFragment.start,
        [startFragment.id],
        fragmentMap
      )

      if (loop) {
        const loopKey = [...loop].sort().join(',')
        if (!processedLoops.has(loopKey)) {
          detectedRegions.push({
            id: uuidv4(),
            fragmentIds: loop,
            boundingBox: calculateBoundingBox(loop, fragmentMap),
            testPoint: calculateTestPoint(loop, fragmentMap),
            isHole: false,
            basicWindingNumber: 0,
            totalWindingNumber: 0
          })
          processedLoops.add(loopKey)
        }
      }
    }
  }

  // Special case for scenario where a polygon doesn't self intersect, but does include
  // a coincident meeting point... e.g.
  // M 150,5 l 100,10 -50,50 -30,-30 0,60 30,-30 50,50 -100,10 z
  //
  // With either fill rule pattern, this is the same—we have a path which describes
  // this kind of shape:
  // |-----
  // |    /
  // | |\/ <---- Common vertex just down here.
  // | |/\
  // |    \
  // |-----
  // However, each of the line fragments are independent; there are no intersections,
  // just a single common vertex for the inner and outer shapes. So when we detect
  // the inner region, it is a subset of the outer region—and we can remove it.

  // Special case: Remove subregions fully contained in a larger region.
  const fragIds = detectedRegions.map((r) => r.fragmentIds)
  const iRemove = new Set<number>() // Use a Set to avoid duplicate removals.

  for (let i = 0; i < fragIds.length; i++) {
    for (let j = 0; j < fragIds.length; j++) {
      if (i === j) continue

      let currentSet = fragIds[i]
      let compareSet = fragIds[j]

      // Check if compareSet is a subset of currentSet.
      if (compareSet.every((value) => currentSet.includes(value))) {
        iRemove.add(j)
      }
    }
  }

  // Remove detected subset regions before proceeding.
  const filteredRegions = detectedRegions.filter((_, index) => !iRemove.has(index))

  // Build fragment to region map.
  const fragmentToRegions = new Map<string, string[]>()

  for (const region of filteredRegions) {
    for (const fragmentId of region.fragmentIds) {
      if (!fragmentToRegions.has(fragmentId)) {
        fragmentToRegions.set(fragmentId, [])
      }
      fragmentToRegions.get(fragmentId)?.push(region.id)
    }
  }

  // Now we need to find the neighbors of each region.
  for (const region of filteredRegions) {
    for (const fragmentId of region.fragmentIds) {
      const neighborRegions = fragmentToRegions.get(fragmentId) || []
      for (const neighborId of neighborRegions) {
        if (neighborId !== region.id) {
          if (!region.neighborRegionIds) {
            region.neighborRegionIds = new Set()
          }
          region.neighborRegionIds.add(neighborId)
        }
      }
    }
  }

  return filteredRegions
}

export function dfsFindLoop(
  currentId: string,
  startPoint: Point,
  path: string[],
  fragmentMap: FragmentMap
): string[] | null {
  const fragment = fragmentMap.get(currentId)
  if (!fragment) return null

  // Check if we've made it back to start
  if (computePointToPointDistance(fragment.end, startPoint) < EPSILON_INTERSECT) {
    return [...path, currentId]
  }

  // Continue exploring only if we haven't visited this fragment
  if (path.includes(currentId)) return null

  // Add current fragment to path
  path = [...path, currentId]

  // Try each connection
  for (const connection of fragment.connectedFragments || []) {
    const result = dfsFindLoop(connection.fragmentId, startPoint, path, fragmentMap)
    if (result) {
      return result
    }
  }

  return null
}

export function orderRegions(regions: PathRegion[]): PathRegion[] {
  const parentMap = new Map<string, PathRegion[]>()

  for (const region of regions) {
    if (region.parentRegionId) {
      if (!parentMap.has(region.parentRegionId)) {
        parentMap.set(region.parentRegionId, [])
      }
      parentMap.get(region.parentRegionId)!.push(region)
    } else {
      parentMap.set(region.id, [region]) // Ensure all parents exist
    }
  }

  // Flatten parent-first ordering.
  const orderedRegions: PathRegion[] = []
  for (const [parentId, group] of parentMap.entries()) {
    orderedRegions.push(...group)
  }

  return orderedRegions
}

export function getRegionPoints(region: PathRegion, fragmentMap: FragmentMap): Point[] {
  //  Extracts the ordered boundary points of a region based on its fragment IDs.
  //  This ensures the path reconstruction follows the original path direction.
  const points: Point[] = []

  for (const fragmentId of region.fragmentIds) {
    const fragment = fragmentMap.get(fragmentId)
    if (!fragment) continue

    if (!fragment.sampledPoints) {
      throw new Error('Fragment has no sampled points')
    }
    points.push(...fragment.sampledPoints)
  }

  // exportPointsToCSV(points)
  return points
}
