import { SplitSegment } from './path_processor_v2'
import { EPS_INTERSECTION } from '../intersections/constants'
import { PlanarFaceTree } from 'planar-face-discovery'
import { newId } from '../utils/ids'

const EPS_SQUARED = EPS_INTERSECTION * EPS_INTERSECTION

type NodeCoordinate = [number, number] // Node given by its coordinates.
type Edge = [number, number] // Edge given by node indices.

type Graph = {
  nodes: NodeCoordinate[]
  edges: Edge[]
}

type Region = {
  id: string
  segments: SplitSegment[]
  parentId: string | null // Optional parent ID for hierarchical structure.
}

function findDuplicatePointIndex(point: NodeCoordinate, nodes: NodeCoordinate[]): number | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    // Use squared distance to avoid unnecessary square root calculations.
    if ((node[0] - point[0]) ** 2 + (node[1] - point[1]) ** 2 < EPS_SQUARED) {
      return i
    }
  }
  return null
}

export function getFaceRegions(segments: SplitSegment[]) {
  // Since our segment have been split already, we know that they don't overlap.
  // So we can just treat all of our segments as if they're lines...
  // Build a graph object. It needs a nodes array and an edges array.
  const graph: Graph = {
    nodes: [] as NodeCoordinate[],
    edges: [] as Edge[]
  }

  // We should store a map of node indices to segments.
  const nodeIndexToSegments: Map<number, SplitSegment[]> = new Map()

  // Iterate over all segments and add them to the graph.
  for (const segment of segments) {
    const start = [segment.geometry.start.x, segment.geometry.start.y] as NodeCoordinate
    const end = [segment.geometry.end.x, segment.geometry.end.y] as NodeCoordinate

    // Check if the points already exist in the graph.
    let iStart = findDuplicatePointIndex(start, graph.nodes)
    let iEnd = findDuplicatePointIndex(end, graph.nodes)

    // If the start point is new, add it to the graph.
    if (iStart === null) {
      graph.nodes.push(start)
      iStart = graph.nodes.length - 1
    }

    // If the end point is new, add it to the graph.
    if (iEnd === null) {
      graph.nodes.push(end)
      iEnd = graph.nodes.length - 1
    }

    // Add the edge connecting the start and end points.
    const edge: Edge = [iStart, iEnd]
    graph.edges.push(edge)

    // Map the node indices to the segment.
    nodeIndexToSegments.set(iStart, (nodeIndexToSegments.get(iStart) || []).concat(segment))
    nodeIndexToSegments.set(iEnd, (nodeIndexToSegments.get(iEnd) || []).concat(segment))
  }

  // Now we can run the planar face discovery algorithm on the graph.
  const solver = new PlanarFaceTree()
  const discoveryResult = solver.discover(graph.nodes, graph.edges)

  if (discoveryResult.type !== 'RESULT') {
    throw new Error('Face discovery failed')
  }

  // Now we need to relate each face to the segments that form it. We can recurse
  // down through the faces, give each an ID, and track its parents. Our objective
  // is to build a list of regions where each region is a list of segments that form it,
  // and that also tells you about its hierarchy.
  const regions: Region[] = []

  // Process the face tree and build regions.
  for (const rootFace of discoveryResult.forest) {
    processFaceTree(regions, null, rootFace, segments, nodeIndexToSegments, graph)
  }

  // Look at regions.
  let x = 1
}

function processFaceTree(
  regions: Region[],
  parentRegionId: string | null,
  tree: any,
  segments: SplitSegment[],
  nodeIndexToSegments: Map<number, SplitSegment[]>,
  graph: Graph
): void {
  // Changed return type since we're modifying regions in place
  if (tree.cycle && tree.cycle.length >= 3) {
    // Minimum 3 nodes for a valid face.
    const regionId = newId('region')

    // Create a new region for this face.
    const region: Region = {
      id: regionId,
      segments: [],
      parentId: parentRegionId
    }

    // Get candidate segments and find the cycle
    let faceNodeIds = [...tree.cycle]
    let candidateSegments: SplitSegment[][] = []

    for (const nodeId of faceNodeIds) {
      let localCandidateSegments = nodeIndexToSegments.get(nodeId)
      if (!localCandidateSegments) {
        throw new Error(`No segments found for node index ${nodeId}`)
      }
      candidateSegments.push(localCandidateSegments)
    }

    const cycleSegments = findCycleSegments(faceNodeIds, candidateSegments, graph)
    region.segments = cycleSegments
    regions.push(region)

    // Process children with THIS region as the parent
    if (tree.children && tree.children.length > 0) {
      for (const child of tree.children) {
        processFaceTree(regions, regionId, child, segments, nodeIndexToSegments, graph)
      }
    }
  }
  // Process children even if this face doesn't have a valid cycle.
  else if (tree.children && tree.children.length > 0) {
    for (const child of tree.children) {
      processFaceTree(regions, parentRegionId, child, segments, nodeIndexToSegments, graph)
    }
  }
  // No return statement needed since we're modifying regions in place.
}

function findCycleSegments(
  faceNodeIds: number[],
  candidateSegments: SplitSegment[][],
  graph: Graph
): SplitSegment[] {
  const cycleSegments: SplitSegment[] = []

  // Remove the duplicate last node if it exists (cycle closure).
  const cleanNodeIds =
    faceNodeIds[0] === faceNodeIds[faceNodeIds.length - 1] ? faceNodeIds.slice(0, -1) : faceNodeIds

  // For each consecutive pair of nodes in the cycle.
  for (let i = 0; i < cleanNodeIds.length; i++) {
    const currentNodeId = cleanNodeIds[i]
    const nextNodeId = cleanNodeIds[(i + 1) % cleanNodeIds.length]

    // Get the candidate segments for the current node.
    const candidates = candidateSegments[i]

    // Find the segment that connects currentNodeId to nextNodeId.
    const matchingSegment = candidates.find((segment) => {
      const startCoord = [segment.geometry.start.x, segment.geometry.start.y] as NodeCoordinate
      const endCoord = [segment.geometry.end.x, segment.geometry.end.y] as NodeCoordinate

      const startNodeId = findNodeIdByCoordinate(startCoord, graph.nodes)
      const endNodeId = findNodeIdByCoordinate(endCoord, graph.nodes)

      // Check if this segment connects the current node to the next node.
      return (
        (startNodeId === currentNodeId && endNodeId === nextNodeId) ||
        (startNodeId === nextNodeId && endNodeId === currentNodeId)
      )
    })

    if (!matchingSegment) {
      throw new Error(`No segment found connecting node ${currentNodeId} to node ${nextNodeId}`)
    }

    cycleSegments.push(matchingSegment)
  }

  return cycleSegments
}

function findNodeIdByCoordinate(coord: NodeCoordinate, nodes: NodeCoordinate[]): number | null {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if ((node[0] - coord[0]) ** 2 + (node[1] - coord[1]) ** 2 < EPS_SQUARED) {
      return i
    }
  }
  return null
}
