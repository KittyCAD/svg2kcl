import { Point } from './base'

// Raw SVG path related types.
// -------------------------------------------------------------------------------------
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
  startPositionAbsolute: Point // Absolute position before the command is executed.
  endPositionAbsolute: Point // Absolute position after the command is executed.
}

// The SVG path commands and our nicer names.
export const SvgPathCommandMap: Record<string, PathCommandType> = {
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

export const PathCommandTypeToSvgPathCommandMap: Record<PathCommandType, string> = Object.entries(
  SvgPathCommandMap
).reduce((acc, [key, value]) => {
  acc[value] = key
  return acc
}, {} as Record<PathCommandType, string>)

// Downstream / processed types.
// -------------------------------------------------------------------------------------
export interface PathCommandEnriched extends PathCommand {
  iFirstPoint: number // Index of the first point of this command in the global path sample array.
  iLastPoint: number // Index of the last point of this command in the global path sample array.
  iCommand: number // Index of this command in the global path command array.
  previousControlPoint?: Point // Last control point for the previous Bezier command.
}

export interface Subpath {
  startIndex: number // Index in commands array.
  endIndex: number // Index in commands array.
  commands: PathCommandEnriched[]
  samplePoints: Point[]
}

export interface PathSampleResult {
  // Represents a sampled path for self-intersection detection.
  pathSamplePoints: Point[] // Sampled points for the full path.
  pathCommands: PathCommandEnriched[] // Set of enriched commands for the full path
}
