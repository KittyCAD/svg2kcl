import { describe, expect, it } from '@jest/globals'
import { getBezierArcIntersection, Bezier, Arc } from '../../src/intersections/intersections'

const bezierLine = (x0: number, y0: number, x1: number, y1: number): Bezier => {
  // Control points chosen so the cubic is a straight line segment
  return {
    start: { x: x0, y: y0 },
    control1: { x: (2 * x0 + x1) / 3, y: (2 * y0 + y1) / 3 },
    control2: { x: (x0 + 2 * x1) / 3, y: (y0 + 2 * y1) / 3 },
    end: { x: x1, y: y1 }
  }
}

describe('Bezier-Arc intersections', () => {
  it('cubic arc intersection', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 4,
      startAngle: 0,
      endAngle: Math.PI,
      clockwise: false
    }

    // Looping cubic going up and back down through the arc
    const bez: Bezier = {
      start: { x: -6, y: 0 },
      control1: { x: -2, y: 12 },
      control2: { x: 2, y: -12 },
      end: { x: 6, y: 0 }
    }

    const hits = getBezierArcIntersection(bez, arc)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    hits.forEach(({ point }) => {
      const dist = Math.hypot(point.x, point.y)
      expect(dist).toBeCloseTo(arc.radius, 4)
    })
  })

  it('detects a single point of grazing contact', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: Math.PI / 4,
      endAngle: (3 * Math.PI) / 4,
      clockwise: false
    }

    // Horizontal "line" tangent to top of circle at (0, 5)
    const bez: Bezier = {
      start: { x: -8, y: 5 },
      control1: { x: -8 / 3, y: 5 }, // Straight line: control points on the line
      control2: { x: 8 / 3, y: 5 },
      end: { x: 8, y: 5 }
    }

    const hits = getBezierArcIntersection(bez, arc)
    expect(hits).toHaveLength(1)
    expect(hits[0].point.x).toBeCloseTo(0, 6)
    expect(hits[0].point.y).toBeCloseTo(5, 6)
  })

  it('intersects an arc with a sweep > 2π (more than full circle)', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 3,
      startAngle: 0,
      endAngle: 4 * Math.PI, // two full circles!
      clockwise: false
    }

    const bez = bezierLine(-5, 0, 5, 0) // horizontal

    const hits = getBezierArcIntersection(bez, arc)
    expect(hits).toHaveLength(2)
    const xs = hits.map((h) => h.point.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-3, 4)
    expect(xs[1]).toBeCloseTo(3, 4)
  })

  it('intersects a full circle at all four cardinal axis crossings', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      clockwise: false
    }

    const vertical = bezierLine(0, -10, 0, 10)
    const horizontal = bezierLine(-10, 0, 10, 0)

    const verticalHits = getBezierArcIntersection(vertical, arc)
    const horizontalHits = getBezierArcIntersection(horizontal, arc)

    expect(verticalHits).toHaveLength(2)
    expect(horizontalHits).toHaveLength(2)

    expect(verticalHits.map((h) => h.point.y).sort()).toEqual(
      [-5, 5].map((v) => expect.any(Number))
    )
    expect(horizontalHits.map((h) => h.point.x).sort()).toEqual(
      [-5, 5].map((v) => expect.any(Number))
    )
  })

  it('respects reversed arc direction (CW sweep)', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 6,
      startAngle: 0,
      endAngle: (3 * Math.PI) / 2, // 270° CW
      clockwise: true
    }

    const bez = bezierLine(0, 10, 0, -10)

    const hits = getBezierArcIntersection(bez, arc)
    expect(hits).toHaveLength(1)

    const ys = hits.map((h) => h.point.y).sort((a, b) => a - b)
    expect(ys[0]).toBeCloseTo(-6, 5)
    expect(ys[1]).toBeCloseTo(6, 5)
  })

  it('handles near-miss grazing case with very tight tolerance', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: Math.PI / 2,
      endAngle: Math.PI,
      clockwise: false
    }

    // Just grazes the edge (5 - 1e-6)
    const bez = bezierLine(-10, 5 - 1e-6, 10, 5 - 1e-6)

    const hits = getBezierArcIntersection(bez, arc)
    expect(hits).toHaveLength(1)
    expect(hits[0].point.y).toBeCloseTo(5)
  })
})
