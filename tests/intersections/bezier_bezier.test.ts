import { describe, expect, it } from '@jest/globals'
import { getBezierBezierIntersection, Bezier } from '../../src/intersections/intersections'

describe('Bezier-Bezier intersections', () => {
  it('finds a single transversal intersection', () => {
    const a: Bezier = {
      start: { x: 1, y: 0 },
      control1: { x: 1, y: 4 },
      control2: { x: 5, y: 4 },
      end: { x: 5, y: 0 }
    }
    const b: Bezier = {
      start: { x: 0, y: 3 },
      control1: { x: 3, y: -1 },
      control2: { x: 3, y: 5 },
      end: { x: 6, y: 1 }
    }

    const hits = getBezierBezierIntersection(a, b)
    expect(hits.length).toBeGreaterThan(0)
    hits.forEach(({ t1, t2 }) => {
      expect(t1).toBeGreaterThanOrEqual(0)
      expect(t1).toBeLessThanOrEqual(1)
      expect(t2).toBeGreaterThanOrEqual(0)
      expect(t2).toBeLessThanOrEqual(1)
    })
  })

  it('returns empty array when curves do not intersect', () => {
    const a: Bezier = {
      start: { x: 0, y: 0 },
      control1: { x: 3, y: 2 },
      control2: { x: 6, y: 2 },
      end: { x: 9, y: 0 }
    }
    const b: Bezier = {
      start: { x: 0, y: 5 },
      control1: { x: 3, y: 7 },
      control2: { x: 6, y: 7 },
      end: { x: 9, y: 5 }
    }

    const hits = getBezierBezierIntersection(a, b)
    expect(hits).toHaveLength(0)
  })

  it('detects intersection at shared start point', () => {
    const a: Bezier = {
      start: { x: 0, y: 0 },
      control1: { x: 2, y: 3 },
      control2: { x: 4, y: 3 },
      end: { x: 6, y: 0 }
    }
    const b: Bezier = {
      start: { x: 0, y: 0 }, // same start
      control1: { x: -2, y: -3 },
      control2: { x: -4, y: -3 },
      end: { x: -6, y: 0 }
    }

    const hits = getBezierBezierIntersection(a, b)
    const startHit = hits.find((h) => Math.abs(h.t1) < 0.01 && Math.abs(h.t2) < 0.01)
    expect(startHit).toBeDefined()
    if (startHit) {
      expect(startHit.point.x).toBeCloseTo(0)
      expect(startHit.point.y).toBeCloseTo(0)
    }
  })

  it('detects multiple intersections for an “S” curve pair', () => {
    const a: Bezier = {
      start: { x: 1, y: 5 },
      control1: { x: 3, y: -2 },
      control2: { x: 7, y: 12 },
      end: { x: 9, y: 5 }
    }
    const b: Bezier = {
      start: { x: 1, y: 1 },
      control1: { x: 4, y: 11 },
      control2: { x: 6, y: -1 },
      end: { x: 9, y: 9 }
    }

    const hits = getBezierBezierIntersection(a, b)
    expect(hits.length).toBeGreaterThan(1)
    hits.forEach(({ t1, t2 }) => {
      expect(t1).toBeGreaterThanOrEqual(0)
      expect(t1).toBeLessThanOrEqual(1)
      expect(t2).toBeGreaterThanOrEqual(0)
      expect(t2).toBeLessThanOrEqual(1)
    })
  })
})
