import { ElementProperties, Point } from './base'
import { PathCommand } from './path'

export enum ElementType {
  Path = 'path',
  Rectangle = 'rectangle',
  Circle = 'circle',
  Line = 'line',
  Polyline = 'polyline',
  Polygon = 'polygon',
  Group = 'g'
}

export interface PathElement extends ElementProperties {
  type: ElementType.Path
  commands: PathCommand[]
  parent:
    | PathElement
    | RectangleElement
    | CircleElement
    | LineElement
    | PolylineElement
    | PolygonElement
    | GroupElement
    | null
}

export interface RectangleElement extends ElementProperties {
  type: ElementType.Rectangle
  x: number
  y: number
  width: number
  height: number
  rx?: number
  ry?: number
  parent:
    | PathElement
    | RectangleElement
    | CircleElement
    | LineElement
    | PolylineElement
    | PolygonElement
    | GroupElement
    | null
}

export interface CircleElement extends ElementProperties {
  type: ElementType.Circle
  center: Point
  radius: number
  parent:
    | PathElement
    | RectangleElement
    | CircleElement
    | LineElement
    | PolylineElement
    | PolygonElement
    | GroupElement
    | null
}

export interface LineElement extends ElementProperties {
  type: ElementType.Line
  start: Point
  end: Point
  parent:
    | PathElement
    | RectangleElement
    | CircleElement
    | LineElement
    | PolylineElement
    | PolygonElement
    | GroupElement
    | null
}

export interface PolylineElement extends ElementProperties {
  type: ElementType.Polyline
  points: Point[]
  parent:
    | PathElement
    | RectangleElement
    | CircleElement
    | LineElement
    | PolylineElement
    | PolygonElement
    | GroupElement
    | null
}

export interface PolygonElement extends ElementProperties {
  type: ElementType.Polygon
  points: Point[]
  parent:
    | PathElement
    | RectangleElement
    | CircleElement
    | LineElement
    | PolylineElement
    | PolygonElement
    | GroupElement
    | null
}

export interface GroupElement extends ElementProperties {
  type: ElementType.Group
  children: Element[]
  parent:
    | PathElement
    | RectangleElement
    | CircleElement
    | LineElement
    | PolylineElement
    | PolygonElement
    | GroupElement
    | null
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
