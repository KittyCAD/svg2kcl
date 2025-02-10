import { Transform } from '../utils/transform'

// Our current supported element types.
export enum GeometricElementType {
  Path = 'path',
  Rectangle = 'rectangle',
  Circle = 'circle',
  Line = 'line',
  Polyline = 'polyline',
  Polygon = 'polygon'
}

export interface Point {
  x: number
  y: number
}

// Defines the visible area of an SVG document.
export interface ViewBox {
  xMin: number
  yMin: number
  width: number
  height: number
}

// Base interface from which all geometric elements inherit.
export interface GeometricElement {
  transform?: Transform
  fillRule?: FillRule
  parentElement: GeometricElement | null
}

// Path handling.
export enum PathCommandType {
  NotSet = 'NotSet',
  MoveAbsolute = 'MoveAbsolute',
  MoveRelative = 'MoveRelative',
  LineAbsolute = 'LineAbsolute',
  LineRelative = 'LineRelative',
  HorizontalLineAbsolute = 'HorizontalLineAbsolute',
  HorizontalLineRelative = 'HorizontalLineRelative',
  VerticalLineAbsolute = 'VerticalLineAbsolute',
  VerticalLineRelative = 'VerticalLineRelative',
  QuadraticBezierAbsolute = 'QuadraticBezierAbsolute',
  QuadraticBezierRelative = 'QuadraticBezierRelative',
  QuadraticBezierSmoothAbsolute = 'QuadraticBezierSmoothAbsolute',
  QuadraticBezierSmoothRelative = 'QuadraticBezierSmoothRelative',
  CubicBezierAbsolute = 'CubicBezierAbsolute',
  CubicBezierRelative = 'CubicBezierRelative',
  CubicBezierSmoothAbsolute = 'CubicBezierSmoothAbsolute',
  CubicBezierSmoothRelative = 'CubicBezierSmoothRelative',
  EllipticalArcAbsolute = 'EllipticalArcAbsolute',
  EllipticalArcRelative = 'EllipticalArcRelative',
  StopAbsolute = 'StopAbsolute',
  StopRelative = 'StopRelative'
}

export interface PathCommand {
  type: PathCommandType
  parameters: number[]
  position: Point
}

export interface Path extends GeometricElement {
  type: GeometricElementType.Path
  commands: PathCommand[]
}

// A rectangular shape, optionally with rounded corners.
export interface Rectangle extends GeometricElement {
  type: GeometricElementType.Rectangle
  x: number
  y: number
  width: number
  height: number
  rx?: number // Horizontal corner radius.
  ry?: number // Vertical corner radius.
}

export interface Circle extends GeometricElement {
  type: GeometricElementType.Circle
  center: Point
  radius: number
}

export interface Line extends GeometricElement {
  type: GeometricElementType.Line
  start: Point
  end: Point
}

// An open sequence of connected straight line segments.
export interface Polyline extends GeometricElement {
  type: GeometricElementType.Polyline
  points: Point[]
}

// A closed shape consisting of connected straight line segments.
export interface Polygon extends GeometricElement {
  type: GeometricElementType.Polygon
  points: Point[]
}

// Union type encompassing all supported geometric shapes.
export type GeometricShape = Path | Rectangle | Circle | Line | Polyline | Polygon

// Defines how overlapping shapes are filled.
export enum FillRule {
  NonZero = 'nonzero',
  EvenOdd = 'evenodd'
}
