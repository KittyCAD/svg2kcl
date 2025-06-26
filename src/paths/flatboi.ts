import { Segment, SplitSegment } from './path_processor_v2'
import { flattenSegment } from './segment_flattener'
import { EPS_INTERSECTION } from '../intersections/constants'
import { Point } from '../types/base'
import { DiscoveryResult, PlanarFaceTree } from 'planar-face-discovery'
import { Plotter } from '../intersections/plotter'

const EPS_FLATTEN = 0.001

type VertexMap = Map<string, number> // Grid key to vertex index mapping.
type Edge = [number, number] // Integer pairs representing edges by vertex index pair.

type SegmentGraph = {
  vertices: Point[] // Global unique pool of vertices.
  segmentVertices: Record<string, number[]> // Per-segment ordered indices.
  segmentEdges: Record<string, Edge[]> // Per-segment edges.
  originalSegments?: Record<string, Segment> // Optional, for debugging.
}

function computeQuantizedGridKey(p: Point): string {
  const quantFactor = 1 / EPS_INTERSECTION
  const x = Math.round(p.x * quantFactor)
  const y = Math.round(p.y * quantFactor)
  return `${x}:${y}`
}

function getOrCreateVertexIndex(vertices: Point[], vertexMap: VertexMap, p: Point): number {
  const key = computeQuantizedGridKey(p)
  const hit = vertexMap.get(key)
  if (hit !== undefined) return hit

  // If not found, add it to the map and the list.
  const index = vertices.length
  vertexMap.set(key, index)
  vertices.push(p)
  return index
}

function getFaces(nodes: Point[], edges: Edge[]): DiscoveryResult {
  // Convert nodes from Point to array.
  const nodeArray = nodes.map((p) => [p.x, p.y] as [number, number])

  const solver = new PlanarFaceTree()
  const faceForest = solver.discover(nodeArray, edges)
  if (faceForest.type === 'RESULT') {
    return faceForest
  } else {
    throw new Error('Face discovery failed')
  }
}

export function processSegments(segments: SplitSegment[]) {
  // Build a vertex graph from the segments.
  const result = buildVertexGraphFromSegments(segments)

  // Now we want to run planar face discovery, so we might need to merge some stuff.
  const allVertices = result.vertices
  const allEdges = Object.values(result.segmentEdges).flat()
  const faces = getFaces(allVertices, allEdges)

  // Plot these, one at a time.
  plotFaces(faces, allVertices, allEdges, 'faces.png')

  let x = 1
}

export function buildVertexGraphFromSegments(segments: SplitSegment[]): SegmentGraph {
  // We want to get to the position where each segment can be represented
  // by a unique list of n vertices, with n-1 edges joining them.
  const vertices: Point[] = [] // A list of unique vertices.
  const vertexMap: VertexMap = new Map() // Maps quantized grid keys to vertex indices.

  // Then, we want to quantize all flattened segments to a grid.
  // Each segment will be represented by a list of vertex indices, with edges
  // being pairs of indices.
  const segmentVertices: Record<string, number[]> = {}
  const segmentEdges: Record<string, Edge[]> = {}

  for (const segment of segments) {
    // Flatten the segment into straight lines.
    const flattened = flattenSegment(segment, EPS_FLATTEN)

    // Get the vertices for each point.
    const segmentVerticesList: number[] = []
    const segmentEdgesList: Edge[] = []
    let lastIdx: number | null = null

    for (const chord of flattened) {
      const { start, end } = chord.geometry

      // First chord: create both start & end vertices..
      const iStart = lastIdx ?? getOrCreateVertexIndex(vertices, vertexMap, start)
      const iEnd = getOrCreateVertexIndex(vertices, vertexMap, end)

      // Append new vertex only if it differs from last.
      if (lastIdx === null) segmentVerticesList.push(iStart)
      segmentVerticesList.push(iEnd)

      // Emit an edge.
      segmentEdgesList.push([iStart, iEnd] as [number, number])
      lastIdx = iEnd
    }

    // Store the segment vertices and edges.
    const segmentId = segment.id
    segmentVertices[segmentId] = segmentVerticesList
    segmentEdges[segmentId] = segmentEdgesList
  }

  return {
    vertices,
    segmentVertices,
    segmentEdges
  }
}

interface FaceNode {
  cycle: number[]
  children: FaceNode[]
}

function plotFaces(
  faces: DiscoveryResult,
  allVertices: Point[],
  allEdges: Edge[],
  filename = 'faces.png'
): void {
  if (faces.type !== 'RESULT' || !faces.forest || faces.forest.length === 0) {
    console.log('No faces to plot')
    return
  }

  // Calculate bounds from all vertices
  const bounds = calculateBounds(allVertices)

  // Create plotter with appropriate bounds
  const plotter = new Plotter()

  // Plot all vertices and edges first.
  plotter.clear()
  plotter.setBounds(bounds.xMin, bounds.yMin, bounds.xMax, bounds.yMax)
  plotAllVertices(allVertices, 'black', plotter, 'faces_vertices.png')

  plotter.clear()
  plotter.setBounds(bounds.xMin, bounds.yMin, bounds.xMax, bounds.yMax)
  plotAllEdges(allEdges, allVertices, 'red', plotter, 'faces_edges.png')

  // Plot faces.
  plotter.clear()
  plotter.setBounds(bounds.xMin, bounds.yMin, bounds.xMax, bounds.yMax)

  // Define colors for different levels
  const colors = [
    'blue', // Level 0 (root cycles)
    'red', // Level 1
    'green', // Level 2
    'purple', // Level 3
    'orange', // Level 4
    'brown', // Level 5
    'pink' // Level 6+
  ]

  let totalFaces = 0

  // Recursively plot each face tree in the forest
  faces.forest.forEach((rootFace, forestIndex) => {
    totalFaces += plotFaceRecursive(
      rootFace,
      allVertices,
      plotter,
      colors,
      0, // depth level
      forestIndex,
      filename
    )
  })

  // Add title with face count
  plotter.addTitle(`Faces Discovered: ${totalFaces}`)

  // Save the plot
  plotter.save(filename)
}

function plotAllVertices(
  allVertices: Point[],
  color: string,
  plotter: Plotter,
  filename: string
): void {
  allVertices.forEach((vertex) => {
    plotter.plotPoint(vertex, color, 1)
  })

  plotter.save(filename)
}

function plotAllEdges(
  allEdges: Edge[],
  allVertices: Point[],
  color: string,
  plotter: Plotter,
  filename: string
): void {
  allEdges.forEach((edge) => {
    const startVertex = allVertices[edge[0]]
    const endVertex = allVertices[edge[1]]
    plotter.plotLine({ start: startVertex, end: endVertex }, color, 1)
  })

  plotter.save(filename)
}

function plotFaceRecursive(
  face: FaceNode,
  allVertices: Point[],
  plotter: Plotter,
  colors: string[],
  depth: number,
  faceIndex: number,
  filename: string
): number {
  let faceCount = 0

  // Plot the current face's cycle if it has vertices
  if (face.cycle && face.cycle.length > 0) {
    const color = colors[Math.min(depth, colors.length - 1)]
    const lineWidth = 1

    plotCycle(face.cycle, allVertices, plotter, color, lineWidth)
    plotter.save(filename)
    faceCount++
  }

  // Recursively plot children
  if (face.children && face.children.length > 0) {
    face.children.forEach((child, childIndex) => {
      faceCount += plotFaceRecursive(
        child,
        allVertices,
        plotter,
        colors,
        depth + 1,
        childIndex,
        filename
      )
    })
  }

  return faceCount
}

function plotCycle(
  cycle: number[],
  allVertices: Point[],
  plotter: Plotter,
  color: string,
  lineWidth: number,
  label?: string
): void {
  if (cycle.length < 2) return

  // Plot edges of the cycle
  for (let i = 0; i < cycle.length; i++) {
    const currentVertexIndex = cycle[i]
    const nextVertexIndex = cycle[(i + 1) % cycle.length] // Wrap around to close the cycle

    // Validate vertex indices
    if (currentVertexIndex >= allVertices.length || nextVertexIndex >= allVertices.length) {
      console.warn(`Invalid vertex index in cycle: ${currentVertexIndex} or ${nextVertexIndex}`)
      continue
    }

    const start = allVertices[currentVertexIndex]
    const end = allVertices[nextVertexIndex]

    // Create a line object for the plotter
    const line = { start, end }
    plotter.plotLine(line, color, lineWidth)
  }

  // Optionally plot vertices of the cycle
  cycle.forEach((vertexIndex, i) => {
    if (vertexIndex < allVertices.length) {
      const vertex = allVertices[vertexIndex]
      plotter.plotPoint(vertex, color, 2) // Small points for vertices
    }
  })

  // Add label at the first vertex if provided
  if (label && cycle.length > 0 && cycle[0] < allVertices.length) {
    const firstVertex = allVertices[cycle[0]]
    plotter.plotPoint(firstVertex, color, 3, label)
  }
}

function calculateBounds(vertices: Point[]): {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
} {
  if (vertices.length === 0) {
    return { xMin: 0, yMin: 0, xMax: 10, yMax: 10 }
  }

  let xMin = vertices[0].x
  let xMax = vertices[0].x
  let yMin = vertices[0].y
  let yMax = vertices[0].y

  vertices.forEach((vertex) => {
    xMin = Math.min(xMin, vertex.x)
    xMax = Math.max(xMax, vertex.x)
    yMin = Math.min(yMin, vertex.y)
    yMax = Math.max(yMax, vertex.y)
  })

  // Add some padding
  const paddingX = (xMax - xMin) * 0.1
  const paddingY = (yMax - yMin) * 0.1

  return {
    xMin: xMin - paddingX,
    yMin: yMin - paddingY,
    xMax: xMax + paddingX,
    yMax: yMax + paddingY
  }
}

export { plotFaces }
