import { Point } from '../types/base'
import { ParseError } from './exceptions'

export function parseNumber(value: string | undefined, name: string): number {
  if (!value) {
    throw new ParseError(`Missing ${name} attribute`)
  }
  const num = parseFloat(value)
  if (isNaN(num)) {
    throw new ParseError(`Invalid ${name}: ${value}`)
  }
  return num
}

export function parsePoints(pointsStr: string): Point[] {
  return pointsStr
    .trim()
    .split(/[\s,]+/)
    .reduce((points: Point[], value: string, index: number) => {
      const num = parseFloat(value)
      if (isNaN(num)) {
        throw new ParseError(`Invalid point value: ${value}`)
      }

      const idx = Math.floor(index / 2)
      if (index % 2 === 0) {
        points[idx] = { x: num, y: 0 }
      } else {
        points[idx].y = num
      }
      return points
    }, [])
}
