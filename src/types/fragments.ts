import { Point } from './base'

export enum PathFragmentType {
  // SVG paths are lines, Béziers or arcs. We don't support arcs, and we can simplify
  // things by only considering absolute coordinates and mopping up smoothed
  // (i.e. reflected control point) curves at the layer above this. So... simple type.
  Line = 'line',
  Quad = 'quad',
  Cubic = 'cubic'
}

export interface PathFragmentData {
  // An internal, intermediate representation of a path 'fragment'. We may produce
  // a bunch of these when splitting paths, but we need more context than would be
  // provided by the sort of new PathCommand object we produce when re-emitting
  // quasi-SVG.
  id: string
  type: PathFragmentType
  start: Point
  end: Point
  control1?: Point
  control2?: Point
  iCommand: number
  connectedFragments?: {
    fragmentId: string
    angle: number
  }[]
}
