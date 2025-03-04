import { Plane3D } from './base'

// Options that control KCL output generation.
export interface KclOptions {
  centerOnViewBox?: boolean
}

// The type of operation being performed.
export enum KclOperationType {
  StartSketch = `StartSketch`,
  StartSketchOn = `StartSketchOn`,
  Line = `Line`,
  LineAbsolute = `LineAbsolute`,
  XLineTo = `XLineTo`,
  YLineTo = `YLineTo`,
  Arc = `Arc`,
  TangentialArc = `TangentialArc`,
  BezierCurve = `BezierCurve`,
  Circle = `Circle`,
  Polygon = `Polygon`,
  Close = `Close`,
  Hole = `Hole`
}

// Parameters for different KCL operations.
export interface StartSketchParams {
  point: [number, number]
}

export type StartSketchOnParams = {
  plane: Plane3D
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
  operations: KclOperation[]
}

// Union type for all possible operation parameters.
export type KclOperationParams =
  | StartSketchParams
  | StartSketchOnParams
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
export interface KclOperation {
  type: KclOperationType
  params: KclOperationParams
}

// A complete KCL shape definition.
export interface KclShape {
  operations: KclOperation[]
  variable?: string // The variable name this shape is assigned to, if any.
}

// The complete KCL output.
export interface KclOutput {
  shapes: KclShape[]
}
