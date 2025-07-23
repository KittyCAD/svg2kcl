import { describe, expect, it } from 'vitest'
import { getLineLineIntersection, Line } from '../../src/intersections/intersections'

describe('Line-Line Intersections', () => {
  it('should find intersection of crossing lines', () => {
    const line1: Line = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 }
    }
    const line2: Line = {
      start: { x: 0, y: 10 },
      end: { x: 10, y: 0 }
    }

    const result = getLineLineIntersection(line1, line2)

    expect(result).toHaveLength(1)
    expect(result[0].point.x).toBeCloseTo(5)
    expect(result[0].point.y).toBeCloseTo(5)
    expect(result[0].t1).toBeCloseTo(0.5)
    expect(result[0].t2).toBeCloseTo(0.5)
  })

  it('should return empty array for parallel lines', () => {
    const line1: Line = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 }
    }
    const line2: Line = {
      start: { x: 0, y: 5 },
      end: { x: 10, y: 5 }
    }

    const result = getLineLineIntersection(line1, line2)

    expect(result).toHaveLength(0)
  })

  it('should return empty array for non-intersecting lines', () => {
    const line1: Line = {
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 }
    }
    const line2: Line = {
      start: { x: 2, y: 2 },
      end: { x: 3, y: 3 }
    }

    const result = getLineLineIntersection(line1, line2)

    expect(result).toHaveLength(0)
  })

  it('should find intersection at line endpoints', () => {
    const line1: Line = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 }
    }
    const line2: Line = {
      start: { x: 10, y: -5 },
      end: { x: 10, y: 5 }
    }

    const result = getLineLineIntersection(line1, line2)

    expect(result).toHaveLength(1)
    expect(result[0].point.x).toBeCloseTo(10)
    expect(result[0].point.y).toBeCloseTo(0)
    expect(result[0].t1).toBeCloseTo(1)
    expect(result[0].t2).toBeCloseTo(0.5)
  })

  it('should handle vertical and horizontal lines', () => {
    const line1: Line = {
      start: { x: 5, y: 0 },
      end: { x: 5, y: 10 }
    }
    const line2: Line = {
      start: { x: 0, y: 3 },
      end: { x: 10, y: 3 }
    }

    const result = getLineLineIntersection(line1, line2)

    expect(result).toHaveLength(1)
    expect(result[0].point.x).toBeCloseTo(5)
    expect(result[0].point.y).toBeCloseTo(3)
    expect(result[0].t1).toBeCloseTo(0.3)
    expect(result[0].t2).toBeCloseTo(0.5)
  })

  it('should return empty array for coincident lines', () => {
    const line1: Line = {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 10 }
    }
    const line2: Line = {
      start: { x: 2, y: 2 },
      end: { x: 8, y: 8 }
    }

    const result = getLineLineIntersection(line1, line2)

    expect(result).toHaveLength(0)
  })

  it('should handle lines that would intersect if extended', () => {
    const line1: Line = {
      start: { x: 0, y: 0 },
      end: { x: 2, y: 2 }
    }
    const line2: Line = {
      start: { x: 4, y: 0 },
      end: { x: 6, y: 2 }
    }

    const result = getLineLineIntersection(line1, line2)

    expect(result).toHaveLength(0)
  })
})
