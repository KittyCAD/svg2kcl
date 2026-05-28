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
  name: string
  pathEnd: Point2d
  pathStart: Point2d
  startAnchor?: string
}

type SketchState = {
  currentPoint: Point2d | null
  firstSegment: SegmentRef | null
  lastSegment: SegmentRef | null
  segmentCounter: number
}

const INVERT_Y = true

export class Formatter {
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

  private appendSegment(state: SketchState, segment: SegmentRef, lines: string[]): void {
    if (state.lastSegment?.endAnchor && segment.startAnchor) {
      lines.push(`coincident([${state.lastSegment.endAnchor}, ${segment.startAnchor}])`)
    } else if (!state.lastSegment) {
      state.firstSegment = segment
    }

    state.lastSegment = segment
    state.currentPoint = segment.pathEnd
  }

  private emitLine(state: SketchState, start: Point2d, end: Point2d, lines: string[]): void {
    const name = this.nextSegmentName(state)
    lines.push(
      `${name} = line(start = ${this.formatVarPoint(start)}, end = ${this.formatVarPoint(end)})`
    )
    lines.push(`fixed([${name}.start, ${this.formatPoint(start)}])`)
    lines.push(`fixed([${name}.end, ${this.formatPoint(end)}])`)
    this.appendSegment(
      state,
      {
        endAnchor: `${name}.end`,
        endTangentSketch: [
          this.toSketchPoint(end)[0] - this.toSketchPoint(start)[0],
          this.toSketchPoint(end)[1] - this.toSketchPoint(start)[1]
        ],
        name,
        pathEnd: end,
        pathStart: start,
        startAnchor: `${name}.start`
      },
      lines
    )
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
    const name = this.nextSegmentName(state)

    lines.push(`${name} = controlPointSpline(points = [`)
    lines.push(`  ${this.formatPoint(start)},`)
    lines.push(`  ${this.formatPoint(control1)},`)
    lines.push(`  ${this.formatPoint(control2)},`)
    lines.push(`  ${this.formatPoint(end)}`)
    lines.push(`])`)
    this.appendSegment(
      state,
      {
        endTangentSketch: [
          this.toSketchPoint(end)[0] - this.toSketchPoint(control2)[0],
          this.toSketchPoint(end)[1] - this.toSketchPoint(control2)[1]
        ],
        name,
        pathEnd: end,
        pathStart: start
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
    const isCounterClockwise = angleRadians > 0
    const arcStart = isCounterClockwise ? pathStart : pathEnd
    const arcEnd = isCounterClockwise ? pathEnd : pathStart
    const name = this.nextSegmentName(state)
    const radiusVectorAtEnd: Point2d = [
      endSketchPoint[0] - center[0],
      endSketchPoint[1] - center[1]
    ]
    const endTangentSketch: Point2d =
      angleRadians > 0
        ? [-radiusVectorAtEnd[1], radiusVectorAtEnd[0]]
        : [radiusVectorAtEnd[1], -radiusVectorAtEnd[0]]

    lines.push(
      `${name} = arc(start = ${this.formatVarPoint(arcStart)}, end = ${this.formatVarPoint(
        arcEnd
      )}, center = ${this.formatVarPoint(centerPoint)})`
    )
    lines.push(`fixed([${name}.start, ${this.formatPoint(arcStart)}])`)
    lines.push(`fixed([${name}.end, ${this.formatPoint(arcEnd)}])`)
    lines.push(`fixed([${name}.center, ${this.formatPoint(centerPoint)}])`)
    this.appendSegment(
      state,
      {
        endAnchor: isCounterClockwise ? `${name}.end` : `${name}.start`,
        endTangentSketch,
        name,
        pathEnd,
        pathStart,
        startAnchor: isCounterClockwise ? `${name}.start` : `${name}.end`
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
    lines.push(`fixed([${name}.center, ${this.formatPoint(center)}])`)
    lines.push(`fixed([${name}.start, ${this.formatPoint(start)}])`)
    lines.push(`horizontal([${name}.center, ${name}.start])`)
    state.currentPoint = start
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
    }
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
          state.firstSegment = null
          state.lastSegment = null
          break
        }

        case KclOperationType.StartSketchOn:
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
          state.firstSegment = null
          state.lastSegment = null
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
      firstSegment: null,
      lastSegment: null,
      segmentCounter: 0
    }
    const bodyLines: string[] = []

    this.formatOperationsIntoSketch(shape.operations, bodyLines, state)

    return `${variable} = sketch(on = ${this.getSketchPlane(shape)}) {\n${bodyLines
      .map((line) => `  ${line}`)
      .join('\n')}\n}`
  }

  public format(output: KclOutput): string {
    const kcl = output.shapes.map((shape) => this.formatShape(shape)).join('\n\n')
    if (this.hasOperationType(output.shapes, KclOperationType.BezierCurve)) {
      return `@settings(experimentalFeatures = allow)\n\n${kcl}`
    }

    return kcl
  }

  private hasOperationType(shapes: KclShape[], type: KclOperationType): boolean {
    return shapes.some((shape) => this.hasOperationTypeInOperations(shape.operations, type))
  }

  private hasOperationTypeInOperations(operations: KclOperation[], type: KclOperationType): boolean {
    return operations.some((operation) => {
      if (operation.type === type) {
        return true
      }

      if (
        operation.type === KclOperationType.Hole &&
        operation.params &&
        'operations' in operation.params &&
        Array.isArray(operation.params.operations)
      ) {
        return this.hasOperationTypeInOperations(operation.params.operations, type)
      }

      return false
    })
  }
}
