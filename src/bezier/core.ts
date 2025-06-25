import { Point } from '../types/base'
import { convertQuadraticToCubic } from './helpers'
import { computeTangentToCubic, computeTangentToQuadratic } from './math'

export enum BezierType {
  Quadratic = 'quadratic',
  Cubic = 'cubic'
}

export interface BezierPointsCubic {
  start: Point
  control1: Point
  control2: Point
  end: Point
}

export interface BezierPointsQuadratic {
  start: Point
  control: Point
  end: Point
}

export class Bezier {
  public readonly type: BezierType
  public readonly start: Point
  public readonly end: Point

  // Private fields for actual control points.
  private readonly _quadraticControl?: Point
  private readonly _cubicControl1?: Point
  private readonly _cubicControl2?: Point

  // Cached cubic form for quadratics.
  private _cachedCubicForm?: BezierPointsCubic

  private constructor(
    type: BezierType,
    start: Point,
    end: Point,
    quadraticControl?: Point,
    cubicControl1?: Point,
    cubicControl2?: Point
  ) {
    this.type = type
    this.start = start
    this.end = end
    this._quadraticControl = quadraticControl
    this._cubicControl1 = cubicControl1
    this._cubicControl2 = cubicControl2
  }

  // Static factory methods.
  static quadratic(object: BezierPointsQuadratic): Bezier {
    return new Bezier(BezierType.Quadratic, object.start, object.end, object.control)
  }

  static cubic(object: BezierPointsCubic): Bezier {
    return new Bezier(
      BezierType.Cubic,
      object.start,
      object.end,
      undefined,
      object.control1,
      object.control2
    )
  }

  // Getters for control points. This allows us to destructure the Bezier object
  // as if it were a regular object.
  get quadraticControl(): Point {
    if (this.type !== BezierType.Quadratic || !this._quadraticControl) {
      throw new Error('Cannot get quadratic control point from non-quadratic Bezier')
    }
    return this._quadraticControl
  }

  get control1(): Point {
    if (this.type === BezierType.Cubic) {
      if (!this._cubicControl1) {
        throw new Error('Invalid cubic Bezier: missing control1')
      }
      return this._cubicControl1
    } else {
      // Return cubic form of quadratic
      return this.asCubic().control1
    }
  }

  get control2(): Point {
    if (this.type === BezierType.Cubic) {
      if (!this._cubicControl2) {
        throw new Error('Invalid cubic Bezier: missing control2')
      }
      return this._cubicControl2
    } else {
      // Return cubic form of quadratic
      return this.asCubic().control2
    }
  }

  // Convert to cubic form.
  asCubic(): BezierPointsCubic {
    if (this.type === BezierType.Cubic) {
      return {
        start: this.start,
        control1: this.control1,
        control2: this.control2,
        end: this.end
      }
    }

    // Cache the cubic conversion for quadratics
    if (!this._cachedCubicForm) {
      if (!this._quadraticControl) {
        throw new Error('Invalid quadratic Bezier: missing control point')
      }

      const cubic = convertQuadraticToCubic(this.start, this._quadraticControl, this.end)
      this._cachedCubicForm = {
        start: cubic.start,
        control1: cubic.control1,
        control2: cubic.control2,
        end: cubic.end
      }
    }

    return this._cachedCubicForm
  }

  // Return in quadratic form.
  asQuadratic(): BezierPointsQuadratic {
    if (this.type === BezierType.Quadratic) {
      return {
        start: this.start,
        control: this.quadraticControl,
        end: this.end
      }
    }
    throw new Error('Cannot convert cubic Bezier to quadratic form')
  }

  get isQuadratic(): boolean {
    return this.type === BezierType.Quadratic
  }

  get isCubic(): boolean {
    return this.type === BezierType.Cubic
  }

  // Get the final control point for tracking.
  get finalControlPoint(): Point {
    if (this.type === BezierType.Cubic) {
      return this.control2
    } else {
      return this.quadraticControl
    }
  }

  get tangent(): (t: number) => Point {
    if (this.type === BezierType.Cubic) {
      return (t: number) => computeTangentToCubic(this.asCubic(), t)
    } else {
      return (t: number) => computeTangentToQuadratic(this.asQuadratic(), t)
    }
  }
}
