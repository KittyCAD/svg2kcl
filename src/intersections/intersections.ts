const EPSILON = 1e-6

export interface Point {
  x: number
  y: number
}

export interface Line {
  start: Point
  end: Point
}

export interface Bezier {
  // We'll use cubic representation for both cubes and quads.
  start: Point
  control1: Point
  control2: Point
  end: Point
}

export interface Arc {
  center: Point
  radius: number
  startAngle: number
  endAngle: number
  clockwise?: boolean
}

export interface Intersection {
  point: Point
  t1: number
  t2: number
}

// Utilities.
function solveQuadratic(a: number, b: number, c: number): number[] {
  // Quadratic formula: x = (-b ± sqrt(b² - 4ac)) / (2a)
  // Thank you Mr. Collins, I actually even remember this one.
  if (Math.abs(a) < EPSILON) {
    return Math.abs(b) < EPSILON ? [] : [-c / b]
  }

  const discriminant = Math.pow(b, 2) - 4 * a * c
  if (discriminant < -EPSILON) {
    return []
  }
  if (Math.abs(discriminant) < EPSILON) {
    return [-b / (2 * a)]
  }

  const sqrt_d = Math.sqrt(discriminant)
  return [(-b - sqrt_d) / (2 * a), (-b + sqrt_d) / (2 * a)]
}

function solveCubic(a: number, b: number, c: number, d: number): number[] {
  // This is a little more gnarly.
  // See: https://math.vanderbilt.edu/schectex/courses/cubic/
  // See: https://people.eecs.berkeley.edu/~wkahan/Math128/Cubic.pdf
  if (Math.abs(a) < EPSILON) {
    return solveQuadratic(b, c, d)
  }

  const p = c / a - (b * b) / (3 * a * a)
  const q = (2 * b * b * b) / (27 * a * a * a) - (b * c) / (3 * a * a) + d / a
  const discriminant = (q * q) / 4 + (p * p * p) / 27

  if (discriminant > EPSILON) {
    const sqrt_d = Math.sqrt(discriminant)
    const u = Math.cbrt(-q / 2 + sqrt_d)
    const v = Math.cbrt(-q / 2 - sqrt_d)
    return [u + v - b / (3 * a)]
  } else if (Math.abs(discriminant) < EPSILON) {
    if (Math.abs(q) < EPSILON) {
      return [-b / (3 * a)]
    } else {
      const temp = Math.cbrt(-q / 2)
      return [2 * temp - b / (3 * a), -temp - b / (3 * a)]
    }
  } else {
    const rho = Math.sqrt(-(p * p * p) / 27)
    const theta = Math.acos(-q / (2 * rho))
    const offset = -b / (3 * a)
    const factor = 2 * Math.cbrt(rho)

    return [
      factor * Math.cos(theta / 3) + offset,
      factor * Math.cos((theta + 2 * Math.PI) / 3) + offset,
      factor * Math.cos((theta + 4 * Math.PI) / 3) + offset
    ]
  }
}

function evaluateBezier(t: number, bezier: Bezier): Point {
  const mt = 1 - t
  const mt2 = mt * mt
  const mt3 = mt2 * mt
  const t2 = t * t
  const t3 = t2 * t

  return {
    x:
      mt3 * bezier.start.x +
      3 * mt2 * t * bezier.control1.x +
      3 * mt * t2 * bezier.control2.x +
      t3 * bezier.end.x,
    y:
      mt3 * bezier.start.y +
      3 * mt2 * t * bezier.control1.y +
      3 * mt * t2 * bezier.control2.y +
      t3 * bezier.end.y
  }
}

export function quadraticToCubic(start: Point, control: Point, end: Point): Bezier {
  return {
    start,
    control1: {
      x: start.x + (2 / 3) * (control.x - start.x),
      y: start.y + (2 / 3) * (control.y - start.y)
    },
    control2: {
      x: end.x + (2 / 3) * (control.x - end.x),
      y: end.y + (2 / 3) * (control.y - end.y)
    },
    end
  }
}

// Intersection functions.
export function getLineLineIntersection(line1: Line, line2: Line): Intersection[] {
  const d1x = line1.end.x - line1.start.x
  const d1y = line1.end.y - line1.start.y
  const d2x = line2.end.x - line2.start.x
  const d2y = line2.end.y - line2.start.y

  const denominator = d1x * d2y - d1y * d2x

  if (Math.abs(denominator) < EPSILON) {
    return []
  }

  const dx = line2.start.x - line1.start.x
  const dy = line2.start.y - line1.start.y

  const t1 = (dx * d2y - dy * d2x) / denominator
  const t2 = (dx * d1y - dy * d1x) / denominator

  if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) {
    const point = {
      x: line1.start.x + t1 * d1x,
      y: line1.start.y + t1 * d1y
    }

    return [{ point, t1, t2 }]
  }

  return []
}

export function getLineBezierIntersection(line: Line, bezier: Bezier): Intersection[] {
  const A = line.start.y - line.end.y
  const B = line.end.x - line.start.x
  const C = line.start.x * line.end.y - line.end.x * line.start.y

  const bx0 = bezier.start.x
  const bx1 = bezier.control1.x
  const bx2 = bezier.control2.x
  const bx3 = bezier.end.x

  const by0 = bezier.start.y
  const by1 = bezier.control1.y
  const by2 = bezier.control2.y
  const by3 = bezier.end.y

  const c3 = A * (-bx0 + 3 * bx1 - 3 * bx2 + bx3) + B * (-by0 + 3 * by1 - 3 * by2 + by3)
  const c2 = A * (3 * bx0 - 6 * bx1 + 3 * bx2) + B * (3 * by0 - 6 * by1 + 3 * by2)
  const c1 = A * (-3 * bx0 + 3 * bx1) + B * (-3 * by0 + 3 * by1)
  const c0 = A * bx0 + B * by0 + C

  const roots = solveCubic(c3, c2, c1, c0)
  const intersections: Intersection[] = []

  for (const t of roots) {
    if (t >= -EPSILON && t <= 1 + EPSILON) {
      const bezierPoint = evaluateBezier(t, bezier)

      const lineDir = { x: line.end.x - line.start.x, y: line.end.y - line.start.y }
      const lineLength = Math.sqrt(lineDir.x * lineDir.x + lineDir.y * lineDir.y)

      if (lineLength < EPSILON) continue

      const toPoint = { x: bezierPoint.x - line.start.x, y: bezierPoint.y - line.start.y }
      const lineT = (toPoint.x * lineDir.x + toPoint.y * lineDir.y) / (lineLength * lineLength)

      if (lineT >= -EPSILON && lineT <= 1 + EPSILON) {
        intersections.push({
          point: bezierPoint,
          t1: Math.max(0, Math.min(1, lineT)),
          t2: Math.max(0, Math.min(1, t))
        })
      }
    }
  }

  return intersections
}
export function getLineArcIntersection(line: Line, arc: Arc): Intersection[] {
  return []
}

export function getBezierBezierIntersection(bezier1: Bezier, bezier2: Bezier): Intersection[] {
  return []
}

export function getBezierArcIntersection(bezier: Bezier, arc: Arc): Intersection[] {
  return []
}

export function getArcArcIntersection(arc1: Arc, arc2: Arc): Intersection[] {
  return []
}
