import { Point } from './base'

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
