import { ElementProperties, FillRule, Point } from './base'
import { PathCommand } from './path'
export enum ElementType {
  Circle = 'circle',
  Ellipse = 'ellipse',
  Group = 'g',
  Line = 'line',
  Path = 'path',
  Polygon = 'polygon',
  Polyline = 'polyline',
  Rectangle = 'rect'
}

export interface PathElement extends ElementProperties {
  type: ElementType.Path
  commands: PathCommand[]
  fillRule: FillRule
}

export interface RectangleElement extends ElementProperties {
  type: ElementType.Rectangle
  x: number
  y: number
  width: number
  height: number
  rx?: number
  ry?: number
}

export interface CircleElement extends ElementProperties {
  type: ElementType.Circle
  center: Point
  radius: number
}

export interface LineElement extends ElementProperties {
  type: ElementType.Line
  start: Point
  end: Point
}

export interface PolylineElement extends ElementProperties {
  type: ElementType.Polyline
  points: Point[]
}

export interface PolygonElement extends ElementProperties {
  type: ElementType.Polygon
  points: Point[]
}

export interface GroupElement extends ElementProperties {
  type: ElementType.Group
  children: Element[]
}

// Union type after all elements are defined.
export type Element =
  | PathElement
  | RectangleElement
  | CircleElement
  | LineElement
  | PolylineElement
  | PolygonElement
  | GroupElement
