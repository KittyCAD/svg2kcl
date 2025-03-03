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
}

export function buildPlanarGraphFromFragments(fragments: PathFragment[]): PlanarGraph {
  // We'll store each unique node in 'nodes'.
  // Then we identify edges by node indices.
  const nodes: Array<[number, number]> = []

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

  for (const fragment of fragments) {
    const startId = getNodeId(fragment.start)
    const endId = getNodeId(fragment.end)

    // Store edge in a consistent (min, max) order.
    const a = Math.min(startId, endId)
    const b = Math.max(startId, endId)
    edgeSet.add(`${a},${b}`)
  }

  // Convert the Set of "a,b" strings into numeric pairs.
  const edges: Array<[number, number]> = Array.from(edgeSet, (str) => {
    const [a, b] = str.split(',').map(Number)
    return [a, b]
  })

  return { nodes, edges }
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
  const { nodes } = graph
  const regions: PathRegion[] = []
  let regionIndex = 0

  function findFragmentIds(cycle: number[]): Array<{ id: string; reversed: boolean }> {
    // Create an array to hold the matched fragment IDs in order and their reversed status
    const orderedFragmentDetails: Array<{ id: string; reversed: boolean }> = new Array(
      cycle.length - 1
    )

    for (let i = 0; i < cycle.length - 1; i++) {
      const startNode = nodes[cycle[i]]
      const endNode = nodes[cycle[i + 1]]
      let matched = false

      // Find the fragment that matches this edge
      for (const fragment of fragments) {
        // Check exact direction match first
        if (
          computePointToPointDistance(fragment.start, { x: startNode[0], y: startNode[1] }) <
            EPSILON_INTERSECT &&
          computePointToPointDistance(fragment.end, { x: endNode[0], y: endNode[1] }) <
            EPSILON_INTERSECT
        ) {
          orderedFragmentDetails[i] = { id: fragment.id, reversed: false }
          matched = true
          break
        }

        // Check reverse direction match
        if (
          computePointToPointDistance(fragment.start, { x: endNode[0], y: endNode[1] }) <
            EPSILON_INTERSECT &&
          computePointToPointDistance(fragment.end, { x: startNode[0], y: startNode[1] }) <
            EPSILON_INTERSECT
        ) {
          orderedFragmentDetails[i] = { id: fragment.id, reversed: true }
          matched = true
          break
        }
      }

      if (!matched) {
        console.warn(`Could not find fragment matching edge from ${startNode} to ${endNode}`)
      }
    }

    // Filter out any undefined entries
    return orderedFragmentDetails.filter((detail) => detail !== undefined)
  }

  function processFaceTree(tree: any, parentRegionId?: string) {
    if (tree.cycle && tree.cycle.length >= 1) {
      const regionId = `region-${regionIndex++}`
      const fragmentDetails = findFragmentIds(tree.cycle)
      const fragmentIds = fragmentDetails.map((detail) => detail.id)
      const fragmentReversed = fragmentDetails.map((detail) => detail.reversed)

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
