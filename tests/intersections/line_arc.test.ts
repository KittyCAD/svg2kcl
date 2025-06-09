import { describe, expect, it } from '@jest/globals'
import { getLineArcIntersection, Line, Arc } from '../../src/intersections/intersections'

const hLine = (y: number, x0 = -10, x1 = 10): Line => ({
  start: { x: x0, y },
  end: { x: x1, y }
})
const vLine = (x: number, y0 = -10, y1 = 10): Line => ({
  start: { x, y: y0 },
  end: { x, y: y1 }
})

describe('Line-Arc intersections', () => {
  it('finds both chord intersections on the upper semicircle', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0, // 0 rad → (5,0)
      endAngle: Math.PI, // π rad → (-5,0)
      clockwise: false // CCW → upper half-circle
    }
    const line = hLine(3) // y = 3 crosses twice

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(2)
    hits.forEach(({ t1, t2, point }) => {
      expect(t1).toBeGreaterThanOrEqual(0)
      expect(t1).toBeLessThanOrEqual(1)
      expect(t2).toBeGreaterThanOrEqual(0)
      expect(t2).toBeLessThanOrEqual(1)
      expect(point.y).toBeCloseTo(3, 6)
    })
  })

  it('returns empty array when segment lies outside the arc sweep', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI,
      clockwise: false // upper half only
    }
    const line = hLine(-3) // y = –3 cuts the *lower* half

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(0)
  })

  it('detects a single tangent hit', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI,
      clockwise: false
    }
    const line = hLine(5) // y = 5 touches at (0,5)

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(1)
    const hit = hits[0]
    expect(hit.point.x).toBeCloseTo(0, 6)
    expect(hit.point.y).toBeCloseTo(5, 6)
    expect(hit.t1).toBeGreaterThanOrEqual(0)
    expect(hit.t1).toBeLessThanOrEqual(1)
    expect(hit.t2).toBeGreaterThanOrEqual(0)
    expect(hit.t2).toBeLessThanOrEqual(1)
  })

  it('respects clockwise sweeps (large CW arc)', () => {
    /*  Clockwise from 0 → π/2 sweeps 270°, so it includes (-5,0).  */
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: Math.PI / 2, // 90°
      clockwise: true // CW ⇒ 270° sweep
    }
    const line = vLine(-5) // x = -5 intersects at (-5,0)

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(1)
    const hit = hits[0]
    expect(hit.point.x).toBeCloseTo(-5, 6)
    expect(hit.point.y).toBeCloseTo(0, 6)
    expect(hit.t2).toBeGreaterThanOrEqual(0)
    expect(hit.t2).toBeLessThanOrEqual(1)
  })

  it('returns empty array for a zero-length segment', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      endAngle: 2 * Math.PI,
      clockwise: false // Full circle
    }
    // Degenerate "line": a single point outside the circle
    const line: Line = {
      start: { x: 6, y: 0 },
      end: { x: 6, y: 0 }
    }

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(0)
  })
})
