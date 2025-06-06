import { Plane3D } from './base'

// Options that control KCL output generation.
export type KclOptions = {
  centerOnViewBox?: boolean
}

// The type of operation being performed.
export enum KclOperationType {
  StartSketch = 'startSketch',
  StartSketchOn = 'startSketchOn',
  Line = 'line',
  LineAbsolute = 'lineAbsolute',
  XLine = 'xLine',
  YLine = 'yLine',
  Arc = 'arc',
  TangentialArc = 'tangentialArc',
  BezierCurve = 'bezierCurve',
  Circle = 'circle',
  Polygon = 'polygon',
  Close = 'close',
  Hole = 'hole'
}

// Parameters for different KCL operations.
export type StartSketchParams = {
  point: [number, number]
}

export type StartSketchOnParams = {
  plane: Plane3D
}

export type LineToParams = {
  point: [number, number]
}

export type BezierCurveParams = {
  control1: [number, number]
  control2: [number, number]
  end: [number, number]
}

export type XLineParams = {
  endAbsolute: number
}

export type YLineParams = {
  endAbsolute: number
}

export type ArcParams = {
  radius: number
  angle: number // In degrees.
}

export type TangentialArcParams = {
  radius: number
  angle: number
}

export type CircleParams = {
  radius: number
  x: number
  y: number
}

export type PolygonParams = {
  sides: number
  radius: number
}

export type HoleParams = {
  operations: KclOperation[]
}

// Union type for all possible operation parameters.
export type KclOperationParams =
  | StartSketchParams
  | StartSketchOnParams
  | LineToParams
  | XLineParams
  | YLineParams
  | ArcParams
  | TangentialArcParams
  | BezierCurveParams
  | CircleParams
  | PolygonParams
  | HoleParams
  | null // For operations like close that have no parameters.

// A single KCL operation.
export type KclOperation = {
  type: KclOperationType
  params: KclOperationParams
}

// A complete KCL shape definition.
export type KclShape = {
  operations: KclOperation[]
  variable?: string // The variable name this shape is assigned to, if any.
}

// The complete KCL output.
export type KclOutput = {
  shapes: KclShape[]
}
