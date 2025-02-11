// Options that control KCL output generation.
export interface KCLOptions {
  centerOnViewBox?: boolean
}

// The type of operation being performed.
export enum KCLOperationType {
  StartSketch = 'startSketch',
  Line = 'line',
  XLineTo = 'xLineTo',
  YLineTo = 'yLineTo',
  Arc = 'arc',
  TangentialArc = 'tangentialArc',
  BezierCurve = 'bezierCurve',
  Circle = 'circle',
  Polygon = 'polygon',
  Close = 'close',
  Hole = 'hole'
}

// Parameters for different KCL operations.
export interface StartSketchParams {
  point: [number, number]
}

export interface LineToParams {
  point: [number, number]
}

export interface BezierCurveParams {
  control1: [number, number]
  control2: [number, number]
  to: [number, number]
}

export interface XLineToParams {
  x: number
}

export interface YLineToParams {
  y: number
}

export interface ArcParams {
  radius: number
  angle: number // In degrees.
}

export interface TangentialArcParams {
  radius: number
  offset: number
}

export interface CircleParams {
  radius: number
  x: number
  y: number
}

export interface PolygonParams {
  sides: number
  radius: number
}

export interface HoleParams {
  operations: KCLOperation[]
}

// Union type for all possible operation parameters.
export type KCLOperationParams =
  | StartSketchParams
  | LineToParams
  | XLineToParams
  | YLineToParams
  | ArcParams
  | TangentialArcParams
  | BezierCurveParams
  | CircleParams
  | PolygonParams
  | HoleParams
  | null // For operations like close that have no parameters.

// A single KCL operation.
export interface KCLOperation {
  type: KCLOperationType
  params: KCLOperationParams
}

// A complete KCL shape definition.
export interface KCLShape {
  operations: KCLOperation[]
  variable?: string // The variable name this shape is assigned to, if any.
}

// The complete KCL output.
export interface KCLOutput {
  shapes: KCLShape[]
}
