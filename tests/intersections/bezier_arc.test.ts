import { describe, expect, it } from 'vitest'
import { getBezierArcIntersection, Arc } from '../../src/intersections/intersections'
import { Bezier } from '../../src/bezier/core'

const bezierLine = (x0: number, y0: number, x1: number, y1: number): Bezier => {
  // Control points chosen so the cubic is a straight line segment for degeneracy testing.
  return Bezier.cubic({
    start: { x: x0, y: y0 },
    control1: { x: (2 * x0 + x1) / 3, y: (2 * y0 + y1) / 3 },
    control2: { x: (x0 + 2 * x1) / 3, y: (y0 + 2 * y1) / 3 },
    end: { x: x1, y: y1 }
  })
}

describe('Bezier-Arc intersections', () => {
  it('cubic arc intersection', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 4,
      startAngle: 0,
      sweepAngle: Math.PI
    }

    // Looping cubic going up and back down through the arc
    const bez = Bezier.cubic({
      start: { x: -6, y: 0 },
      control1: { x: -2, y: 12 },
      control2: { x: 2, y: -12 },
      end: { x: 6, y: 0 }
    })

    const hits = getBezierArcIntersection(bez, arc)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    hits.forEach(({ point }) => {
      const dist = Math.hypot(point.x, point.y)
      expect(dist).toBeCloseTo(arc.radius, 4)
    })
  })

  it('intersects an arc with a sweep > 2π (more than full circle)', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 3,
      startAngle: 0,
      sweepAngle: 4 * Math.PI
    }

    const bez = Bezier.cubic({
      start: { x: -5, y: 0 },
      control1: { x: -2.5, y: 3 },
      control2: { x: 2.5, y: -3 },
      end: { x: 5, y: 0 }
    })

    const hits = getBezierArcIntersection(bez, arc)
    expect(hits).toHaveLength(2)
    const xs = hits.map((h) => h.point.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-2.8, 0.8)
    expect(xs[1]).toBeCloseTo(2.8, -0.8)
  })

  it('respects reversed arc direction (CW sweep)', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 6,
      startAngle: 0,
      sweepAngle: -(3 * Math.PI) / 2 // 270° CW
    }

    const bez = Bezier.cubic({
      start: { x: 2, y: 10 },
      control1: { x: 1, y: 3 },
      control2: { x: -1, y: 1 },
      end: { x: 2, y: -10 }
    })

    const hits = getBezierArcIntersection(bez, arc)
    expect(hits).toHaveLength(1)

    const ys = hits.map((h) => h.point.y).sort((a, b) => a - b)
    expect(ys[0]).toBeCloseTo(1, -5.9)
  })
})

describe('Degenerate Bezier-Arc intersections', () => {
  it('detects a single point of grazing contact from degenerate line', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: Math.PI / 4,
      sweepAngle: (3 * Math.PI) / 4 - Math.PI / 4
    }

    // Horizontal "line" tangent to top of circle at (0, 5).
    const bez = bezierLine(-8, 5, 8, 5)
    const hits = getBezierArcIntersection(bez, arc)
    expect(hits).toHaveLength(1)
    expect(hits[0].point.x).toBeCloseTo(0, 6)
    expect(hits[0].point.y).toBeCloseTo(5, 6)
  })

  it('intersects a full circle at all four cardinal axis crossings', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      sweepAngle: 2 * Math.PI
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
})
