import { Segment, SplitSegment } from './path_processor_v2'
import { flattenSegment } from './segment_flattener'
import { EPS_INTERSECTION } from '../intersections/constants'
import { Point } from '../types/base'
import { CycleTree, DiscoveryResult, PlanarFaceTree } from 'planar-face-discovery'
import { Plotter } from '../intersections/plotter'
import { SegmentIntersection } from './path_processor_v2'

const EPS_FLATTEN = 0.001
const QUANTIZATION_FACTOR = 1 / EPS_INTERSECTION

type VertexMap = Map<string, number> // Grid key to vertex index mapping.
type Edge = [number, number] // Integer pairs representing edges by vertex index pair.

type SegmentGraph = {
  vertices: Point[] // Global unique pool of vertices.
  segmentVertices: Record<string, number[]> // Per-segment ordered indices.
  segmentEdges: Record<string, Edge[]> // Per-segment edges.
  originalSegments?: Record<string, Segment> // Optional, for debugging.
}

interface QuantizedResult {
  key: string
  point: Point // The new, snapped point
}

export function computeQuantizedPointAndKey(p: Point): QuantizedResult {
  const qx = Math.round(p.x * QUANTIZATION_FACTOR)
  const qy = Math.round(p.y * QUANTIZATION_FACTOR)

  const key = `${qx}:${qy}`

  // The snapped point has its coordinates derived from the quantized integers.
  const snappedPoint: Point = {
    x: qx / QUANTIZATION_FACTOR,
    y: qy / QUANTIZATION_FACTOR
  }

  return { key, point: snappedPoint }
}

function getOrCreateVertexIndex(vertices: Point[], vertexMap: VertexMap, p: Point): number {
  const { key, point: quantizedPoint } = computeQuantizedPointAndKey(p)
  const hit = vertexMap.get(key)
  if (hit !== undefined) return hit

  // If not found, add it to the map and the list.
  const index = vertices.length
  vertexMap.set(key, index)
  vertices.push(quantizedPoint)
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

function arrayContainsSubarray<T>(arr: T[], sub: T[]): boolean {
  if (sub.length === 0) return true
  if (sub.length > arr.length) return false

  for (let i = 0; i <= arr.length - sub.length; i++) {
    if (sub.every((val, j) => arr[i + j] === val)) {
      return true
    }
  }
  return false
}

export function processSegments(segments: SplitSegment[], intersections: SegmentIntersection[]) {
  const result = buildVertexGraph(segments, intersections)

  const allVertices = result.vertices
  const directedEdges = Object.values(result.segmentEdges).flat()

  const allEdges = createUndirectedEdgeSet(directedEdges)

  // Now run the debug checks and face finding on the corrected, undirected edge list.
  verifyNoIntersections(allVertices, allEdges)

  const faces = getFaces(allVertices, allEdges)

  plotFaces(faces, allVertices, allEdges, 'faces.png')

  // Now we need to establish the geometric segments that correspond to each face.
  const faceSegments: Segment[][] = []

  function getSegmentsForFace(
    face: CycleTree,
    segmentVertices: Record<string, number[]>,
    segments: Segment[],
    faceSegments: Segment[][]
  ): Segment[][] {
    if (face.cycle.length > 0) {
      const cycleSegmentIDs = []
      // Find which segments correspond to this cycle.
      // Loop over segment vertex sets and see if these occur in the cycle.
      for (const [segmentID, vertices] of Object.entries(segmentVertices)) {
        // Check if this vertex set exists _forward_ in the cycle.
        if (arrayContainsSubarray(face.cycle, vertices)) {
          // We found a matching segment for this face cycle.
          cycleSegmentIDs.push(segmentID)
        }

        // Check if this vertex set exists _backward_ in the cycle.
        const reversedVertices = [...vertices].reverse()
        if (arrayContainsSubarray(face.cycle, reversedVertices)) {
          // We found a matching segment for this face cycle in reverse.
          cycleSegmentIDs.push(segmentID)
        }
      }

      // Actual segments for our IDs.
      const cycleSegments = []
      for (const segmentID of cycleSegmentIDs) {
        const segment = segments.find((s) => s.id === segmentID)
        if (segment) {
          cycleSegments.push(segment)
        } else {
          console.warn(`Segment ID ${segmentID} not found in segments list`)
        }
      }

      // Push the segments that correspond to this face cycle.
      faceSegments.push(cycleSegments)
    }

    for (const child of face.children) {
      // Recursively process children.
      getSegmentsForFace(child, segmentVertices, segments, faceSegments)
    }

    return faceSegments
  }

  if (faces) {
    for (const face of faces.forest) {
      // Each face is a cycle of vertex indices.
      // We need to find the segments that correspond to this cycle.
      // The segments are defined by their vertex indices in segmentVertices.
      // We will create a Segment for each face cycle.

      // Get segments for this face
      getSegmentsForFace(face, result.segmentVertices, segments, faceSegments)
    }
  }

  // Now we should have actual segments for each face.
  let x = 1
}

function findMidpointIntersection(p1: Point, q1: Point, p2: Point, q2: Point): Point | null {
  const a1 = q1.y - p1.y
  const b1 = p1.x - q1.x
  const c1 = a1 * p1.x + b1 * p1.y

  const a2 = q2.y - p2.y
  const b2 = p2.x - q2.x
  const c2 = a2 * p2.x + b2 * p2.y

  const determinant = a1 * b2 - a2 * b1

  if (Math.abs(determinant) < 1e-9) {
    // Lines are parallel, no intersection for our purposes
    return null
  }

  const x = (b2 * c1 - b1 * c2) / determinant
  const y = (a1 * c2 - a2 * c1) / determinant

  const intersectionPoint = { x, y }

  // Check if the intersection point lies on both segments
  const onSegment1 =
    Math.min(p1.x, q1.x) < x + 1e-9 &&
    x - 1e-9 < Math.max(p1.x, q1.x) &&
    Math.min(p1.y, q1.y) < y + 1e-9 &&
    y - 1e-9 < Math.max(p1.y, q1.y)

  const onSegment2 =
    Math.min(p2.x, q2.x) < x + 1e-9 &&
    x - 1e-9 < Math.max(p2.x, q2.x) &&
    Math.min(p2.y, q2.y) < y + 1e-9 &&
    y - 1e-9 < Math.max(p2.y, q2.y)

  if (onSegment1 && onSegment2) {
    return intersectionPoint
  }

  return null
}

function verifyNoIntersections(vertices: Point[], edges: Edge[], plotter?: Plotter): void {
  console.log(`\n--- Running Planarity Check (Edge Intersections) ---`)
  let illegalIntersections = 0

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const edge1 = edges[i] // [v1_idx, v2_idx]
      const edge2 = edges[j] // [v3_idx, v4_idx]

      // Check if edges share a vertex. If so, they can't illegally intersect.
      if (
        edge1[0] === edge2[0] ||
        edge1[0] === edge2[1] ||
        edge1[1] === edge2[0] ||
        edge1[1] === edge2[1]
      ) {
        continue
      }

      const p1 = vertices[edge1[0]]
      const q1 = vertices[edge1[1]]
      const p2 = vertices[edge2[0]]
      const q2 = vertices[edge2[1]]

      const intersection = findMidpointIntersection(p1, q1, p2, q2)

      if (intersection) {
        illegalIntersections++
        console.error(
          `PLANARITY VIOLATION: Edge [${edge1[0]}, ${edge1[1]}] intersects Edge [${edge2[0]}, ${edge2[1]}]`
        )
        console.warn(
          `  - Intersection at: (${intersection.x.toFixed(3)}, ${intersection.y.toFixed(3)})`
        )

        // Optional: If you pass in your plotter, it will draw the problem
        if (plotter) {
          plotter.plotPoint(intersection, 'magenta', 10)
          plotter.plotLine({ start: p1, end: q1 }, 'magenta', 2)
          plotter.plotLine({ start: p2, end: q2 }, 'magenta', 2)
        }
      }
    }
  }

  if (illegalIntersections === 0) {
    console.log('OK: Graph is planar. No illegal edge intersections found.')
  } else {
    console.error(
      `\nFATAL: Found ${illegalIntersections} illegal edge intersection(s). The graph is not planar.`
    )
    if (plotter) {
      console.log(
        "Saving debug plot with intersections highlighted in magenta to 'faces_intersections_debug.png'"
      )
      plotter.save('faces_intersections_debug.png')
    }
  }
}

function createUndirectedEdgeSet(edges: Edge[]): Edge[] {
  const uniqueEdgeKeys = new Set<string>()
  const undirectedEdges: Edge[] = []

  for (const edge of edges) {
    // Normalize the edge so [A, B] and [B, A] produce the same key.
    const key = edge[0] < edge[1] ? `${edge[0]}-${edge[1]}` : `${edge[1]}-${edge[0]}`

    if (!uniqueEdgeKeys.has(key)) {
      uniqueEdgeKeys.add(key)
      undirectedEdges.push(edge) // Add the original edge just once
    }
  }

  return undirectedEdges
}

export function buildVertexGraph(
  segments: SplitSegment[],
  intersections: SegmentIntersection[]
): SegmentGraph {
  const vertices: Point[] = []
  const vertexMap: VertexMap = new Map()
  const segmentVertices: Record<string, number[]> = {}
  const segmentEdges: Record<string, Edge[]> = {}

  // --- Step 1: Create authoritative vertices for all KNOWN intersections ---
  const authoritativeIntersectionIndexMap = new Map<string, number>()

  for (const int of intersections) {
    const { point: intersectionPoint } = int.intersection
    const { key, point: quantizedPoint } = computeQuantizedPointAndKey(intersectionPoint)

    if (!authoritativeIntersectionIndexMap.has(key)) {
      const index = vertices.length
      vertices.push(quantizedPoint)
      vertexMap.set(key, index)
      authoritativeIntersectionIndexMap.set(key, index)
    }
  }

  // --- Step 2: Pre-quantize all segment endpoints to ensure connectivity ---
  const quantizedSegments = segments.map((segment) => {
    const quantizedStart = computeQuantizedPointAndKey(segment.geometry.start)
    const quantizedEnd = computeQuantizedPointAndKey(segment.geometry.end)

    return {
      segment: segment,
      quantizedStart: quantizedStart.point,
      quantizedEnd: quantizedEnd.point,
      startKey: quantizedStart.key,
      endKey: quantizedEnd.key
    }
  })

  // --- Step 3: Process each segment with forced endpoint connectivity ---
  for (const segmentData of quantizedSegments) {
    const { segment, quantizedStart, quantizedEnd, startKey, endKey } = segmentData

    const segmentVerticesList: number[] = []
    const segmentEdgesList: Edge[] = []

    // --- Get or create START vertex ---
    let startIdx: number
    if (authoritativeIntersectionIndexMap.has(startKey)) {
      startIdx = authoritativeIntersectionIndexMap.get(startKey)!
    } else {
      startIdx = getOrCreateVertexIndex(vertices, vertexMap, quantizedStart)
    }

    // --- Get or create END vertex ---
    let endIdx: number
    if (authoritativeIntersectionIndexMap.has(endKey)) {
      endIdx = authoritativeIntersectionIndexMap.get(endKey)!
    } else {
      endIdx = getOrCreateVertexIndex(vertices, vertexMap, quantizedEnd)
    }

    // --- Check if this is effectively a zero-length segment ---
    if (startIdx === endIdx) {
      // Degenerate segment, skip it but still record it
      segmentVertices[segment.id] = [startIdx]
      segmentEdges[segment.id] = []
      continue
    }

    // --- Determine if we need to flatten or can use direct connection ---
    const directDistance = Math.sqrt(
      Math.pow(quantizedEnd.x - quantizedStart.x, 2) +
        Math.pow(quantizedEnd.y - quantizedStart.y, 2)
    )

    // For very short segments just create a direct edge
    if (directDistance < EPS_FLATTEN * 3) {
      segmentVerticesList.push(startIdx, endIdx)
      segmentEdgesList.push([startIdx, endIdx])
    } else {
      // --- Flatten the curve but force endpoints to match quantized positions ---
      const flattened = flattenSegment(segment, EPS_FLATTEN)

      if (flattened.length === 0) {
        // Fallback to direct connection
        segmentVerticesList.push(startIdx, endIdx)
        segmentEdgesList.push([startIdx, endIdx])
        continue
      }

      // Force the flattened polyline to start and end at the quantized points
      const adjustedFlattened = [...flattened]

      // Adjust first segment start
      if (adjustedFlattened.length > 0) {
        adjustedFlattened[0] = {
          ...adjustedFlattened[0],
          geometry: {
            ...adjustedFlattened[0].geometry,
            start: quantizedStart
          }
        }
      }

      // Adjust last segment end
      if (adjustedFlattened.length > 0) {
        const lastIndex = adjustedFlattened.length - 1
        adjustedFlattened[lastIndex] = {
          ...adjustedFlattened[lastIndex],
          geometry: {
            ...adjustedFlattened[lastIndex].geometry,
            end: quantizedEnd
          }
        }
      }

      // --- Process the adjusted flattened segments with full quantization ---
      let currentIdx = startIdx
      segmentVerticesList.push(currentIdx)

      for (let i = 0; i < adjustedFlattened.length; i++) {
        const flatSegment = adjustedFlattened[i]
        let nextIdx: number

        if (i === adjustedFlattened.length - 1) {
          // Last segment must end at the quantized end point
          nextIdx = endIdx
        } else {
          // CRITICAL: Quantize ALL intermediate points too
          const { point: quantizedIntermediatePoint } = computeQuantizedPointAndKey(
            flatSegment.geometry.end
          )
          nextIdx = getOrCreateVertexIndex(vertices, vertexMap, quantizedIntermediatePoint)
        }

        // Only add edge if we're actually moving to a different vertex
        if (nextIdx !== currentIdx) {
          segmentEdgesList.push([currentIdx, nextIdx])
          segmentVerticesList.push(nextIdx)
          currentIdx = nextIdx
        }
      }

      // Ensure we end at the correct vertex (safety check)
      if (currentIdx !== endIdx) {
        segmentEdgesList.push([currentIdx, endIdx])
        if (!segmentVerticesList.includes(endIdx)) {
          segmentVerticesList.push(endIdx)
        }
      }
    }

    segmentVertices[segment.id] = segmentVerticesList
    segmentEdges[segment.id] = segmentEdgesList
  }

  return { vertices, segmentVertices, segmentEdges }
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
  const colors = ['blue', 'red', 'green', 'purple', 'orange', 'brown', 'pink', 'black', 'gray']

  let totalFaces = 0

  // Recursively plot each face tree in the forest
  faces.forest.forEach((rootFace) => {
    totalFaces += plotFaceRecursive(rootFace, allVertices, plotter, colors, filename)
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
  filename: string,
  faceCount: number = 0 // Add faceCount as a parameter with a default value
): number {
  let currentFaceCount = faceCount // Use a local variable to track the current face count

  // Plot the current face's cycle if it has vertices
  if (face.cycle && face.cycle.length > 0) {
    const colorIndex = currentFaceCount % colors.length
    const color = colors[colorIndex]
    const lineWidth = 1

    plotCycle(face.cycle, allVertices, plotter, color, lineWidth)
    plotter.save(filename)
    currentFaceCount++ // Increment the local face count
  }

  // Recursively plot children
  if (face.children && face.children.length > 0) {
    face.children.forEach((child, childIndex) => {
      currentFaceCount = plotFaceRecursive(
        child,
        allVertices,
        plotter,
        colors,
        filename,
        currentFaceCount // Pass the updated faceCount to the child
      )
    })
  }

  return currentFaceCount // Return the updated face count
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
    // plotter.plotLine(line, color, lineWidth)
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
