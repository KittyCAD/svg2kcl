import {
  ArcParams,
  BezierCurveParams,
  CircleParams,
  KclOperation,
  KclOperationType,
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

type SegmentRef = {
  endAnchor?: string
  endTangentSketch: Point2d
  kind: 'arc' | 'line' | 'spline'
  name: string
  pathEnd: Point2d
  pathStart: Point2d
  samplePoints: Point2d[]
  startAnchor?: string
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
  currentLoopPoints: Point2d[]
  currentLoopRegionSafe: boolean
  firstSegment: SegmentRef | null
  lastSegment: SegmentRef | null
  regionCounter: number
  regions: RegionRef[]
  segmentCounter: number
}

const INVERT_Y = true

export class Formatter {
  private usesExperimentalSpline = false

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

  private nextRegionName(state: SketchState): string {
    state.regionCounter += 1
    return `region${String(state.regionCounter).padStart(3, '0')}`
  }

  private resetPathState(state: SketchState): void {
    state.currentPoint = null
    state.currentLoopPoints = []
    state.currentLoopRegionSafe = true
    state.firstSegment = null
    state.lastSegment = null
  }

  private appendSegment(state: SketchState, segment: SegmentRef, lines: string[]): void {
    if (state.lastSegment?.endAnchor && segment.startAnchor) {
      lines.push(`coincident([${state.lastSegment.endAnchor}, ${segment.startAnchor}])`)
      if (this.shouldConstrainTangent(state.lastSegment, segment)) {
        lines.push(`tangent([${state.lastSegment.name}, ${segment.name}])`)
      }
    } else if (!state.lastSegment) {
      state.firstSegment = segment
    }

    state.lastSegment = segment
    state.currentPoint = segment.pathEnd

    if (state.currentLoopPoints.length === 0) {
      state.currentLoopPoints.push(segment.pathStart)
    }
    state.currentLoopPoints.push(...segment.samplePoints.slice(1))
  }

  private shouldConstrainTangent(previous: SegmentRef, next: SegmentRef): boolean {
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

  private emitLine(state: SketchState, start: Point2d, end: Point2d, lines: string[]): void {
    const name = this.nextSegmentName(state)
    const startSketch = this.toSketchPoint(start)
    const endSketch = this.toSketchPoint(end)
    const tangentSketch: Point2d = [
      endSketch[0] - startSketch[0],
      endSketch[1] - startSketch[1]
    ]

    lines.push(
      `${name} = line(start = ${this.formatVarPoint(start)}, end = ${this.formatVarPoint(end)})`
    )
    this.emitLineConstraints(name, tangentSketch, lines)
    this.appendSegment(
      state,
      {
        endAnchor: `${name}.end`,
        endTangentSketch: tangentSketch,
        kind: 'line',
        name,
        pathEnd: end,
        pathStart: start,
        samplePoints: [start, end],
        startAnchor: `${name}.start`,
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

  private emitNativeArc(state: SketchState, arc: NativeArc, lines: string[]): void {
    const arcStart = arc.isCounterClockwise ? arc.pathStart : arc.pathEnd
    const arcEnd = arc.isCounterClockwise ? arc.pathEnd : arc.pathStart
    const name = this.nextSegmentName(state)
    const startTangentSketch = this.getArcTangentAtPoint(
      arc.pathStart,
      arc.center,
      arc.isCounterClockwise
    )
    const endTangentSketch = this.getArcTangentAtPoint(
      arc.pathEnd,
      arc.center,
      arc.isCounterClockwise
    )

    lines.push(
      `${name} = arc(start = ${this.formatVarPoint(arcStart)}, end = ${this.formatVarPoint(
        arcEnd
      )}, center = ${this.formatVarPoint(arc.center)})`
    )
    lines.push(`radius(${name}) == ${this.formatNumber(this.getArcRadius(arc))}`)
    this.appendSegment(
      state,
      {
        endAnchor: arc.isCounterClockwise ? `${name}.end` : `${name}.start`,
        endTangentSketch,
        kind: 'arc',
        name,
        pathEnd: arc.pathEnd,
        pathStart: arc.pathStart,
        samplePoints: [arc.pathStart, arc.midpoint, arc.pathEnd],
        startAnchor: arc.isCounterClockwise ? `${name}.start` : `${name}.end`,
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
    if (radius < 1e-6 || Math.abs(radius - endRadiusLength) / radius > 0.04) {
      return null
    }

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
    if (maxHandleError / expectedHandleLength > 0.2) {
      return null
    }

    const midpoint = this.getBezierPoint(sketchStart, sketchControl1, sketchControl2, sketchEnd, 0.5)
    if (Math.abs(this.length(this.subtractPoints(midpoint, center)) - radius) / radius > 0.02) {
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
    this.usesExperimentalSpline = true
    state.currentLoopRegionSafe = false

    lines.push(`${name} = controlPointSpline(points = [`)
    lines.push(`  ${this.formatVarPoint(start)},`)
    lines.push(`  ${this.formatVarPoint(control1)},`)
    lines.push(`  ${this.formatVarPoint(control2)},`)
    lines.push(`  ${this.formatVarPoint(end)}`)
    lines.push(`])`)
    this.appendSegment(
      state,
      {
        endTangentSketch: [
          this.toSketchPoint(end)[0] - this.toSketchPoint(control2)[0],
          this.toSketchPoint(end)[1] - this.toSketchPoint(control2)[1]
        ],
        kind: 'spline',
        name,
        pathEnd: end,
        pathStart: start,
        samplePoints: [start, control1, control2, end],
        startTangentSketch: [
          this.toSketchPoint(control1)[0] - this.toSketchPoint(start)[0],
          this.toSketchPoint(control1)[1] - this.toSketchPoint(start)[1]
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
      lines
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
      lines.push(`coincident([${state.lastSegment.endAnchor}, ${state.firstSegment.startAnchor}])`)
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
      currentLoopPoints: [],
      currentLoopRegionSafe: true,
      firstSegment: null,
      lastSegment: null,
      regionCounter: 0,
      regions: [],
      segmentCounter: 0
    }
    const bodyLines: string[] = []

    this.formatOperationsIntoSketch(shape.operations, bodyLines, state)

    const sketch = `${variable} = sketch(on = ${this.getSketchPlane(shape)}) {\n${bodyLines
      .map((line) => `  ${line}`)
      .join('\n')}\n}`
    const regions = state.regions.map((region) => {
      return `${region.name} = region(point = ${this.formatPoint(region.point)}, sketch = ${variable})`
    })

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
