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

const diagLine = (x0 = -10, y0 = -10, x1 = 10, y1 = 10): Line => ({
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 }
})

describe('Line-Arc intersections', () => {
  it('finds both chord intersections on the upper semicircle', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0, // 0 rad → (5,0)
      sweepAngle: Math.PI // π rad → (-5,0)
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
      sweepAngle: Math.PI // upper half only
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
      sweepAngle: Math.PI
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
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0,
      sweepAngle: -Math.PI // CW
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
      sweepAngle: 2 * Math.PI // Full circle
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

describe('Line-Arc extra intersection cases', () => {
  it('finds one hit where a diagonal line crosses a quarter circle', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0, // (5,0)
      sweepAngle: Math.PI / 2 // (0,5)
    }
    const line = diagLine() // y = x

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(1)

    const hit = hits[0]
    expect(hit.t1).toBeGreaterThanOrEqual(0)
    expect(hit.t1).toBeLessThanOrEqual(1)
    expect(hit.t2).toBeGreaterThanOrEqual(0)
    expect(hit.t2).toBeLessThanOrEqual(1)
    // analytic intersection: (r/√2, r/√2)
    const expected = 5 / Math.SQRT2
    expect(hit.point.x).toBeCloseTo(expected, 6)
    expect(hit.point.y).toBeCloseTo(expected, 6)
  })

  it('hits a *narrow* 15° arc only once, at its start point', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: Math.PI / 4, // 45°
      sweepAngle: Math.PI / 12 // 15°
    }
    // Same diagonal line y = x passes through start point only
    const line = diagLine()

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(1)
    // t2 should be ~0 (start of arc)
    expect(hits[0].t2).toBeCloseTo(0, 3)
  })

  it('finds two intersections on a full circle whose centre is off-origin', () => {
    const arc: Arc = {
      center: { x: 3, y: 2 },
      radius: 4,
      startAngle: 0,
      sweepAngle: 2 * Math.PI // full circle
    }
    const line = hLine(2, -10, 20) // through the centre, y = 2

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(2)

    // Expected x positions: centre.x ± radius
    const xs = hits.map((h) => h.point.x).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(-1, 6) // 3-4
    expect(xs[1]).toBeCloseTo(7, 6) // 3+4
    hits.forEach(({ t1, t2 }) => {
      expect(t1).toBeGreaterThanOrEqual(0)
      expect(t1).toBeLessThanOrEqual(1)
      expect(t2).toBeGreaterThanOrEqual(0)
      expect(t2).toBeLessThanOrEqual(1)
    })
  })

  it('returns zero hits when the line misses a small off-centre arc', () => {
    const arc: Arc = {
      center: { x: 3, y: 2 },
      radius: 4,
      startAngle: Math.PI / 2, // 90°
      sweepAngle: Math.PI / 2 // 180° - 90° = 90°
    }
    const line = vLine(7, -10, 10) // x = 7, right of the circle

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(0)
  })

  it('detects an intersection exactly at an arc end-point', () => {
    const arc: Arc = {
      center: { x: 0, y: 0 },
      radius: 5,
      startAngle: 0, // (5,0)
      sweepAngle: Math.PI / 2 // (0,5)
    }
    // Horizontal line through y = 0 intersects at (5,0) only
    const line = hLine(0)

    const hits = getLineArcIntersection(line, arc)
    expect(hits).toHaveLength(1)

    const hit = hits[0]
    expect(hit.point.x).toBeCloseTo(5, 6)
    expect(hit.point.y).toBeCloseTo(0, 6)
    // Arc parameter should be very close to 0 (start)
    expect(hit.t2).toBeLessThan(1e-3)
  })
})
