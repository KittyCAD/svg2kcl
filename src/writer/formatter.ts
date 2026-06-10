import {
  ArcParams,
  BezierCurveParams,
  CircleParams,
  KclOperation,
  KclOperationType,
  KclOptions,
  KclOutput,
  KclShape,
  LineToParams,
  StartSketchOnParams,
  StartSketchParams,
  TangentialArcParams
} from '../types/kcl'

export class FormatterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatterError'
  }
}

type Point2d = [number, number]

type PointRef = {
  name: string
  point: Point2d
}

type SegmentRef = {
  allowTangentConstraints: boolean
  endAnchor?: string
  endPointRef: string
  endTangentSketch: Point2d
  kind: 'arc' | 'line' | 'spline'
  name: string
  pathEnd: Point2d
  pathStart: Point2d
  samplePoints: Point2d[]
  startAnchor?: string
  startPointRef: string
  startTangentSketch: Point2d
}

type RegionRef = {
  name: string
  point: Point2d
}

type NativeArc = {
  center: Point2d
  isCounterClockwise: boolean
  midpoint: Point2d
  pathEnd: Point2d
  pathStart: Point2d
}

type SketchState = {
  currentPoint: Point2d | null
  currentPointRef: PointRef | null
  currentLoopPoints: Point2d[]
  currentLoopRegionSafe: boolean
  coincidentConstraintKeys: Set<string>
  endpointRefs: PointRef[]
  firstSegment: SegmentRef | null
  lastSegment: SegmentRef | null
  pointCounter: number
  pointRefs: Map<string, string>
  regionCounter: number
  regions: RegionRef[]
  segments: SegmentRef[]
  segmentCounter: number
}

const INVERT_Y = true
const ENDPOINT_SNAP_TOLERANCE = 0.15
const POINT_ON_LINE_TOLERANCE = 0.25
const POINT_ON_LINE_ENDPOINT_MARGIN = 0.02

export class Formatter {
  private readonly emitRegions: boolean
  private usesExperimentalSpline = false

  constructor(options: KclOptions = {}) {
    this.emitRegions = options.emitRegions ?? true
  }

  private formatNumber(value: number): string {
    return `${Number(value.toFixed(3))}`
  }

  private toSketchPoint(point: Point2d): Point2d {
    const scalar = INVERT_Y ? -1 : 1
    return [point[0], scalar * point[1]]
  }

  private formatPoint(point: Point2d): string {
    const [x, y] = this.toSketchPoint(point)
    return `[${this.formatNumber(x)}, ${this.formatNumber(y)}]`
  }

  private formatVarPoint(point: Point2d): string {
    const [x, y] = this.toSketchPoint(point)
    return `[var ${this.formatNumber(x)}, var ${this.formatNumber(y)}]`
  }

  private isStartSketchParams(params: unknown): params is StartSketchParams {
    return !!params && typeof params === 'object' && 'point' in params
  }

  private isStartSketchOnParams(params: unknown): params is StartSketchOnParams {
    return !!params && typeof params === 'object' && 'plane' in params
  }

  private isLineToParams(params: unknown): params is LineToParams {
    return !!params && typeof params === 'object' && 'point' in params
  }

  private isBezierCurveParams(params: unknown): params is BezierCurveParams {
    return (
      !!params &&
      typeof params === 'object' &&
      'control1' in params &&
      'control2' in params &&
      'end' in params
    )
  }

  private isCircleParams(params: unknown): params is CircleParams {
    return !!params && typeof params === 'object' && 'radius' in params && 'x' in params
  }

  private isArcParams(params: unknown): params is ArcParams {
    return !!params && typeof params === 'object' && 'radius' in params && 'angle' in params
  }

  private isTangentialArcParams(params: unknown): params is TangentialArcParams {
    return !!params && typeof params === 'object' && 'radius' in params && 'angle' in params
  }

  private addPoints(pointA: Point2d, pointB: Point2d): Point2d {
    return [pointA[0] + pointB[0], pointA[1] + pointB[1]]
  }

  private subtractPoints(pointA: Point2d, pointB: Point2d): Point2d {
    return [pointA[0] - pointB[0], pointA[1] - pointB[1]]
  }

  private dot(pointA: Point2d, pointB: Point2d): number {
    return pointA[0] * pointB[0] + pointA[1] * pointB[1]
  }

  private cross(pointA: Point2d, pointB: Point2d): number {
    return pointA[0] * pointB[1] - pointA[1] * pointB[0]
  }

  private length(vector: Point2d): number {
    return Math.hypot(vector[0], vector[1])
  }

  private isNearlyZero(value: number): boolean {
    return Math.abs(value) < 1e-6
  }

  private getLineIntersection(
    pointA: Point2d,
    directionA: Point2d,
    pointB: Point2d,
    directionB: Point2d
  ): Point2d | null {
    const denominator = this.cross(directionA, directionB)
    if (Math.abs(denominator) < 1e-9) {
      return null
    }

    const delta = this.subtractPoints(pointB, pointA)
    const t = this.cross(delta, directionB) / denominator
    return [pointA[0] + t * directionA[0], pointA[1] + t * directionA[1]]
  }

  private rotateVector(vector: Point2d, angleRadians: number): Point2d {
    const [x, y] = vector
    const cos = Math.cos(angleRadians)
    const sin = Math.sin(angleRadians)
    return [x * cos - y * sin, x * sin + y * cos]
  }

  private normalizeVector(vector: Point2d): Point2d {
    const length = Math.hypot(vector[0], vector[1])
    if (length === 0) {
      throw new FormatterError('Cannot normalize a zero-length vector')
    }
    return [vector[0] / length, vector[1] / length]
  }

  private nextSegmentName(state: SketchState): string {
    state.segmentCounter += 1
    return `seg${String(state.segmentCounter).padStart(3, '0')}`
  }

  private nextPointName(state: SketchState): string {
    state.pointCounter += 1
    return `pt${String(state.pointCounter).padStart(3, '0')}`
  }

  private getPointKey(point: Point2d): string {
    const sketchPoint = this.toSketchPoint(point)
    return `${this.formatNumber(sketchPoint[0])},${this.formatNumber(sketchPoint[1])}`
  }

  private definePointRef(
    state: SketchState,
    point: Point2d,
    lines: string[],
    reuseExisting = true
  ): string {
    const key = this.getPointKey(point)
    const existing = state.pointRefs.get(key)
    if (reuseExisting && existing) {
      return existing
    }

    const name = this.nextPointName(state)
    lines.push(`${name} = ${this.formatVarPoint(point)}`)
    if (reuseExisting) {
      state.pointRefs.set(key, name)
    }
    return name
  }

  private defineEndpointRef(state: SketchState, point: Point2d, lines: string[]): PointRef {
    for (const existing of state.endpointRefs) {
      if (Math.hypot(existing.point[0] - point[0], existing.point[1] - point[1]) <= ENDPOINT_SNAP_TOLERANCE) {
        return existing
      }
    }

    const pointRef: PointRef = {
      name: this.nextPointName(state),
      point
    }
    lines.push(`${pointRef.name} = ${this.formatVarPoint(pointRef.point)}`)
    state.endpointRefs.push(pointRef)
    return pointRef
  }

  private getSegmentStartPointRef(state: SketchState, point: Point2d, lines: string[]): PointRef {
    if (state.currentPointRef) {
      return state.currentPointRef
    }

    return this.defineEndpointRef(state, point, lines)
  }

  private nextRegionName(state: SketchState): string {
    state.regionCounter += 1
    return `region${String(state.regionCounter).padStart(3, '0')}`
  }

  private resetPathState(state: SketchState): void {
    state.currentPoint = null
    state.currentPointRef = null
    state.currentLoopPoints = []
    state.currentLoopRegionSafe = true
    state.firstSegment = null
    state.lastSegment = null
  }

  private appendSegment(state: SketchState, segment: SegmentRef, lines: string[]): void {
    if (state.lastSegment?.endAnchor && segment.startAnchor) {
      this.emitCoincident(state, lines, state.lastSegment.endAnchor, segment.startAnchor)
      if (this.shouldConstrainTangent(state.lastSegment, segment)) {
        lines.push(`tangent([${state.lastSegment.name}, ${segment.name}])`)
      }
    } else if (!state.lastSegment) {
      state.firstSegment = segment
    }

    state.lastSegment = segment
    state.currentPoint = segment.pathEnd
    state.currentPointRef = {
      name: segment.endPointRef,
      point: segment.pathEnd
    }
    state.segments.push(segment)

    if (state.currentLoopPoints.length === 0) {
      state.currentLoopPoints.push(segment.pathStart)
    }
    state.currentLoopPoints.push(...segment.samplePoints.slice(1))
  }

  private emitCoincident(
    state: SketchState,
    lines: string[],
    anchorA: string,
    anchorB: string
  ): void {
    if (anchorA === anchorB) {
      return
    }

    const key = [anchorA, anchorB].sort().join('|')
    if (state.coincidentConstraintKeys.has(key)) {
      return
    }

    lines.push(`coincident([${anchorA}, ${anchorB}])`)
    state.coincidentConstraintKeys.add(key)
  }

  private shouldConstrainTangent(previous: SegmentRef, next: SegmentRef): boolean {
    if (!previous.allowTangentConstraints || !next.allowTangentConstraints) {
      return false
    }

    if (previous.kind === 'spline' || next.kind === 'spline') {
      return false
    }

    if (previous.kind === 'line' && next.kind === 'line') {
      return false
    }

    const previousLength = this.length(previous.endTangentSketch)
    const nextLength = this.length(next.startTangentSketch)
    if (previousLength < 1e-6 || nextLength < 1e-6) {
      return false
    }

    const cross = this.cross(previous.endTangentSketch, next.startTangentSketch)
    const dot = this.dot(previous.endTangentSketch, next.startTangentSketch)
    return Math.abs(cross) / (previousLength * nextLength) < 1e-4 && dot > 0
  }

  private getRegionPoint(points: Point2d[]): Point2d {
    const uniquePoints = points.filter((point, index) => {
      const previous = points[index - 1]
      return !previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-6
    })

    if (uniquePoints.length === 0) {
      return [0, 0]
    }

    let twiceArea = 0
    let centroidX = 0
    let centroidY = 0

    for (let i = 0; i < uniquePoints.length; i++) {
      const current = uniquePoints[i]
      const next = uniquePoints[(i + 1) % uniquePoints.length]
      const cross = current[0] * next[1] - next[0] * current[1]
      twiceArea += cross
      centroidX += (current[0] + next[0]) * cross
      centroidY += (current[1] + next[1]) * cross
    }

    if (Math.abs(twiceArea) > 1e-6) {
      const centroid: Point2d = [centroidX / (3 * twiceArea), centroidY / (3 * twiceArea)]
      if (this.isPointInsidePolygon(centroid, uniquePoints)) {
        return centroid
      }

      const edgeCandidate = this.getInteriorEdgePoint(uniquePoints, centroid)
      if (edgeCandidate) {
        return edgeCandidate
      }
      return centroid
    }

    const sum = uniquePoints.reduce(
      (accumulator, point) => {
        return [accumulator[0] + point[0], accumulator[1] + point[1]] as Point2d
      },
      [0, 0] as Point2d
    )
    return [sum[0] / uniquePoints.length, sum[1] / uniquePoints.length]
  }

  private getInteriorEdgePoint(points: Point2d[], centroid: Point2d): Point2d | null {
    const insetFractions = [0.01, 0.03, 0.05, 0.1, 0.2, 0.5]

    for (let index = 0; index < points.length; index++) {
      const current = points[index]
      const next = points[(index + 1) % points.length]
      if (Math.hypot(next[0] - current[0], next[1] - current[1]) < 1e-6) {
        continue
      }

      const midpoint: Point2d = [(current[0] + next[0]) / 2, (current[1] + next[1]) / 2]
      for (const fraction of insetFractions) {
        const candidate: Point2d = [
          midpoint[0] + (centroid[0] - midpoint[0]) * fraction,
          midpoint[1] + (centroid[1] - midpoint[1]) * fraction
        ]
        if (this.isPointInsidePolygon(candidate, points)) {
          return candidate
        }
      }
    }

    return null
  }

  private isPointInsidePolygon(point: Point2d, polygon: Point2d[]): boolean {
    let inside = false

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const current = polygon[i]
      const previous = polygon[j]
      const crossesY = current[1] > point[1] !== previous[1] > point[1]
      if (!crossesY) {
        continue
      }

      const intersectionX =
        ((previous[0] - current[0]) * (point[1] - current[1])) / (previous[1] - current[1]) +
        current[0]
      if (point[0] < intersectionX) {
        inside = !inside
      }
    }

    return inside
  }

  private addCurrentRegion(state: SketchState): void {
    if (!state.currentLoopRegionSafe || state.currentLoopPoints.length < 3) {
      return
    }

    state.regions.push({
      name: this.nextRegionName(state),
      point: this.getRegionPoint(state.currentLoopPoints)
    })
  }

  private emitEndpointClusterCoincidences(state: SketchState, lines: string[]): void {
    const endpointAnchors = new Map<string, string[]>()

    for (const segment of state.segments) {
      if (segment.startAnchor) {
        const anchors = endpointAnchors.get(segment.startPointRef) ?? []
        anchors.push(segment.startAnchor)
        endpointAnchors.set(segment.startPointRef, anchors)
      }

      if (segment.endAnchor) {
        const anchors = endpointAnchors.get(segment.endPointRef) ?? []
        anchors.push(segment.endAnchor)
        endpointAnchors.set(segment.endPointRef, anchors)
      }
    }

    for (const anchors of endpointAnchors.values()) {
      if (anchors.length < 2) {
        continue
      }

      const [firstAnchor, ...remainingAnchors] = anchors
      for (const anchor of remainingAnchors) {
        this.emitCoincident(state, lines, firstAnchor, anchor)
      }
    }
  }

  private emitPointOnLineCoincidences(state: SketchState, lines: string[]): void {
    const linesWithAnchors = state.segments.filter((segment) => {
      return segment.kind === 'line' && segment.startAnchor && segment.endAnchor
    })
    const endpoints = state.segments.flatMap((segment) => {
      return [
        {
          anchor: segment.startAnchor,
          point: segment.pathStart,
          pointRef: segment.startPointRef,
          segmentName: segment.name
        },
        {
          anchor: segment.endAnchor,
          point: segment.pathEnd,
          pointRef: segment.endPointRef,
          segmentName: segment.name
        }
      ]
    })

    for (const endpoint of endpoints) {
      if (!endpoint.anchor) {
        continue
      }

      for (const lineSegment of linesWithAnchors) {
        if (
          endpoint.segmentName === lineSegment.name ||
          endpoint.pointRef === lineSegment.startPointRef ||
          endpoint.pointRef === lineSegment.endPointRef
        ) {
          continue
        }

        const distance = this.getPointToLineSegmentDistance(
          endpoint.point,
          lineSegment.pathStart,
          lineSegment.pathEnd
        )
        if (
          distance.t <= POINT_ON_LINE_ENDPOINT_MARGIN ||
          distance.t >= 1 - POINT_ON_LINE_ENDPOINT_MARGIN ||
          distance.distance > POINT_ON_LINE_TOLERANCE
        ) {
          continue
        }

        this.emitCoincident(state, lines, endpoint.anchor, lineSegment.name)
      }
    }
  }

  private getPointToLineSegmentDistance(
    point: Point2d,
    lineStart: Point2d,
    lineEnd: Point2d
  ): { distance: number; t: number } {
    const lineVector = this.subtractPoints(lineEnd, lineStart)
    const lengthSquared = this.dot(lineVector, lineVector)
    if (lengthSquared < 1e-12) {
      return { distance: Infinity, t: Number.NaN }
    }

    const startToPoint = this.subtractPoints(point, lineStart)
    const t = this.dot(startToPoint, lineVector) / lengthSquared
    const closestPoint: Point2d = [
      lineStart[0] + t * lineVector[0],
      lineStart[1] + t * lineVector[1]
    ]

    return {
      distance: this.length(this.subtractPoints(point, closestPoint)),
      t
    }
  }

  private addGraphRegions(state: SketchState): void {
    const faces = this.findClosedGraphFaces(state).sort((faceA, faceB) => {
      return Math.abs(faceB.area) - Math.abs(faceA.area)
    })

    if (faces.length === 0) {
      return
    }

    state.regions = []
    state.regionCounter = 0
    for (const face of faces) {
      if (face.points.length < 3 || Math.abs(face.area) < 1e-3) {
        continue
      }

      state.regions.push({
        name: this.nextRegionName(state),
        point: this.getRegionPoint(face.points)
      })
    }
  }

  private findClosedGraphFaces(state: SketchState): Array<{ area: number; points: Point2d[] }> {
    type HalfEdge = {
      edgeIndex: number
      from: string
      reversed: boolean
      segment: SegmentRef
      to: string
    }

    const pointByRef = new Map<string, Point2d>()
    for (const endpointRef of state.endpointRefs) {
      pointByRef.set(endpointRef.name, endpointRef.point)
    }

    const adjacency = new Map<string, HalfEdge[]>()
    const addHalfEdge = (halfEdge: HalfEdge): void => {
      const halfEdges = adjacency.get(halfEdge.from) ?? []
      halfEdges.push(halfEdge)
      adjacency.set(halfEdge.from, halfEdges)
    }

    state.segments.forEach((segment, edgeIndex) => {
      if (segment.startPointRef === segment.endPointRef) {
        return
      }

      addHalfEdge({
        edgeIndex,
        from: segment.startPointRef,
        reversed: false,
        segment,
        to: segment.endPointRef
      })
      addHalfEdge({
        edgeIndex,
        from: segment.endPointRef,
        reversed: true,
        segment,
        to: segment.startPointRef
      })
    })

    const getAngle = (halfEdge: HalfEdge): number => {
      const from = pointByRef.get(halfEdge.from)
      const to = pointByRef.get(halfEdge.to)
      if (!from || !to) {
        return 0
      }
      return Math.atan2(to[1] - from[1], to[0] - from[0])
    }

    for (const halfEdges of adjacency.values()) {
      halfEdges.sort((a, b) => getAngle(a) - getAngle(b))
    }

    const visited = new Set<string>()
    const faces: Array<{ area: number; points: Point2d[] }> = []
    const halfEdgeKey = (halfEdge: HalfEdge): string =>
      `${halfEdge.edgeIndex}:${halfEdge.reversed ? 'r' : 'f'}`

    for (const halfEdges of adjacency.values()) {
      for (const startHalfEdge of halfEdges) {
        const startKey = halfEdgeKey(startHalfEdge)
        if (visited.has(startKey)) {
          continue
        }

        const faceHalfEdges: HalfEdge[] = []
        let current = startHalfEdge

        while (!visited.has(halfEdgeKey(current))) {
          visited.add(halfEdgeKey(current))
          faceHalfEdges.push(current)

          const outgoing = adjacency.get(current.to)
          if (!outgoing) {
            break
          }

          const reverseIndex = outgoing.findIndex((candidate) => {
            return candidate.edgeIndex === current.edgeIndex && candidate.to === current.from
          })
          if (reverseIndex < 0) {
            break
          }

          current = outgoing[(reverseIndex - 1 + outgoing.length) % outgoing.length]
        }

        if (current !== startHalfEdge || faceHalfEdges.length < 3) {
          continue
        }

        const points = this.getFacePoints(faceHalfEdges)
        const area = this.getSignedArea(points)
        if (area > 1e-3) {
          faces.push({ area, points })
        }
      }
    }

    return faces
  }

  private getFacePoints(faceHalfEdges: Array<{
    from: string
    reversed: boolean
    segment: SegmentRef
    to: string
  }>): Point2d[] {
    const points: Point2d[] = []

    for (const halfEdge of faceHalfEdges) {
      const segmentPoints = halfEdge.reversed
        ? [...halfEdge.segment.samplePoints].reverse()
        : halfEdge.segment.samplePoints
      for (const point of segmentPoints) {
        const previous = points[points.length - 1]
        if (previous && Math.hypot(previous[0] - point[0], previous[1] - point[1]) < 1e-6) {
          continue
        }
        points.push(point)
      }
    }

    const first = points[0]
    const last = points[points.length - 1]
    if (first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) {
      points.pop()
    }

    return points
  }

  private getSignedArea(points: Point2d[]): number {
    let area = 0
    for (let index = 0; index < points.length; index++) {
      const current = points[index]
      const next = points[(index + 1) % points.length]
      area += current[0] * next[1] - next[0] * current[1]
    }
    return area / 2
  }

  private emitLine(state: SketchState, start: Point2d, end: Point2d, lines: string[]): void {
    const name = this.nextSegmentName(state)
    const startPointRef = this.getSegmentStartPointRef(state, start, lines)
    const endPointRef = this.defineEndpointRef(state, end, lines)
    const canonicalStart = startPointRef.point
    const canonicalEnd = endPointRef.point
    const startSketch = this.toSketchPoint(canonicalStart)
    const endSketch = this.toSketchPoint(canonicalEnd)
    const tangentSketch: Point2d = [
      endSketch[0] - startSketch[0],
      endSketch[1] - startSketch[1]
    ]

    lines.push(`${name} = line(start = ${startPointRef.name}, end = ${endPointRef.name})`)
    this.emitLineConstraints(name, tangentSketch, lines)
    this.appendSegment(
      state,
      {
        allowTangentConstraints: true,
        endAnchor: `${name}.end`,
        endPointRef: endPointRef.name,
        endTangentSketch: tangentSketch,
        kind: 'line',
        name,
        pathEnd: canonicalEnd,
        pathStart: canonicalStart,
        samplePoints: [canonicalStart, canonicalEnd],
        startAnchor: `${name}.start`,
        startPointRef: startPointRef.name,
        startTangentSketch: tangentSketch
      },
      lines
    )
  }

  private emitLineConstraints(name: string, tangentSketch: Point2d, lines: string[]): void {
    const segmentLength = this.length(tangentSketch)
    if (segmentLength < 1e-6) {
      return
    }

    if (this.isNearlyZero(tangentSketch[1])) {
      lines.push(`horizontal(${name})`)
    } else if (this.isNearlyZero(tangentSketch[0])) {
      lines.push(`vertical(${name})`)
    }

    lines.push(`distance([${name}.start, ${name}.end]) == ${this.formatNumber(segmentLength)}`)
  }

  private emitNativeArc(
    state: SketchState,
    arc: NativeArc,
    lines: string[],
    allowTangentConstraints = false,
    constrainRadius = false
  ): void {
    const startPointRef = this.getSegmentStartPointRef(state, arc.pathStart, lines)
    const endPointRef = this.defineEndpointRef(state, arc.pathEnd, lines)
    const canonicalStart = startPointRef.point
    const canonicalEnd = endPointRef.point
    const arcStartPointRef = arc.isCounterClockwise ? startPointRef.name : endPointRef.name
    const arcEndPointRef = arc.isCounterClockwise ? endPointRef.name : startPointRef.name
    const centerPointRef = this.definePointRef(state, arc.center, lines)
    const name = this.nextSegmentName(state)
    const startTangentSketch = this.getArcTangentAtPoint(
      canonicalStart,
      arc.center,
      arc.isCounterClockwise
    )
    const endTangentSketch = this.getArcTangentAtPoint(
      canonicalEnd,
      arc.center,
      arc.isCounterClockwise
    )

    lines.push(`${name} = arc(start = ${arcStartPointRef}, end = ${arcEndPointRef}, center = ${centerPointRef})`)
    if (constrainRadius) {
      lines.push(`radius(${name}) == ${this.formatNumber(this.getArcRadius(arc))}`)
    }
    this.appendSegment(
      state,
      {
        allowTangentConstraints,
        endAnchor: arc.isCounterClockwise ? `${name}.end` : `${name}.start`,
        endPointRef: endPointRef.name,
        endTangentSketch,
        kind: 'arc',
        name,
        pathEnd: canonicalEnd,
        pathStart: canonicalStart,
        samplePoints: [canonicalStart, arc.midpoint, canonicalEnd],
        startAnchor: arc.isCounterClockwise ? `${name}.start` : `${name}.end`,
        startPointRef: startPointRef.name,
        startTangentSketch
      },
      lines
    )
  }

  private getArcTangentAtPoint(
    point: Point2d,
    center: Point2d,
    isCounterClockwise: boolean
  ): Point2d {
    const sketchPoint = this.toSketchPoint(point)
    const sketchCenter = this.toSketchPoint(center)
    const radiusVector: Point2d = [
      sketchPoint[0] - sketchCenter[0],
      sketchPoint[1] - sketchCenter[1]
    ]

    return isCounterClockwise
      ? [-radiusVector[1], radiusVector[0]]
      : [radiusVector[1], -radiusVector[0]]
  }

  private getArcRadius(arc: NativeArc): number {
    const sketchStart = this.toSketchPoint(arc.pathStart)
    const sketchCenter = this.toSketchPoint(arc.center)
    return this.length(this.subtractPoints(sketchStart, sketchCenter))
  }

  private getCircularArcFromBezier(
    start: Point2d,
    control1: Point2d,
    control2: Point2d,
    end: Point2d
  ): NativeArc | null {
    const sketchStart = this.toSketchPoint(start)
    const sketchControl1 = this.toSketchPoint(control1)
    const sketchControl2 = this.toSketchPoint(control2)
    const sketchEnd = this.toSketchPoint(end)
    const startTangent = this.subtractPoints(sketchControl1, sketchStart)
    const endTangent = this.subtractPoints(sketchEnd, sketchControl2)
    const startHandleLength = this.length(startTangent)
    const endHandleLength = this.length(endTangent)

    if (startHandleLength < 1e-6 || endHandleLength < 1e-6) {
      return null
    }

    const startNormal: Point2d = [-startTangent[1], startTangent[0]]
    const endNormal: Point2d = [-endTangent[1], endTangent[0]]
    const center = this.getLineIntersection(sketchStart, startNormal, sketchEnd, endNormal)
    if (!center) {
      return null
    }

    const startRadius = this.subtractPoints(sketchStart, center)
    const endRadius = this.subtractPoints(sketchEnd, center)
    const radius = this.length(startRadius)
    const endRadiusLength = this.length(endRadius)
    if (radius < 1e-6) {
      return null
    }
    const radiusMismatch = Math.abs(radius - endRadiusLength) / radius

    const ccwStartTangent: Point2d = [-startRadius[1], startRadius[0]]
    const isCounterClockwise = this.dot(startTangent, ccwStartTangent) > 0
    let signedAngle = Math.atan2(this.cross(startRadius, endRadius), this.dot(startRadius, endRadius))
    if (isCounterClockwise && signedAngle < 0) {
      signedAngle += Math.PI * 2
    } else if (!isCounterClockwise && signedAngle > 0) {
      signedAngle -= Math.PI * 2
    }

    const sweepAngle = Math.abs(signedAngle)
    if (sweepAngle < 0.01 || sweepAngle > Math.PI + 0.01) {
      return null
    }

    const expectedHandleLength = (4 / 3) * Math.tan(sweepAngle / 4) * radius
    const maxHandleError = Math.max(
      Math.abs(startHandleLength - expectedHandleLength),
      Math.abs(endHandleLength - expectedHandleLength)
    )
    const handleMismatch = maxHandleError / expectedHandleLength

    const midpoint = this.getBezierPoint(sketchStart, sketchControl1, sketchControl2, sketchEnd, 0.5)
    const midpointRadiusMismatch =
      Math.abs(this.length(this.subtractPoints(midpoint, center)) - radius) / radius
    const radialFit = this.getBezierRadialFit(
      sketchStart,
      sketchControl1,
      sketchControl2,
      sketchEnd,
      center,
      radius
    )
    const isStrictCircularArc =
      radiusMismatch <= 0.04 && handleMismatch <= 0.2 && midpointRadiusMismatch <= 0.02
    const isFilletLikeArc =
      sweepAngle <= (2 * Math.PI) / 3 &&
      radiusMismatch <= 0.22 &&
      handleMismatch <= 0.35 &&
      radialFit.maxRelativeError <= 0.22 &&
      radialFit.rmsRelativeError <= 0.13

    if (!isStrictCircularArc && !isFilletLikeArc) {
      return null
    }

    const midpointRadius = this.rotateVector(startRadius, signedAngle / 2)
    const midpointOnArc = this.toModelPoint(this.addPoints(center, midpointRadius))

    return {
      center: this.toModelPoint(center),
      isCounterClockwise,
      midpoint: midpointOnArc,
      pathEnd: end,
      pathStart: start
    }
  }

  private getBezierRadialFit(
    start: Point2d,
    control1: Point2d,
    control2: Point2d,
    end: Point2d,
    center: Point2d,
    radius: number
  ): { maxRelativeError: number; rmsRelativeError: number } {
    let maxError = 0
    let squaredErrorSum = 0
    const sampleCount = 9

    for (let index = 0; index < sampleCount; index++) {
      const t = index / (sampleCount - 1)
      const point = this.getBezierPoint(start, control1, control2, end, t)
      const error = Math.abs(this.length(this.subtractPoints(point, center)) - radius)
      maxError = Math.max(maxError, error)
      squaredErrorSum += error ** 2
    }

    return {
      maxRelativeError: maxError / radius,
      rmsRelativeError: Math.sqrt(squaredErrorSum / sampleCount) / radius
    }
  }

  private getBezierPoint(
    start: Point2d,
    control1: Point2d,
    control2: Point2d,
    end: Point2d,
    t: number
  ): Point2d {
    const mt = 1 - t
    return [
      mt ** 3 * start[0] +
        3 * mt ** 2 * t * control1[0] +
        3 * mt * t ** 2 * control2[0] +
        t ** 3 * end[0],
      mt ** 3 * start[1] +
        3 * mt ** 2 * t * control1[1] +
        3 * mt * t ** 2 * control2[1] +
        t ** 3 * end[1]
    ]
  }

  private emitBezierCurve(
    state: SketchState,
    params: BezierCurveParams,
    lines: string[]
  ): void {
    if (!state.currentPoint) {
      throw new FormatterError('Bezier curve operation encountered before sketch start')
    }

    const start = state.currentPoint
    const control1 = this.addPoints(start, params.control1)
    const control2 = this.addPoints(start, params.control2)
    const end = this.addPoints(start, params.end)
    const arc = this.getCircularArcFromBezier(start, control1, control2, end)
    if (arc) {
      this.emitNativeArc(state, arc, lines)
      return
    }

    const name = this.nextSegmentName(state)
    const startPointRef = this.getSegmentStartPointRef(state, start, lines)
    const control1PointRef = this.definePointRef(state, control1, lines, false)
    const control2PointRef = this.definePointRef(state, control2, lines, false)
    const endPointRef = this.defineEndpointRef(state, end, lines)
    const canonicalStart = startPointRef.point
    const canonicalEnd = endPointRef.point
    this.usesExperimentalSpline = true
    state.currentLoopRegionSafe = false

    lines.push(`${name} = controlPointSpline(points = [`)
    lines.push(`  ${startPointRef.name},`)
    lines.push(`  ${control1PointRef},`)
    lines.push(`  ${control2PointRef},`)
    lines.push(`  ${endPointRef.name}`)
    lines.push(`])`)
    this.appendSegment(
      state,
      {
        endPointRef: endPointRef.name,
        endTangentSketch: [
          this.toSketchPoint(canonicalEnd)[0] - this.toSketchPoint(control2)[0],
          this.toSketchPoint(canonicalEnd)[1] - this.toSketchPoint(control2)[1]
        ],
        kind: 'spline',
        allowTangentConstraints: false,
        name,
        pathEnd: canonicalEnd,
        pathStart: canonicalStart,
        samplePoints: [canonicalStart, control1, control2, canonicalEnd],
        startPointRef: startPointRef.name,
        startTangentSketch: [
          this.toSketchPoint(control1)[0] - this.toSketchPoint(canonicalStart)[0],
          this.toSketchPoint(control1)[1] - this.toSketchPoint(canonicalStart)[1]
        ]
      },
      lines
    )
  }

  private emitTangentialArc(
    state: SketchState,
    params: TangentialArcParams,
    lines: string[]
  ): void {
    if (!state.currentPoint || !state.lastSegment) {
      throw new FormatterError('Tangential arc operation encountered before a tangent segment')
    }

    const pathStart = state.currentPoint
    const start = this.toSketchPoint(pathStart)
    const tangent = this.normalizeVector(state.lastSegment.endTangentSketch)
    const angleRadians = (params.angle * Math.PI) / 180
    const turnSign = Math.sign(angleRadians) || 1
    const center: Point2d = [
      start[0] + -turnSign * tangent[1] * params.radius,
      start[1] + turnSign * tangent[0] * params.radius
    ]
    const startVector: Point2d = [start[0] - center[0], start[1] - center[1]]
    const endVector = this.rotateVector(startVector, angleRadians)
    const endSketchPoint: Point2d = [center[0] + endVector[0], center[1] + endVector[1]]
    const pathEnd = this.toModelPoint(endSketchPoint)
    const centerPoint = this.toModelPoint(center)
    const midpointSketch = this.addPoints(center, this.rotateVector(startVector, angleRadians / 2))
    const midpoint = this.toModelPoint(midpointSketch)
    const isCounterClockwise = angleRadians > 0

    this.emitNativeArc(
      state,
      {
        center: centerPoint,
        isCounterClockwise,
        midpoint,
        pathEnd,
        pathStart
      },
      lines,
      true,
      true
    )
  }

  private emitArc(state: SketchState, params: ArcParams, lines: string[]): void {
    this.emitTangentialArc(state, params, lines)
  }

  private toModelPoint(point: Point2d): Point2d {
    const scalar = INVERT_Y ? -1 : 1
    return [point[0], scalar * point[1]]
  }

  private emitCircle(params: CircleParams, lines: string[], state: SketchState): void {
    const center: Point2d = [params.x, params.y]
    const start: Point2d = [params.x + params.radius, params.y]
    const name = this.nextSegmentName(state)

    lines.push(
      `${name} = circle(start = ${this.formatVarPoint(start)}, center = ${this.formatVarPoint(center)})`
    )
    lines.push(`horizontal([${name}.center, ${name}.start])`)
    lines.push(`diameter(${name}) == ${this.formatNumber(params.radius * 2)}`)
    state.regions.push({
      name: this.nextRegionName(state),
      point: center
    })
    this.resetPathState(state)
  }

  private closeLoop(state: SketchState, lines: string[]): void {
    if (!state.firstSegment || !state.lastSegment) {
      return
    }

    const [currentX, currentY] = state.lastSegment.pathEnd
    const [firstX, firstY] = state.firstSegment.pathStart

    if (Math.hypot(currentX - firstX, currentY - firstY) > 1e-6) {
      this.emitLine(state, state.lastSegment.pathEnd, state.firstSegment.pathStart, lines)
    }

    if (state.firstSegment?.startAnchor && state.lastSegment?.endAnchor) {
      this.emitCoincident(
        state,
        lines,
        state.lastSegment.endAnchor,
        state.firstSegment.startAnchor
      )
      if (this.shouldConstrainTangent(state.lastSegment, state.firstSegment)) {
        lines.push(`tangent([${state.lastSegment.name}, ${state.firstSegment.name}])`)
      }
    }

    this.addCurrentRegion(state)
  }

  private formatOperationsIntoSketch(
    operations: KclOperation[],
    lines: string[],
    state: SketchState
  ): void {
    for (const operation of operations) {
      switch (operation.type) {
        case KclOperationType.StartSketch: {
          if (!this.isStartSketchParams(operation.params)) {
            throw new FormatterError('Invalid StartSketch parameters')
          }
          state.currentPoint = operation.params.point
          state.currentPointRef = null
          state.currentLoopPoints = [operation.params.point]
          state.currentLoopRegionSafe = true
          state.firstSegment = null
          state.lastSegment = null
          break
        }

        case KclOperationType.StartSketchOn:
          this.resetPathState(state)
          break

        case KclOperationType.Line: {
          if (!this.isLineToParams(operation.params)) {
            throw new FormatterError('Invalid Line parameters')
          }
          if (!state.currentPoint) {
            throw new FormatterError('Line operation encountered before sketch start')
          }
          this.emitLine(
            state,
            state.currentPoint,
            this.addPoints(state.currentPoint, operation.params.point),
            lines
          )
          break
        }

        case KclOperationType.LineAbsolute: {
          if (!this.isLineToParams(operation.params)) {
            throw new FormatterError('Invalid LineAbsolute parameters')
          }
          if (!state.currentPoint) {
            throw new FormatterError('LineAbsolute operation encountered before sketch start')
          }
          this.emitLine(state, state.currentPoint, operation.params.point, lines)
          break
        }

        case KclOperationType.BezierCurve: {
          if (!this.isBezierCurveParams(operation.params)) {
            throw new FormatterError('Invalid BezierCurve parameters')
          }
          this.emitBezierCurve(state, operation.params, lines)
          break
        }

        case KclOperationType.Circle: {
          if (!this.isCircleParams(operation.params)) {
            throw new FormatterError('Invalid Circle parameters')
          }
          this.emitCircle(operation.params, lines, state)
          break
        }

        case KclOperationType.Close:
          this.closeLoop(state, lines)
          this.resetPathState(state)
          break

        case KclOperationType.Hole: {
          if (
            !operation.params ||
            !('operations' in operation.params) ||
            !Array.isArray(operation.params.operations)
          ) {
            throw new FormatterError('Invalid Hole parameters')
          }
          this.formatOperationsIntoSketch(operation.params.operations, lines, state)
          break
        }

        case KclOperationType.Arc: {
          if (!this.isArcParams(operation.params)) {
            throw new FormatterError('Invalid Arc parameters')
          }
          this.emitArc(state, operation.params, lines)
          break
        }

        case KclOperationType.TangentialArc: {
          if (!this.isTangentialArcParams(operation.params)) {
            throw new FormatterError('Invalid TangentialArc parameters')
          }
          this.emitTangentialArc(state, operation.params, lines)
          break
        }

        default:
          throw new FormatterError(`Unsupported operation type: ${operation.type}`)
      }
    }
  }

  private getSketchPlane(shape: KclShape): string {
    const planeOperation = shape.operations.find((operation) => {
      return (
        operation.type === KclOperationType.StartSketchOn &&
        this.isStartSketchOnParams(operation.params)
      )
    })

    if (planeOperation && this.isStartSketchOnParams(planeOperation.params)) {
      return planeOperation.params.plane
    }

    return 'XY'
  }

  private formatShape(shape: KclShape): string {
    const variable = shape.variable || 'sketch'
    const state: SketchState = {
      currentPoint: null,
      currentPointRef: null,
      currentLoopPoints: [],
      currentLoopRegionSafe: true,
      coincidentConstraintKeys: new Set<string>(),
      endpointRefs: [],
      firstSegment: null,
      lastSegment: null,
      pointCounter: 0,
      pointRefs: new Map<string, string>(),
      regionCounter: 0,
      regions: [],
      segments: [],
      segmentCounter: 0
    }
    const bodyLines: string[] = []

    this.formatOperationsIntoSketch(shape.operations, bodyLines, state)
    this.emitEndpointClusterCoincidences(state, bodyLines)
    this.emitPointOnLineCoincidences(state, bodyLines)
    if (this.emitRegions) {
      this.addGraphRegions(state)
    }

    const sketch = `${variable} = sketch(on = ${this.getSketchPlane(shape)}) {\n${bodyLines
      .map((line) => `  ${line}`)
      .join('\n')}\n}`
    const regions = this.emitRegions
      ? state.regions.map((region) => {
          return `${region.name} = region(point = ${this.formatPoint(region.point)}, sketch = ${variable})`
        })
      : []

    return [sketch, ...regions].join('\n\n')
  }

  public format(output: KclOutput): string {
    this.usesExperimentalSpline = false
    const kcl = this.formatCombinedShape(output)
    if (this.usesExperimentalSpline) {
      return `@settings(experimentalFeatures = allow)\n\n${kcl}`
    }

    return kcl
  }

  private formatCombinedShape(output: KclOutput): string {
    const operations = output.shapes.flatMap((shape) => shape.operations)
    if (operations.length === 0) {
      return ''
    }

    return this.formatShape({
      operations,
      variable: output.shapes[0]?.variable || 'sketch001'
    })
  }
}
