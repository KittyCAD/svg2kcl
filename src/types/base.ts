export type Point = {
  x: number
  y: number
}

export type Vector = {
  x: number
  y: number
}

export type LineSegment = {
  start: Point
  end: Point
}

export type ViewBox = {
  xMin: number
  yMin: number
  width: number
  height: number
}

export enum FillRule {
  NonZero = 'nonzero',
  EvenOdd = 'evenodd'
}

export enum Plane3D {
  XY = 'XY',
  YZ = 'YZ',
  XZ = 'XZ'
}
