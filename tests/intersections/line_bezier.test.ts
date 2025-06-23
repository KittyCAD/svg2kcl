import { describe, expect, it } from '@jest/globals'
import { getLineBezierIntersection, Line } from '../../src/intersections/intersections'
import { Bezier } from '../../src/bezier/core'

describe('Line-Bezier Intersections', () => {
  it('should find intersection of line crossing through bezier curve', () => {
    const line: Line = {
      start: { x: 0, y: 5 },
      end: { x: 10, y: 5 }
    }
    const bezier = Bezier.cubic({
      start: { x: 2, y: 0 },
      control1: { x: 2, y: 10 },
      control2: { x: 8, y: 10 },
      end: { x: 8, y: 0 }
    })

    const result = getLineBezierIntersection(line, bezier)

    expect(result.length).toBeGreaterThan(0)
    result.forEach((intersection) => {
      expect(intersection.point.y).toBeCloseTo(5)
      expect(intersection.t1).toBeGreaterThanOrEqual(0)
      expect(intersection.t1).toBeLessThanOrEqual(1)
      expect(intersection.t2).toBeGreaterThanOrEqual(0)
      expect(intersection.t2).toBeLessThanOrEqual(1)
    })
  })

  it('should return empty array for line not intersecting bezier', () => {
    const line: Line = {
      start: { x: 0, y: -5 },
      end: { x: 10, y: -5 }
    }
    const bezier = Bezier.cubic({
      start: { x: 2, y: 0 },
      control1: { x: 4, y: 2 },
      control2: { x: 6, y: 2 },
      end: { x: 8, y: 0 }
    })

    const result = getLineBezierIntersection(line, bezier)

    expect(result).toHaveLength(0)
  })

  it('should find intersection at bezier start point', () => {
    const line: Line = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 5 }
    }
    const bezier = Bezier.cubic({
      start: { x: 4, y: 2 },
      control1: { x: 6, y: 4 },
      control2: { x: 8, y: 6 },
      end: { x: 10, y: 8 }
    })

    const result = getLineBezierIntersection(line, bezier)

    expect(result.length).toBeGreaterThan(0)
    const startIntersection = result.find((r) => Math.abs(r.t2) < 0.01)
    expect(startIntersection).toBeDefined()
    if (startIntersection) {
      expect(startIntersection.point.x).toBeCloseTo(4)
      expect(startIntersection.point.y).toBeCloseTo(2)
    }
  })

  it('should find intersection at bezier end point', () => {
    const line: Line = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 }
    }
    const bezier = Bezier.cubic({
      start: { x: 0, y: 5 },
      control1: { x: 3, y: 7 },
      control2: { x: 7, y: 9 },
      end: { x: 8, y: 8 }
    })

    const result = getLineBezierIntersection(line, bezier)

    expect(result.length).toBeGreaterThan(0)
    const endIntersection = result.find((r) => Math.abs(r.t2 - 1) < 0.01)
    expect(endIntersection).toBeDefined()
    if (endIntersection) {
      expect(endIntersection.point.x).toBeCloseTo(8)
      expect(endIntersection.point.y).toBeCloseTo(8)
    }
  })

  it('should handle straight line bezier (degenerate case)', () => {
    const line: Line = {
      start: { x: 0, y: 5 },
      end: { x: 10, y: 5 }
    }
    const bezier = Bezier.cubic({
      start: { x: 2, y: 0 },
      control1: { x: 4, y: 3.33 },
      control2: { x: 6, y: 6.67 },
      end: { x: 8, y: 10 }
    })

    const result = getLineBezierIntersection(line, bezier)

    expect(result.length).toBeGreaterThan(0)
    result.forEach((intersection) => {
      expect(intersection.point.y).toBeCloseTo(5)
    })
  })

  it('should find multiple intersections for complex bezier', () => {
    const line: Line = {
      start: { x: 0, y: 5 },
      end: { x: 10, y: 5 }
    }
    const bezier = Bezier.cubic({
      start: { x: 1, y: 5 },
      control1: { x: 3, y: 0 },
      control2: { x: 7, y: 10 },
      end: { x: 9, y: 5 }
    })

    const result = getLineBezierIntersection(line, bezier)

    expect(result.length).toBeGreaterThan(1)
    result.forEach((intersection) => {
      expect(intersection.point.y).toBeCloseTo(5)
      expect(intersection.t1).toBeGreaterThanOrEqual(0)
      expect(intersection.t1).toBeLessThanOrEqual(1)
      expect(intersection.t2).toBeGreaterThanOrEqual(0)
      expect(intersection.t2).toBeLessThanOrEqual(1)
    })
  })

  it('should return empty array for line parallel to bezier tangent', () => {
    const line: Line = {
      start: { x: 0, y: 15 },
      end: { x: 10, y: 15 }
    }
    const bezier = Bezier.cubic({
      start: { x: 2, y: 0 },
      control1: { x: 4, y: 2 },
      control2: { x: 6, y: 4 },
      end: { x: 8, y: 6 }
    })

    const result = getLineBezierIntersection(line, bezier)

    expect(result).toHaveLength(0)
  })
})
