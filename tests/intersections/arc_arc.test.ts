import { describe, expect, it } from '@jest/globals'
import { getArcArcIntersection, Arc } from '../../src/intersections/intersections'

const fullCircle = (center: { x: number; y: number }, radius: number): Arc => ({
  center,
  radius,
  startAngle: 0,
  endAngle: 2 * Math.PI,
  clockwise: false
})

const quarterArc = (center: { x: number; y: number }, radius: number, startAngle: number): Arc => ({
  center,
  radius,
  startAngle,
  endAngle: startAngle + Math.PI / 2,
  clockwise: false
})

const semicircle = (center: { x: number; y: number }, radius: number, upper = true): Arc => ({
  center,
  radius,
  startAngle: upper ? 0 : Math.PI,
  endAngle: upper ? Math.PI : 2 * Math.PI,
  clockwise: false
})

describe('Arc-Arc intersections', () => {
  it('finds one intersection point between two partial arcs', () => {
    // Two quarter circles that touch at one point
    const arc1: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI / 3,
      clockwise: false
    }
    const arc2: Arc = {
      center: { x: 5, y: 5 },
      radius: 5,
      startAngle: Math.PI,
      endAngle: (3 * Math.PI) / 2,
      clockwise: false
    }

    const hits = getArcArcIntersection(arc1, arc2)
    expect(hits).toHaveLength(1)

    const hit = hits[0]
    expect(hit.point.x).toBeCloseTo(5)
    expect(hit.point.y).toBeCloseTo(0)
    expect(hit.t1).toBeGreaterThanOrEqual(0)
    expect(hit.t1).toBeLessThanOrEqual(1)
    expect(hit.t2).toBeGreaterThanOrEqual(0)
    expect(hit.t2).toBeLessThanOrEqual(1)
  })

  it('finds one intersection point between two full circles (externally tangent)', () => {
    const circle1 = fullCircle({ x: 0, y: 0 }, 3)
    const circle2 = fullCircle({ x: 6, y: 0 }, 3) // Distance = 6 = 3 + 3

    const hits = getArcArcIntersection(circle1, circle2)
    expect(hits).toHaveLength(1)

    const hit = hits[0]
    expect(hit.point.x).toBeCloseTo(3, 6)
    expect(hit.point.y).toBeCloseTo(0, 6)
    expect(hit.t1).toBeGreaterThanOrEqual(0)
    expect(hit.t1).toBeLessThanOrEqual(1)
    expect(hit.t2).toBeGreaterThanOrEqual(0)
    expect(hit.t2).toBeLessThanOrEqual(1)
  })

  it('finds one intersection point between one arc and one full circle (internally tangent)', () => {
    // ACTUAL BUG IN THIS OUTPUT INTERSECTION POINT
    const circle = fullCircle({ x: 0, y: 0 }, 5)
    const arc: Arc = {
      center: { x: 2, y: 0 },
      radius: 3,
      startAngle: 0,
      endAngle: Math.PI,
      clockwise: false
    }

    const hits = getArcArcIntersection(arc, circle)
    expect(hits).toHaveLength(1)

    const hit = hits[0]

    // Fail.
    expect(hit.point.x).toBeCloseTo(5)
    expect(hit.point.y).toBeCloseTo(0)
    expect(hit.t1).toBeGreaterThanOrEqual(0)
    expect(hit.t1).toBeLessThanOrEqual(1)
    expect(hit.t2).toBeGreaterThanOrEqual(0)
    expect(hit.t2).toBeLessThanOrEqual(1)
  })

  it('finds two intersection points between two full circles', () => {
    const circle1 = fullCircle({ x: 0, y: 0 }, 5)
    const circle2 = fullCircle({ x: 6, y: 0 }, 5) // Distance = 6 < 5 + 5

    const hits = getArcArcIntersection(circle1, circle2)
    expect(hits).toHaveLength(2)

    hits.forEach((hit) => {
      expect(hit.point.x).toBeCloseTo(3, 6) // Midpoint between centers
      expect(hit.t1).toBeGreaterThanOrEqual(0)
      expect(hit.t1).toBeLessThanOrEqual(1)
      expect(hit.t2).toBeGreaterThanOrEqual(0)
      expect(hit.t2).toBeLessThanOrEqual(1)
    })

    // Check y-coordinates are symmetric
    const ys = hits.map((h) => h.point.y).sort((a, b) => a - b)
    expect(ys[0]).toBeCloseTo(-4, 6) // -sqrt(5² - 3²) = -4
    expect(ys[1]).toBeCloseTo(4, 6) // +4
  })

  it('finds one intersection points between arc and full circle', () => {
    const circle = fullCircle({ x: 0, y: 0 }, 5)
    const arc = semicircle({ x: 3, y: 0 }, 4, true) // Upper semicircle

    const hits = getArcArcIntersection(arc, circle)
    expect(hits).toHaveLength(1)

    const hit = hits[0]
    expect(hit.point.x).toBeCloseTo(3)
    expect(hit.point.y).toBeCloseTo(4)
  })

  it('returns no intersections for concentric circles', () => {
    const circle1 = fullCircle({ x: 2, y: 3 }, 5)
    const circle2 = fullCircle({ x: 2, y: 3 }, 8) // Same center, different radii

    const hits = getArcArcIntersection(circle1, circle2)
    expect(hits).toHaveLength(0)
  })

  it('returns no intersections when circles do not touch', () => {
    const circle1 = fullCircle({ x: 0, y: 0 }, 3)
    const circle2 = fullCircle({ x: 10, y: 0 }, 3) // Distance = 10 > 3 + 3

    const hits = getArcArcIntersection(circle1, circle2)
    expect(hits).toHaveLength(0)
  })

  it('returns no intersections when one circle is inside another', () => {
    const outerCircle = fullCircle({ x: 0, y: 0 }, 10)
    const innerCircle = fullCircle({ x: 2, y: 0 }, 3) // Distance = 2 < 10 - 3

    const hits = getArcArcIntersection(outerCircle, innerCircle)
    expect(hits).toHaveLength(0)
  })

  it('handles intersection at arc endpoints correctly', () => {
    const arc1: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0, // (5,0)
      endAngle: Math.PI / 2, // (0,5)
      clockwise: false
    }
    const arc2: Arc = {
      center: { x: 10, y: 0 },
      radius: 5,
      startAngle: Math.PI / 2, // (10,5)
      endAngle: Math.PI, // (5,0)
      clockwise: false
    }

    const hits = getArcArcIntersection(arc1, arc2)
    expect(hits).toHaveLength(1)

    const hit = hits[0]
    expect(hit.point.x).toBeCloseTo(5, 6)
    expect(hit.point.y).toBeCloseTo(0, 6)
    // Should be at endpoint of first arc (t1 ≈ 0) and endpoint of second arc (t2 ≈ 1)
    expect(hit.t1).toBeLessThan(1e-3)
    expect(hit.t2).toBeGreaterThan(1 - 1e-3)
  })

  it('respects clockwise arc directions', () => {
    const arc1: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: (3 / 2) * Math.PI,
      endAngle: 2 * Math.PI,
      clockwise: true
    }
    const arc2: Arc = {
      center: { x: 5, y: 0 },
      radius: 5,
      startAngle: Math.PI / 2,
      endAngle: Math.PI,
      clockwise: false
    }

    const hits = getArcArcIntersection(arc1, arc2)
    expect(hits).toHaveLength(1)

    const hit = hits[0]
    expect(hit.point.x).toBeCloseTo(2.5)
    expect(hit.point.y).toBeCloseTo(4.33)
    expect(hit.t1).toBeGreaterThanOrEqual(0)
    expect(hit.t1).toBeLessThanOrEqual(1)
    expect(hit.t2).toBeGreaterThanOrEqual(0)
    expect(hit.t2).toBeLessThanOrEqual(1)
  })

  it('handles very small arcs correctly', () => {
    // Two tiny arcs that barely touch
    const arc1: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: 0.1, // Very small arc
      clockwise: false
    }
    const arc2: Arc = {
      center: { x: 8, y: 0 },
      radius: 5,
      startAngle: Math.PI - 0.1,
      endAngle: Math.PI, // Very small arc
      clockwise: false
    }

    const hits = getArcArcIntersection(arc1, arc2)
    // These small arcs don't actually intersect in this configuration
    expect(hits).toHaveLength(0)
  })

  it('handles identical overlapping arcs', () => {
    const arc1: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI,
      clockwise: false
    }
    const arc2: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI,
      clockwise: false
    }

    const hits = getArcArcIntersection(arc1, arc2)
    // Identical arcs should return no intersections (infinite overlap case)
    expect(hits).toHaveLength(0)
  })
})
