import {
  Circle,
  GeometricElementType,
  GeometricShape,
  Line,
  Polygon,
  Polyline,
  Rectangle
} from '../types/geometric'
import { RawSVGElement } from '../types/svg'

import { parseNumber, parsePoints } from '../parsers/values'
import { Transform } from '../utils/transform'

export class ShapeReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShapeReadError'
  }
}

export class ShapeReader {
  private readRectangle(element: RawSVGElement): Rectangle {
    return {
      type: GeometricElementType.Rectangle,
      x: parseNumber(element.attributes['x'], 'x'),
      y: parseNumber(element.attributes['y'], 'y'),
      width: parseNumber(element.attributes['width'], 'width'),
      height: parseNumber(element.attributes['height'], 'height'),
      rx: element.attributes['rx'] ? parseNumber(element.attributes['rx'], 'rx') : undefined,
      ry: element.attributes['ry'] ? parseNumber(element.attributes['ry'], 'ry') : undefined,
      transform: Transform.fromString(element.attributes['transform']),
      parentElement: null
    }
  }

  private readCircle(element: RawSVGElement): Circle {
    return {
      type: GeometricElementType.Circle,
      center: {
        x: parseNumber(element.attributes['cx'], 'cx'),
        y: parseNumber(element.attributes['cy'], 'cy')
      },
      radius: parseNumber(element.attributes['r'], 'r'),
      transform: Transform.fromString(element.attributes['transform']),
      parentElement: null
    }
  }

  private readLine(element: RawSVGElement): Line {
    return {
      type: GeometricElementType.Line,
      start: {
        x: parseNumber(element.attributes['x1'], 'x1'),
        y: parseNumber(element.attributes['y1'], 'y1')
      },
      end: {
        x: parseNumber(element.attributes['x2'], 'x2'),
        y: parseNumber(element.attributes['y2'], 'y2')
      },
      transform: Transform.fromString(element.attributes['transform']),
      parentElement: null
    }
  }

  private readPolyline(element: RawSVGElement): Polyline {
    const pointsStr = element.attributes['points']
    if (!pointsStr) {
      throw new ShapeReadError('Missing points attribute')
    }

    return {
      type: GeometricElementType.Polyline,
      points: parsePoints(pointsStr),
      transform: Transform.fromString(element.attributes['transform']),
      parentElement: null
    }
  }

  private readPolygon(element: RawSVGElement): Polygon {
    const pointsStr = element.attributes['points']
    if (!pointsStr) {
      throw new ShapeReadError('Missing points attribute')
    }

    return {
      type: GeometricElementType.Polygon,
      points: parsePoints(pointsStr),
      transform: Transform.fromString(element.attributes['transform']),
      parentElement: null
    }
  }

  public read(element: RawSVGElement): GeometricShape {
    switch (element.type) {
      case 'rect':
        return this.readRectangle(element)
      case 'circle':
        return this.readCircle(element)
      case 'line':
        return this.readLine(element)
      case 'polyline':
        return this.readPolyline(element)
      case 'polygon':
        return this.readPolygon(element)
      default:
        throw new ShapeReadError(`Unsupported shape type: ${element.type}`)
    }
  }
}
