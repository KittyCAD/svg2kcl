import { PathFragment } from './fragment'
import { Point } from '../../types/base'
import { computePointToPointDistance } from '../../utils/geometry'
import { EPSILON_INTERSECT } from '../../constants'
import { PlanarFaceTree, DiscoveryResult } from 'planar-face-discovery'
import { PathRegion } from '../../types/regions'
import { calculateBoundingBox, calculateTestPoint } from './fragment'
import { FragmentMap } from '../../types/fragments'

interface PlanarGraph {
  nodes: Array<[number, number]>
  edges: Array<[number, number]>
  fragmentEdgeMap: Map<string, string>
}

export function buildPlanarGraphFromFragments(fragments: PathFragment[]): PlanarGraph {
  // We'll store each unique node in 'nodes'.
  // Then we identify edges by node indices.
  const nodes: Array<[number, number]> = []

  // Use a Map to track which fragment each edge belongs to
  const fragmentEdgeMap = new Map<string, string>()

  function getNodeId(point: Point): number {
    for (let i = 0; i < nodes.length; i++) {
      const [nx, ny] = nodes[i]
      if (computePointToPointDistance(point, { x: nx, y: ny }) < EPSILON_INTERSECT) {
        // This existing node is "close enough" to count as the same point
        return i
      }
    }

    // If we get here, no existing node was within the epsilon,
    // so we add a new node.
    const newId = nodes.length
    nodes.push([point.x, point.y])
    return newId
  }

  // Use a Set to avoid duplicate edges (since edges are undirected).
  const edgeSet = new Set<string>()

  // First, ensure all fragment endpoints are registered as nodes
  const fragmentNodeIds = new Map<string, { startId: number; endId: number }>()
  for (const fragment of fragments) {
    const startId = getNodeId(fragment.start)
    const endId = getNodeId(fragment.end)
    fragmentNodeIds.set(fragment.id, { startId, endId })
  }

  // Now add edges based on sampled points
  for (const fragment of fragments) {
    if (fragment.sampledPoints && fragment.sampledPoints.length > 2) {
      // Ensure enough points
      // Don't sample ALL points - that can cause numerical issues
      // Take a reasonable number of sample points along the curve
      const numSamples = Math.min(20, fragment.sampledPoints.length)
      const step = (fragment.sampledPoints.length - 1) / (numSamples - 1)

      let prevId = fragmentNodeIds.get(fragment.id)?.startId

      for (let i = 1; i < numSamples - 1; i++) {
        const idx = Math.round(i * step)
        const point = fragment.sampledPoints[idx]
        const currentId = getNodeId(point)

        if (prevId !== undefined && prevId !== currentId) {
          // Skip zero-length edges
          // Store edge in a consistent (min, max) order.
          const a = Math.min(prevId, currentId)
          const b = Math.max(prevId, currentId)
          const edgeKey = `${a},${b}`

          edgeSet.add(edgeKey)
          fragmentEdgeMap.set(edgeKey, fragment.id)
        }

        prevId = currentId
      }

      // Connect the last sampled point to the fragment end point
      const endId = fragmentNodeIds.get(fragment.id)?.endId
      if (prevId !== undefined && endId !== undefined && prevId !== endId) {
        const a = Math.min(prevId, endId)
        const b = Math.max(prevId, endId)
        const edgeKey = `${a},${b}`

        edgeSet.add(edgeKey)
        fragmentEdgeMap.set(edgeKey, fragment.id)
      }
    } else {
      // For fragments with too few sample points, just connect start to end
      const { startId, endId } = fragmentNodeIds.get(fragment.id) || {
        startId: undefined,
        endId: undefined
      }

      if (startId !== undefined && endId !== undefined && startId !== endId) {
        const a = Math.min(startId, endId)
        const b = Math.max(startId, endId)
        const edgeKey = `${a},${b}`

        edgeSet.add(edgeKey)
        fragmentEdgeMap.set(edgeKey, fragment.id)
      }
    }
  }

  // Convert the Set of "a,b" strings into numeric pairs.
  const edges: Array<[number, number]> = Array.from(edgeSet, (str) => {
    const [a, b] = str.split(',').map(Number)
    return [a, b]
  })

  // Verify graph is not empty
  console.log(`Built graph with ${nodes.length} nodes and ${edges.length} edges`)

  return {
    nodes,
    edges,
    fragmentEdgeMap
  }
}
export function getFaces(graph: PlanarGraph): DiscoveryResult {
  // Create the solver instance.
  const solver = new PlanarFaceTree()

  // Run face discovery.
  const faceForest = solver.discover(graph.nodes, graph.edges)

  if (faceForest.type === 'RESULT') {
    return faceForest
  } else {
    throw new Error('Face discovery failed')
  }
}

export function buildRegions(
  graph: PlanarGraph,
  faceForest: DiscoveryResult,
  fragments: PathFragment[],
  fragmentMap: FragmentMap
): PathRegion[] {
  const { nodes, fragmentEdgeMap } = graph // Extract the fragmentEdgeMap from the graph
  const regions: PathRegion[] = []
  let regionIndex = 0

  function findFragmentIds(cycle: number[]): Array<{ id: string; reversed: boolean }> {
    // Create an array to hold the matched fragment IDs and their reversed status
    const orderedFragmentDetails: Array<{ id: string; reversed: boolean }> = []

    for (let i = 0; i < cycle.length - 1; i++) {
      const nodeA = cycle[i]
      const nodeB = cycle[i + 1]

      // Create the edge key in canonical form (min,max)
      const edgeKey = `${Math.min(nodeA, nodeB)},${Math.max(nodeA, nodeB)}`

      // Look up the fragment ID from our map
      const fragmentId = fragmentEdgeMap?.get(edgeKey)

      if (fragmentId) {
        // Find the fragment to check its direction
        const fragment = fragments.find((f) => f.id === fragmentId)

        if (fragment) {
          const startNodeCoords = nodes[nodeA]
          const endNodeCoords = nodes[nodeB]

          // Calculate all four possible distances to determine orientation
          const startToStart = computePointToPointDistance(fragment.start, {
            x: startNodeCoords[0],
            y: startNodeCoords[1]
          })

          const startToEnd = computePointToPointDistance(fragment.start, {
            x: endNodeCoords[0],
            y: endNodeCoords[1]
          })

          const endToStart = computePointToPointDistance(fragment.end, {
            x: startNodeCoords[0],
            y: startNodeCoords[1]
          })

          const endToEnd = computePointToPointDistance(fragment.end, {
            x: endNodeCoords[0],
            y: endNodeCoords[1]
          })

          // Check which orientation has the smallest total distance
          const forwardDistance = startToStart + endToEnd
          const reverseDistance = startToEnd + endToStart

          // If forward distance is smaller, fragment is not reversed
          // If reverse distance is smaller, fragment is reversed
          const isReversed = reverseDistance < forwardDistance

          // Additional check for edges that are actually part of the original fragment (not sampled points)
          // For these, we can be more precise about direction
          if (
            (startToStart < EPSILON_INTERSECT && endToEnd < EPSILON_INTERSECT) ||
            (startToEnd < EPSILON_INTERSECT && endToStart < EPSILON_INTERSECT)
          ) {
            // This is an original fragment edge, not a sampled segment
            // Determine if it's reversed based on which points match
            const isReversed = startToEnd < EPSILON_INTERSECT
            orderedFragmentDetails.push({ id: fragmentId, reversed: isReversed })
          } else {
            // This is a sampled segment or partial segment
            orderedFragmentDetails.push({ id: fragmentId, reversed: isReversed })
          }
        } else {
          console.warn(`Fragment ${fragmentId} not found in fragments array`)
        }
      } else {
        // If we have sampled points, this might be a segment from within a fragment
        // We can try to match it to the original fragment
        const startNodeCoords = nodes[nodeA]
        const endNodeCoords = nodes[nodeB]

        let matched = false

        for (const fragment of fragments) {
          // Check if both points are on the fragment's path
          let foundStart = false
          let foundEnd = false
          let startIndex = -1
          let endIndex = -1

          if (fragment.sampledPoints && fragment.sampledPoints.length > 0) {
            for (let j = 0; j < fragment.sampledPoints.length; j++) {
              const point = fragment.sampledPoints[j]

              if (
                computePointToPointDistance(point, {
                  x: startNodeCoords[0],
                  y: startNodeCoords[1]
                }) < EPSILON_INTERSECT
              ) {
                foundStart = true
                startIndex = j
              }

              if (
                computePointToPointDistance(point, { x: endNodeCoords[0], y: endNodeCoords[1] }) <
                EPSILON_INTERSECT
              ) {
                foundEnd = true
                endIndex = j
              }
            }

            if (foundStart && foundEnd) {
              // Found both points on this fragment
              const isReversed = startIndex > endIndex
              orderedFragmentDetails.push({ id: fragment.id, reversed: isReversed })
              matched = true
              break
            }
          }
        }

        if (!matched) {
          console.warn(`Could not find fragment for edge from node ${nodeA} to ${nodeB}`)
        }
      }
    }

    return orderedFragmentDetails
  }

  function processFaceTree(tree: any, parentRegionId?: string) {
    if (tree.cycle && tree.cycle.length >= 3) {
      // Minimum 3 nodes for a valid face
      const regionId = `region-${regionIndex++}`
      const fragmentDetails = findFragmentIds(tree.cycle)

      // Combine adjacent segments from the same fragment
      const consolidatedDetails: Array<{ id: string; reversed: boolean }> = []

      for (let i = 0; i < fragmentDetails.length; i++) {
        const current = fragmentDetails[i]

        if (
          i === 0 ||
          current.id !== consolidatedDetails[consolidatedDetails.length - 1].id ||
          current.reversed !== consolidatedDetails[consolidatedDetails.length - 1].reversed
        ) {
          consolidatedDetails.push(current)
        }
      }

      const fragmentIds = consolidatedDetails.map((detail) => detail.id)
      const fragmentReversed = consolidatedDetails.map((detail) => detail.reversed)

      // Only create a region if we found fragments
      if (fragmentIds.length > 0) {
        const boundingBox = calculateBoundingBox(fragmentIds, fragmentMap)
        const testPoint = calculateTestPoint(fragmentIds, fragmentMap)

        const region: PathRegion = {
          id: regionId,
          fragmentIds,
          fragmentReversed,
          boundingBox,
          testPoint,
          isHole: !!parentRegionId,
          basicWindingNumber: 0,
          totalWindingNumber: 0,
          parentRegionId
        }

        regions.push(region)
      }

      // Process children with this as the parent
      if (tree.children && tree.children.length > 0) {
        for (const child of tree.children) {
          processFaceTree(child, regionId)
        }
      }
    }
    // Process children even if this face doesn't have a valid cycle
    else if (tree.children && tree.children.length > 0) {
      for (const child of tree.children) {
        processFaceTree(child, parentRegionId)
      }
    }
  }

  for (const rootFace of faceForest.forest) {
    processFaceTree(rootFace)
  }

  return regions
}
