import { Transform } from '../utils/transform'

export interface Point {
  x: number
  y: number
}

export interface ViewBox {
  xMin: number
  yMin: number
  width: number
  height: number
}

export interface ElementProperties {
  id?: string
  transform?: Transform
  fillRule?: FillRule
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
