//
import { Point } from '../types/base'
import { PlanarGraph, SplitSegment, EdgeSegmentInfo } from './path_processor_v2'
import { computePointToPointDistance } from '../utils/geometry'
import { newId } from '../utils/ids'

export interface Vertex {
  id: string
  point: Point
  // IDs of all edges connected to this vertex.
  edgeIds: string[]
}

/**
 * An Edge connects two vertices and represents an original SplitSegment.
 * It retains the full analytical geometry of the segment.
 */
export interface Edge {
  id: string // Same as the sourceSegment's id
  startVertexId: string
  endVertexId: string
  // The original analytical segment this edge represents.
  sourceSegment: SplitSegment
}

/**
 * The complete topological representation of the path, containing all vertices and edges.
 * This structure is built *before* any flattening/sampling occurs.
 */
export interface TopologicalGraph {
  vertices: Map<string, Vertex>
  edges: Map<string, Edge>
}

// A helper to consistently get endpoints from any segment geometry
function getSegmentEndpoints(segment: SplitSegment): { start: Point; end: Point } {
  return {
    start: segment.geometry.start,
    end: segment.geometry.end
  }
}

/**
 * Builds a topological graph from a list of split analytical segments.
 *
 * This is the crucial step that V1 did with `connectFragments` but is now more robust.
 * It correctly establishes the graph's topology (vertices and their connections) *before*
 * any geometric flattening occurs.
 *
 * How it works:
 * 1. It iterates through every segment's start and end points.
 * 2. For each point, it checks if a 'close enough' vertex already exists using a spatial grid for efficiency.
 *    - The spatial grid groups vertices into cells, so we only need to check for proximity
 *      against a few other vertices instead of all of them.
 * 3. If a vertex exists, it reuses it. If not, it creates a new one. This is the "vertex merging" step.
 * 4. It creates an `Edge` for each `SplitSegment`, linking the corresponding start and end `Vertex` objects.
 * 5. It populates the `edgeIds` on each vertex to complete the graph's connectivity information.
 *
 * @param segments The list of analytical segments, split at all intersections.
 * @param epsilon The tolerance for considering two points to be the same vertex.
 * @returns A TopologicalGraph object.
 */
export function buildTopologicalGraph(segments: SplitSegment[], epsilon: number): TopologicalGraph {
  const vertices = new Map<string, Vertex>()
  const edges = new Map<string, Edge>()

  // --- Spatial Grid for Fast Vertex Lookup ---
  // This is a performance optimization. Instead of comparing a new point against
  // EVERY existing vertex (O(n)), we can put vertices into a grid. Then we only
  // need to check the grid cell the point falls into (and its neighbors).
  const gridCellSize = epsilon * 2 // A cell size slightly larger than epsilon is effective
  const vertexGrid = new Map<string, string[]>() // Key: "x_y", Value: vertexId[]

  const getGridKey = (point: Point): string => {
    const gridX = Math.floor(point.x / gridCellSize)
    const gridY = Math.floor(point.y / gridCellSize)
    return `${gridX}_${gridY}`
  }

  // Helper to Find or Create a Vertex for a Given Point ---
  const getOrCreateVertex = (point: Point): Vertex => {
    // 1. Check nearby cells in the grid for candidate vertices.
    const gridKey = getGridKey(point)
    const [baseX, baseY] = gridKey.split('_').map(Number)
    const candidateVertexIds: string[] = []

    // Check the 3x3 square of grid cells around the point's cell
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${baseX + dx}_${baseY + dy}`
        if (vertexGrid.has(key)) {
          candidateVertexIds.push(...vertexGrid.get(key)!)
        }
      }
    }

    // 2. Check actual distance for all candidates
    for (const vertexId of candidateVertexIds) {
      const vertex = vertices.get(vertexId)!
      if (computePointToPointDistance(vertex.point, point) < epsilon) {
        // Found an existing vertex within the tolerance
        return vertex
      }
    }

    // 3. No existing vertex found, so create a new one
    const newVertex: Vertex = {
      id: newId('vertex'),
      point: point,
      edgeIds: []
    }
    vertices.set(newVertex.id, newVertex)

    // And add it to our spatial grid for future lookups
    const newGridKey = getGridKey(point)
    if (!vertexGrid.has(newGridKey)) {
      vertexGrid.set(newGridKey, [])
    }
    vertexGrid.get(newGridKey)!.push(newVertex.id)

    return newVertex
  }

  // Main Loop: Build Edges and Vertices
  for (const segment of segments) {
    const { start: startPoint, end: endPoint } = getSegmentEndpoints(segment)

    // Get-or-create the vertices for the start and end of the segment
    const startVertex = getOrCreateVertex(startPoint)
    const endVertex = getOrCreateVertex(endPoint)

    // Ignore zero-length segments which can result from splitting
    if (startVertex.id === endVertex.id) {
      continue
    }

    // Create the edge that represents this segment
    const newEdge: Edge = {
      id: segment.id, // Use the segment's own ID for the edge ID
      startVertexId: startVertex.id,
      endVertexId: endVertex.id,
      sourceSegment: segment
    }
    edges.set(newEdge.id, newEdge)

    // Update the vertices to know about this new edge
    startVertex.edgeIds.push(newEdge.id)
    endVertex.edgeIds.push(newEdge.id)
  }

  return { vertices, edges }
}

export function buildGraphForLibrary(flattenedEdgeMap: Map<string, Point[]>): PlanarGraph {
  // Let's strongly type the return value

  const nodes: [number, number][] = []
  const pointKeyToIndex = new Map<string, number>()

  // This map now correctly stores EdgeSegmentInfo objects
  const edgeSegmentMap = new Map<string, EdgeSegmentInfo>()

  function getOrAddNode(point: Point): number {
    const key = `${point.x},${point.y}`
    if (pointKeyToIndex.has(key)) {
      return pointKeyToIndex.get(key)!
    }
    const index = nodes.length
    nodes.push([point.x, point.y])
    pointKeyToIndex.set(key, index)
    return index
  }

  const libraryEdges: [number, number][] = []

  for (const [edgeId, sampledPoints] of flattenedEdgeMap.entries()) {
    for (let i = 0; i < sampledPoints.length - 1; i++) {
      const p1 = sampledPoints[i]
      const p2 = sampledPoints[i + 1]
      const index1 = getOrAddNode(p1)
      const index2 = getOrAddNode(p2)

      if (index1 !== index2) {
        libraryEdges.push([index1, index2])

        const edgeKey = `${Math.min(index1, index2)},${Math.max(index1, index2)}`

        // Create the full EdgeSegmentInfo object instead of just a string.
        // We set `reversed` to false as a placeholder. The real direction
        // will be determined later when processing the face cycles.
        const segmentInfo: EdgeSegmentInfo = {
          segmentId: edgeId, // The original analytical edge ID
          isReversed: false // Placeholder value
        }

        edgeSegmentMap.set(edgeKey, segmentInfo)
      }
    }
  }

  return { nodes: nodes, edges: libraryEdges, edgeSegmentMap: edgeSegmentMap }
}
