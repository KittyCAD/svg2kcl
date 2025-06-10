import { allRootsCertified } from 'flo-poly'
import { Point } from '../types/base'
import { normalizeAngle, normalizeSweep } from './arc_helper'
import {
  BezierDegeneracyType,
  checkBezierDegeneracy,
  doBoxesOverlap,
  evaluateBezier,
  fatLineReject,
  getBezierBounds,
  makeFatLine,
  solveCubic,
  solveQuadratic,
  subdivideBezier
} from './bezier_helpers'
import {
  EPS_ANGLE_INTERSECTION,
  EPS_BBOX,
  EPS_INTERSECTION,
  EPS_ROOT_DUPE,
  MAX_RECURSION_DEPTH
} from './constants'
import { Plotter } from './plotter'

// Saves us a few sqrt calls in the line intersection check.
const EPS_INTERSECTION_SQUARED = Math.pow(EPS_INTERSECTION, 2)

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

// Arc is maybe a little confusing: angles are specified ACW, even if the arc is clockwise.
// So to sweep from 6 o'clock to 12 o'clock, you specify startAngle=3pi/2, endAngle=pi/2.
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

// Normalized arc type: always CCW, no `clockwise` property
export interface ArcNormalized {
  center: Point
  radius: number
  startAngle: number
  endAngle: number
}

export function normalizeArc(arc: Arc): ArcNormalized {
  // Convert all arcs to canonical ACW representation.
  if (arc.clockwise) {
    return {
      center: arc.center,
      radius: arc.radius,
      startAngle: arc.endAngle,
      endAngle: arc.startAngle
    }
  } else {
    return {
      center: arc.center,
      radius: arc.radius,
      startAngle: arc.startAngle,
      endAngle: arc.endAngle
    }
  }
}

// Intersection functions.
export function getLineLineIntersection(line1: Line, line2: Line): Intersection[] {
  const d1x = line1.end.x - line1.start.x
  const d1y = line1.end.y - line1.start.y
  const d2x = line2.end.x - line2.start.x
  const d2y = line2.end.y - line2.start.y

  const denominator = d1x * d2y - d1y * d2x

  // Exit early if lines are parallel or degenerate.
  if (
    Math.abs(denominator) < EPS_INTERSECTION ||
    Math.hypot(d1x, d1y) < EPS_INTERSECTION ||
    Math.hypot(d2x, d2y) < EPS_INTERSECTION
  ) {
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

    // Plotter.
    // --------------------------------------------------------------------------
    const xMin = Math.min(line1.start.x, line1.end.x, line2.start.x, line2.end.x)
    const xMax = Math.max(line1.start.x, line1.end.x, line2.start.x, line2.end.x)
    const yMin = Math.min(line1.start.y, line1.end.y, line2.start.y, line2.end.y)
    const yMax = Math.max(line1.start.y, line1.end.y, line2.start.y, line2.end.y)

    const plotter = new Plotter()
    plotter.clear()
    plotter.setBounds(xMin, yMin, xMax, yMax)

    plotter.plotLine(line1, 'blue')
    plotter.plotLine(line2, 'red')

    plotter.plotPoint(point, 'black')

    plotter.save('image.png')
    // --------------------------------------------------------------------------

    return [{ point, t1, t2 }]
  }

  return []
}

export function getLineBezierIntersection(line: Line, bezier: Bezier): Intersection[] {
  // Degeneracy check.
  const degType = checkBezierDegeneracy(bezier)
  switch (degType) {
    case BezierDegeneracyType.POINT:
      throw new Error('Degenerate Bézier found: all points are the same.')
    case BezierDegeneracyType.LINE:
      const bezierLine: Line = { start: bezier.start, end: bezier.end }
      return getLineLineIntersection(line, bezierLine)
    case BezierDegeneracyType.NORMAL:
      break
    default:
      throw new Error(`Degenerate Bézier found: unknown degeneracy type: ${degType}.`)
  }

  const intersections: Intersection[] = []

  // See: https://www.particleincell.com/2013/cubic-line-intersection/
  // See: https://pomax.github.io/bezierinfo/
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

  // Get the Bezier as a polynomial in t:
  // P(t) = A * (bx0 + 3 * bx1 * t + 3 * bx2 * t^2 + bx3 * t^3) + B * (by0 + 3 * by1 * t + 3 * by2 * t^2 + by3 * t^3) + C = 0
  const c3 = A * (-bx0 + 3 * bx1 - 3 * bx2 + bx3) + B * (-by0 + 3 * by1 - 3 * by2 + by3) // Cube
  const c2 = A * (3 * bx0 - 6 * bx1 + 3 * bx2) + B * (3 * by0 - 6 * by1 + 3 * by2) // Quad
  const c1 = A * (-3 * bx0 + 3 * bx1) + B * (-3 * by0 + 3 * by1) // Linear
  const c0 = A * bx0 + B * by0 + C // Constant

  const roots = solveCubic(c3, c2, c1, c0)

  const lineDirX = line.end.x - line.start.x
  const lineDirY = line.end.y - line.start.y
  const lineLenSquare = lineDirX * lineDirX + lineDirY * lineDirY

  if (lineLenSquare < EPS_INTERSECTION_SQUARED) {
    // Degenerate line (start == end), no intersection.
    return intersections
  }

  for (const t of roots) {
    if (t >= -EPS_INTERSECTION && t <= 1 + EPS_INTERSECTION) {
      const bezierPoint = evaluateBezier(t, bezier)

      // Vector from line start to the intersection candidate.
      const toPointX = bezierPoint.x - line.start.x
      const toPointY = bezierPoint.y - line.start.y

      // Param along the segment.
      const lineT = (toPointX * lineDirX + toPointY * lineDirY) / lineLenSquare

      if (lineT >= -EPS_INTERSECTION && lineT <= 1 + EPS_INTERSECTION) {
        intersections.push({
          point: bezierPoint,
          t1: Math.max(0, Math.min(1, lineT)),
          t2: Math.max(0, Math.min(1, t))
        })
      }
    }
  }

  // Plotter.
  // --------------------------------------------------------------------------
  const bezierBounds = getBezierBounds(bezier)
  const xMin = Math.min(line.start.x, line.end.x, bezierBounds.xMin)
  const xMax = Math.max(line.start.x, line.end.x, bezierBounds.xMax)
  const yMin = Math.min(line.start.y, line.end.y, bezierBounds.yMin)
  const yMax = Math.max(line.start.y, line.end.y, bezierBounds.yMax)

  const plotter = new Plotter()
  plotter.clear()
  plotter.setBounds(xMin, yMin, xMax, yMax)

  plotter.plotLine(line, 'blue')
  plotter.plotBezier(bezier, 'red')

  intersections.forEach((intersection) => {
    plotter.plotPoint(intersection.point, 'black')
  })

  // Note intersection count.
  plotter.addTitle(`Intersections: ${intersections.length}`)

  plotter.save('image.png')
  // --------------------------------------------------------------------------

  return intersections
}

export function getLineArcIntersection(line: Line, arc: Arc): Intersection[] {
  const arcN = normalizeArc(arc)
  const intersections: Intersection[] = []

  // Line in parameter-y form:
  //   P(t) = (x0, y0) + t * (dx, dy),  t in [0,1]
  //   Where (x0, y0) is the line start, (dx, dy) is the direction vector.
  const dirX = line.end.x - line.start.x
  const dirY = line.end.y - line.start.y

  // Circle (arc) centered at (cx, cy) with radius r.
  // Shift coordinates so the center is at (0,0) for simplicity.
  const relStartX = line.start.x - arcN.center.x
  const relStartY = line.start.y - arcN.center.y

  // Substitute the line equation into the circle equation:
  //   (x - cx)^2 + (y - cy)^2 = r^2
  //   (x0 + t*dx - cx)^2 + (y0 + t*dy - cy)^2 = r^2
  // Expand to get a quadratic in t: A*t^2 + B*t + C = 0
  const A = dirX * dirX + dirY * dirY
  const B = 2 * (dirX * relStartX + dirY * relStartY)
  const C = relStartX * relStartX + relStartY * relStartY - arcN.radius * arcN.radius

  if (A < EPS_INTERSECTION_SQUARED) {
    // Line is degenerate (start == end), no intersection.
    return intersections
  }

  // Solve for ts of intersections.
  const tIntersections = solveQuadratic(A, B, C)

  // Compute the arc's sweep and direction for filtering
  const sweep = normalizeSweep(arcN.startAngle, arcN.endAngle)

  rootLoop: for (const t of tIntersections) {
    if (t < -EPS_INTERSECTION || t > 1 + EPS_INTERSECTION) {
      continue
    }

    // Intersection point relative to centre.
    const x = line.start.x + t * dirX - arcN.center.x
    const y = line.start.y + t * dirY - arcN.center.y

    // Angle and distance along the arc.
    const ang = Math.atan2(y, x)
    const angNorm = normalizeAngle(ang, arcN.startAngle)

    if (sweep < 2 * Math.PI - EPS_ANGLE_INTERSECTION) {
      // Not a full circle.
      if (angNorm < -EPS_ANGLE_INTERSECTION || angNorm - sweep > EPS_ANGLE_INTERSECTION) {
        continue
      }
    }

    const arcT = angNorm / (sweep || 2 * Math.PI) // Avoid divide by zero if full circle.

    // Deduplicate – skip if coincident (tangent root pair).
    for (const h of intersections) {
      if (Math.abs(h.t1 - t) < EPS_ROOT_DUPE) {
        continue rootLoop
      }
    }

    intersections.push({
      point: { x: x + arcN.center.x, y: y + arcN.center.y },
      t1: Math.max(0, Math.min(1, t)),
      t2: Math.max(0, Math.min(1, arcT))
    })
  }

  // Plotter.
  // --------------------------------------------------------------------------
  const arcBounds = {
    xMin: arcN.center.x - arcN.radius,
    xMax: arcN.center.x + arcN.radius,
    yMin: arcN.center.y - arcN.radius,
    yMax: arcN.center.y + arcN.radius
  }
  const lineBounds = {
    xMin: Math.min(line.start.x, line.end.x),
    xMax: Math.max(line.start.x, line.end.x),
    yMin: Math.min(line.start.y, line.end.y),
    yMax: Math.max(line.start.y, line.end.y)
  }

  const xMin = Math.min(arcBounds.xMin, lineBounds.xMin)
  const xMax = Math.max(arcBounds.xMax, lineBounds.xMax)
  const yMin = Math.min(arcBounds.yMin, lineBounds.yMin)
  const yMax = Math.max(arcBounds.yMax, lineBounds.yMax)

  const plotter = new Plotter()
  plotter.clear()
  plotter.setBounds(xMin, yMin, xMax, yMax)

  plotter.plotLine(line, 'blue')
  plotter.plotArc(arcN, 'red')

  intersections.forEach((intersection) => {
    plotter.plotPoint(intersection.point, 'black')
  })

  // Note intersection count.
  plotter.addTitle(`Intersections: ${intersections.length}`)

  plotter.save('image.png')
  // --------------------------------------------------------------------------

  return intersections
}

export function getBezierBezierIntersection(bezier1: Bezier, bezier2: Bezier): Intersection[] {
  // See: https://vciba.springeropen.com/articles/10.1186/s42492-022-00114-3
  // Also, maybe: https://stackoverflow.com/questions/4039229/checking-if-two-cubic-b%C3%A9zier-curves-intersect
  // Also, maybe: https://pomax.github.io/bezierinfo/#intersections

  // Check degeneracy.
  const deg1 = checkBezierDegeneracy(bezier1)
  const deg2 = checkBezierDegeneracy(bezier2)

  if (deg1 === BezierDegeneracyType.POINT || deg2 === BezierDegeneracyType.POINT) {
    throw new Error('Degenerate Bézier found: all points are the same.')
  }

  if (deg1 === BezierDegeneracyType.LINE && deg2 === BezierDegeneracyType.LINE) {
    const line1: Line = { start: bezier1.start, end: bezier1.end }
    const line2: Line = { start: bezier2.start, end: bezier2.end }
    return getLineLineIntersection(line1, line2)
  }

  if (deg1 === BezierDegeneracyType.LINE) {
    const line1: Line = { start: bezier1.start, end: bezier1.end }
    return getLineBezierIntersection(line1, bezier2)
  }

  if (deg2 === BezierDegeneracyType.LINE) {
    const line2: Line = { start: bezier2.start, end: bezier2.end }
    // Swap t1/t2 in result to match signature.
    return getLineBezierIntersection(line2, bezier1).map((i) => ({
      point: i.point,
      t1: i.t2,
      t2: i.t1
    }))
  }

  const out: Intersection[] = []

  const recurse = (
    b1: Bezier,
    s1: [number, number], // Segment interval for b1.
    b2: Bezier,
    s2: [number, number], // Segment interval for b2.
    depth: number // Current recursion depth.
  ): void => {
    if (!doBoxesOverlap(getBezierBounds(b1), getBezierBounds(b2))) return

    // Get the largest bounding box dimension for each bezier; width or height.
    const bb1 = getBezierBounds(b1)
    const bb2 = getBezierBounds(b2)
    const lMax1 = Math.max(bb1.xMax - bb1.xMin, bb1.yMax - bb1.yMin)
    const lMax2 = Math.max(bb2.xMax - bb2.xMin, bb2.yMax - bb2.yMin)

    // When the box is 'flat' enough, return midpoint of overlapping bounding boxes.
    if ((lMax1 < EPS_BBOX && lMax2 < EPS_BBOX) || depth >= MAX_RECURSION_DEPTH) {
      // Get midpoint of the overlapping bounding boxes.
      const xStart = Math.max(bb1.xMin, bb2.xMin)
      const xEnd = Math.min(bb1.xMax, bb2.xMax)
      const xMid = (xStart + xEnd) * 0.5

      const yStart = Math.max(bb1.yMin, bb2.yMin)
      const yEnd = Math.min(bb1.yMax, bb2.yMax)
      const yMid = (yStart + yEnd) * 0.5

      const point: Point = {
        x: xMid,
        y: yMid
      }

      // Use the midpoint of the segment intervals.
      const t1Mid = (s1[0] + s1[1]) * 0.5
      const t2Mid = (s2[0] + s2[1]) * 0.5

      out.push({ point, t1: t1Mid, t2: t2Mid })
      return
    }

    // We don't use the cubic strip (because hard), just use fat line against
    // AABB.
    const fl = lMax1 < lMax2 ? makeFatLine(b1) : makeFatLine(b2)
    if (lMax1 < lMax2 ? fatLineReject(b2, fl) : fatLineReject(b1, fl)) return

    if (lMax1 >= lMax2) {
      const [l, lt, r, rt] = subdivideBezier(b1, 0.5, s1[0], s1[1])
      recurse(l, lt, b2, s2, depth + 1)
      recurse(r, rt, b2, s2, depth + 1)
    } else {
      const [l, lt, r, rt] = subdivideBezier(b2, 0.5, s2[0], s2[1])
      recurse(b1, s1, l, lt, depth + 1)
      recurse(b1, s1, r, rt, depth + 1)
    }
  }

  let tFull: [number, number] = [0, 1]
  recurse(bezier1, tFull, bezier2, tFull, 0)

  // Remove duplicates. This uses a higher eps than the normal line intersection because
  // we're looking for duplicate points. Use l2 norm to compare points.
  let intersections = out.filter(
    (p, i, arr) =>
      arr.findIndex(
        (q) => Math.hypot(p.point.x - q.point.x, p.point.y - q.point.y) < EPS_ROOT_DUPE
      ) === i
  )

  // Plotter.
  // --------------------------------------------------------------------------
  const bezierBounds1 = getBezierBounds(bezier1)
  const bezierBounds2 = getBezierBounds(bezier2)

  const xMin = Math.min(bezierBounds1.xMin, bezierBounds2.xMin)
  const xMax = Math.max(bezierBounds1.xMax, bezierBounds2.xMax)
  const yMin = Math.min(bezierBounds1.yMin, bezierBounds2.yMin)
  const yMax = Math.max(bezierBounds1.yMax, bezierBounds2.yMax)

  const plotter = new Plotter()
  plotter.clear()
  plotter.setBounds(xMin, yMin, xMax, yMax)

  plotter.plotBezier(bezier1, 'blue')
  plotter.plotBezier(bezier2, 'red')

  intersections.forEach((intersection) => {
    plotter.plotPoint(intersection.point, 'black')
  })

  // Note intersection count.
  plotter.addTitle(`Intersections: ${intersections.length}`)

  plotter.save('image.png')
  // --------------------------------------------------------------------------

  return intersections
}

export function getBezierArcIntersection(bezier: Bezier, arc: Arc): Intersection[] {
  const arcN = normalizeArc(arc)
  const intersections: Intersection[] = []

  // Check for degenerate Bezier—straight lines or points.
  const degType = checkBezierDegeneracy(bezier)
  switch (degType) {
    case BezierDegeneracyType.POINT:
      throw new Error('Degenerate Bézier found: all points are the same.')
    case BezierDegeneracyType.LINE:
      const bezierLine: Line = {
        start: bezier.start,
        end: bezier.end
      }
      return getLineArcIntersection(bezierLine, arc)
    case BezierDegeneracyType.NORMAL:
      break
    default:
      throw new Error(`Degenerate Bézier found: unknown degeneracy type: ${degType}.`)
  }

  // Bring circle to origin and unit radius.
  const toUnit = (p: Point): Point => ({
    x: (p.x - arcN.center.x) / arcN.radius,
    y: (p.y - arcN.center.y) / arcN.radius
  })

  const p0 = toUnit(bezier.start)
  const p1 = toUnit(bezier.control1)
  const p2 = toUnit(bezier.control2)
  const p3 = toUnit(bezier.end)

  // Cubic Bézier to power-basis coefficients
  //    x(s) = ax s^3 + bx s^2 + cx s + dx   (same for y)
  const toPower = (p0: number, p1: number, p2: number, p3: number) => ({
    a: -p0 + 3 * p1 - 3 * p2 + p3,
    b: 3 * p0 - 6 * p1 + 3 * p2,
    c: -3 * p0 + 3 * p1,
    d: p0
  })

  const X = toPower(p0.x, p1.x, p2.x, p3.x)
  const Y = toPower(p0.y, p1.y, p2.y, p3.y)

  // Build sextic coefficients for f(s)=x^2+y^2−1.
  // Do the convolution explicitly once (degree <=3 × degree <=3)...
  const c = new Array<number>(7).fill(0)

  const addTerm = (deg: number, coef: number) => {
    c[6 - deg] += coef
  } // High to low.

  // Do convolution of x(s) and y(s) coefficients to get 6th order cursed polynomial.
  const coeffs = [X.d, X.c, X.b, X.a] // X(t): constant, linear, quadratic, cubic.
  const coefft = [Y.d, Y.c, Y.b, Y.a] // Y(t): constant, linear, quadratic, cubic.

  for (let i = 0; i <= 3; ++i) {
    for (let j = 0; j <= 3; ++j) {
      addTerm(i + j, coeffs[i] * coeffs[j] + coefft[i] * coefft[j])
    }
  }
  // Subtract the 1 from the circle equation.
  c[6] -= 1

  // Solve sextic, keep real roots in [0,1]

  // Convert to double-double format: [low, high] where low=0 for exact coefficients
  const pDoubleDouble = c.map((coeff) => [0, coeff])

  const rootIntervals = allRootsCertified(
    pDoubleDouble, // Coefficients in double-double format.
    0, // Lower bound.
    1 // Upper bound.
  )

  // Extract the root values (use midpoint of interval).
  const roots = rootIntervals
    .map((interval) => (interval.tS + interval.tE) / 2)
    .filter((s) => s > -EPS_INTERSECTION && s < 1 + EPS_INTERSECTION)
    .sort((a, b) => a - b)

  // Compute the arc sweep once.
  const sweep = normalizeSweep(arcN.startAngle, arcN.endAngle)

  rootLoop: for (const t of roots) {
    // Evaluate Bezier at parameter t.
    const point = evaluateBezier(t, bezier)

    // Check angle position against the arc sweep.
    const relX = point.x - arcN.center.x
    const relY = point.y - arcN.center.y
    const angle = Math.atan2(relY, relX)
    const angleNorm = normalizeAngle(angle, arcN.startAngle)

    if (sweep < 2 * Math.PI - EPS_ANGLE_INTERSECTION) {
      if (angleNorm < -EPS_ANGLE_INTERSECTION || angleNorm - sweep > EPS_ANGLE_INTERSECTION) {
        continue
      }
    }

    const arcT = angleNorm / (sweep || 2 * Math.PI)

    // Deduplicate near-identical Bezier parameters.
    for (const hit of intersections) {
      if (Math.abs(hit.t1 - t) < EPS_ROOT_DUPE) continue rootLoop
    }

    intersections.push({
      point,
      t1: Math.max(0, Math.min(1, t)), // Bezier parameter
      t2: Math.max(0, Math.min(1, arcT)) // Arc parameter
    })
  }

  // Plotter.
  // --------------------------------------------------------------------------
  const bezierBounds = getBezierBounds(bezier)
  const arcBounds = {
    xMin: arcN.center.x - arcN.radius,
    xMax: arcN.center.x + arcN.radius,
    yMin: arcN.center.y - arcN.radius,
    yMax: arcN.center.y + arcN.radius
  }

  const xMin = Math.min(bezierBounds.xMin, arcBounds.xMin)
  const xMax = Math.max(bezierBounds.xMax, arcBounds.xMax)
  const yMin = Math.min(bezierBounds.yMin, arcBounds.yMin)
  const yMax = Math.max(bezierBounds.yMax, arcBounds.yMax)

  const plotter = new Plotter()
  plotter.clear()
  plotter.setBounds(xMin, yMin, xMax, yMax)

  plotter.plotBezier(bezier, 'blue')
  plotter.plotArc(arcN, 'red')

  intersections.forEach(({ point }) => plotter.plotPoint(point, 'black'))

  plotter.addTitle(`Intersections: ${intersections.length}`)
  plotter.save('image.png')
  // ------------------------------------------------------------------------

  return intersections
}

export function getArcArcIntersection(arc1: Arc, arc2: Arc): Intersection[] {
  const arcN1 = normalizeArc(arc1)
  const arcN2 = normalizeArc(arc2)
  const intersections: Intersection[] = []

  // Handle degenerate cases.
  if (arcN1.radius < EPS_INTERSECTION || arcN2.radius < EPS_INTERSECTION) {
    return intersections
  }

  // Distance between circle centers.
  const dx = arcN2.center.x - arcN1.center.x
  const dy = arcN2.center.y - arcN1.center.y
  const d = Math.sqrt(dx * dx + dy * dy)

  // Check for non-intersecting cases with tolerance.
  const sumRadii = arcN1.radius + arcN2.radius
  const diffRadii = Math.abs(arcN1.radius - arcN2.radius)

  if (d > sumRadii + EPS_INTERSECTION) {
    // Circles too far apart.
    return intersections
  }

  if (d < diffRadii - EPS_INTERSECTION) {
    // One circle inside the other.
    return intersections
  }

  if (d < EPS_INTERSECTION) {
    // Concentric circles - either identical (infinite intersections) or no intersections.
    return intersections
  }

  // Two intersection points case.
  // Using the standard circle-circle intersection formula.
  const a = (arcN1.radius * arcN1.radius - arcN2.radius * arcN2.radius + d * d) / (2 * d)
  const discriminant = arcN1.radius * arcN1.radius - a * a

  // Protect against negative discriminant due to floating point error.
  if (discriminant < -EPS_INTERSECTION_SQUARED) {
    return intersections
  }

  const h = Math.sqrt(Math.max(0, discriminant))

  // Point on line between centers.
  const px = arcN1.center.x + (a * dx) / d
  const py = arcN1.center.y + (a * dy) / d

  // Two intersection points perpendicular to the line between centers.
  const candidates = [
    { x: px + (h * dy) / d, y: py - (h * dx) / d },
    { x: px - (h * dy) / d, y: py + (h * dx) / d }
  ]

  // Compute the arc sweeps once.
  const sweep1 = normalizeSweep(arcN1.startAngle, arcN1.endAngle)
  const sweep2 = normalizeSweep(arcN2.startAngle, arcN2.endAngle)

  candidateLoop: for (const point of candidates) {
    // Check if point lies within both arc sweeps.
    const angle1 = Math.atan2(point.y - arcN1.center.y, point.x - arcN1.center.x)
    const angle2 = Math.atan2(point.y - arcN2.center.y, point.x - arcN2.center.x)

    const angNorm1 = normalizeAngle(angle1, arcN1.startAngle)
    const angNorm2 = normalizeAngle(angle2, arcN2.startAngle)

    // Check if point is within arc1 sweep.
    if (sweep1 < 2 * Math.PI - EPS_ANGLE_INTERSECTION) {
      if (angNorm1 < -EPS_ANGLE_INTERSECTION || angNorm1 - sweep1 > EPS_ANGLE_INTERSECTION) {
        continue
      }
    }

    // Check if point is within arc2 sweep.
    if (sweep2 < 2 * Math.PI - EPS_ANGLE_INTERSECTION) {
      if (angNorm2 < -EPS_ANGLE_INTERSECTION || angNorm2 - sweep2 > EPS_ANGLE_INTERSECTION) {
        continue
      }
    }

    const t1 = angNorm1 / (sweep1 || 2 * Math.PI)
    const t2 = angNorm2 / (sweep2 || 2 * Math.PI)

    // Deduplicate.
    for (const h of intersections) {
      const dx = h.point.x - point.x
      const dy = h.point.y - point.y
      if (Math.sqrt(dx * dx + dy * dy) < EPS_ROOT_DUPE) {
        continue candidateLoop
      }
    }

    intersections.push({
      point,
      t1: Math.max(0, Math.min(1, t1)),
      t2: Math.max(0, Math.min(1, t2))
    })
  }

  // Plotter.
  // --------------------------------------------------------------------------
  const arc1Bounds = {
    xMin: arcN1.center.x - arcN1.radius,
    xMax: arcN1.center.x + arcN1.radius,
    yMin: arcN1.center.y - arcN1.radius,
    yMax: arcN1.center.y + arcN1.radius
  }
  const arc2Bounds = {
    xMin: arcN2.center.x - arcN2.radius,
    xMax: arcN2.center.x + arcN2.radius,
    yMin: arcN2.center.y - arcN2.radius,
    yMax: arcN2.center.y + arcN2.radius
  }

  const xMin = Math.min(arc1Bounds.xMin, arc2Bounds.xMin)
  const xMax = Math.max(arc1Bounds.xMax, arc2Bounds.xMax)
  const yMin = Math.min(arc1Bounds.yMin, arc2Bounds.yMin)
  const yMax = Math.max(arc1Bounds.yMax, arc2Bounds.yMax)

  const plotter = new Plotter()
  plotter.clear()
  plotter.setBounds(xMin, yMin, xMax, yMax)

  plotter.plotArc(arcN1, 'blue')
  plotter.plotArc(arcN2, 'red')

  intersections.forEach((intersection) => {
    plotter.plotPoint(intersection.point, 'black')
  })

  plotter.addTitle(`Intersections: ${intersections.length}`)
  plotter.save('image.png')
  // --------------------------------------------------------------------------

  return intersections
}
