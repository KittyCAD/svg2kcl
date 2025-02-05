export type Point = {
  x: number
  y: number
}

export interface ViewBox {
  xMin: number
  yMin: number
  width: number
  height: number
}

export enum FillRule {
  NonZero = 'nonzero',
  EvenOdd = 'evenodd'
}

export interface SVGFile {
  viewBox: ViewBox
  paths: string[]
}

export enum CommandType {
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

// Map from SVG command characters to descriptive names.
export const SVGCommandMap: Record<string, CommandType> = {
  A: CommandType.EllipticalArcAbsolute,
  a: CommandType.EllipticalArcRelative,
  C: CommandType.CubicBezierAbsolute,
  c: CommandType.CubicBezierRelative,
  H: CommandType.HorizontalLineAbsolute,
  h: CommandType.HorizontalLineRelative,
  L: CommandType.LineAbsolute,
  l: CommandType.LineRelative,
  M: CommandType.MoveAbsolute,
  m: CommandType.MoveRelative,
  Q: CommandType.QuadraticBezierAbsolute,
  q: CommandType.QuadraticBezierRelative,
  S: CommandType.CubicBezierSmoothAbsolute,
  s: CommandType.CubicBezierSmoothRelative,
  T: CommandType.QuadraticBezierSmoothAbsolute,
  t: CommandType.QuadraticBezierSmoothRelative,
  V: CommandType.VerticalLineAbsolute,
  v: CommandType.VerticalLineRelative,
  Z: CommandType.StopAbsolute,
  z: CommandType.StopRelative
}

export const CommandTypeToSVGMap: Record<CommandType, string> = Object.entries(
  SVGCommandMap
).reduce((acc, [key, value]) => {
  acc[value] = key
  return acc
}, {} as Record<CommandType, string>)

export const NumericVals: Array<string> = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.']

export interface PathState {
  command: CommandType
  values: number[]
  valueBuffer: string
  currentPoint: Point
  isPathOpen: boolean
  isValuePushed: boolean
}
