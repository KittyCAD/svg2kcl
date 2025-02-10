import { GeometricShape, PathCommandType, ViewBox } from './geometric'
import { Transform } from '../utils/transform'

// Representation of an SVG doc and its elements.
export interface SVG {
  viewBox: ViewBox
  elements: GeometricShape[]
}

export interface RawSVGElement {
  type: string
  attributes: Record<string, string>
  children?: RawSVGElement[]
}

export interface RawSVG {
  viewBox?: string
  width?: string | number
  height?: string | number
  elements: RawSVGElement[]
}

// Path specific types.

// The SVG path commands and our nicer names.
export const SVGPathCommandMap: Record<string, PathCommandType> = {
  A: PathCommandType.EllipticalArcAbsolute,
  a: PathCommandType.EllipticalArcRelative,
  C: PathCommandType.CubicBezierAbsolute,
  c: PathCommandType.CubicBezierRelative,
  H: PathCommandType.HorizontalLineAbsolute,
  h: PathCommandType.HorizontalLineRelative,
  L: PathCommandType.LineAbsolute,
  l: PathCommandType.LineRelative,
  M: PathCommandType.MoveAbsolute,
  m: PathCommandType.MoveRelative,
  Q: PathCommandType.QuadraticBezierAbsolute,
  q: PathCommandType.QuadraticBezierRelative,
  S: PathCommandType.CubicBezierSmoothAbsolute,
  s: PathCommandType.CubicBezierSmoothRelative,
  T: PathCommandType.QuadraticBezierSmoothAbsolute,
  t: PathCommandType.QuadraticBezierSmoothRelative,
  V: PathCommandType.VerticalLineAbsolute,
  v: PathCommandType.VerticalLineRelative,
  Z: PathCommandType.StopAbsolute,
  z: PathCommandType.StopRelative
}

export const PathCommandTypeToSVGPathCommandMap: Record<PathCommandType, string> = Object.entries(
  SVGPathCommandMap
).reduce((acc, [key, value]) => {
  acc[value] = key
  return acc
}, {} as Record<PathCommandType, string>)

// Collection type.
export enum CollectionType {
  Group = 'g'
}
