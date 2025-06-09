import { Point } from '../types/base'
import { normalizeAngle, normalizeSweep } from './arc_helper'
import {
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
  EPS_LINE_INTERSECTION,
  EPS_ROOT_DUPE,
  MAX_RECURSION_DEPTH
} from './constants'
import { Plotter } from './plotter'

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

// Intersection functions.
export function getLineLineIntersection(line1: Line, line2: Line): Intersection[] {
  const d1x = line1.end.x - line1.start.x
  const d1y = line1.end.y - line1.start.y
  const d2x = line2.end.x - line2.start.x
  const d2y = line2.end.y - line2.start.y

  const denominator = d1x * d2y - d1y * d2x

  if (Math.abs(denominator) < EPS_LINE_INTERSECTION) {
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
  const intersections: Intersection[] = []

  for (const t of roots) {
    if (t >= -EPS_LINE_INTERSECTION && t <= 1 + EPS_LINE_INTERSECTION) {
      const bezierPoint = evaluateBezier(t, bezier)

      const lineDir = { x: line.end.x - line.start.x, y: line.end.y - line.start.y }
      const lineLength = Math.sqrt(lineDir.x * lineDir.x + lineDir.y * lineDir.y)

      if (lineLength < EPS_LINE_INTERSECTION) continue

      const toPoint = { x: bezierPoint.x - line.start.x, y: bezierPoint.y - line.start.y }
      const lineT = (toPoint.x * lineDir.x + toPoint.y * lineDir.y) / (lineLength * lineLength)

      if (lineT >= -EPS_LINE_INTERSECTION && lineT <= 1 + EPS_LINE_INTERSECTION) {
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
  const intersections: Intersection[] = []

  // Line in parameter-y form:
  //   P(t) = (x0, y0) + t * (dx, dy),  t in [0,1]
  //   Where (x0, y0) is the line start, (dx, dy) is the direction vector.
  const dirX = line.end.x - line.start.x
  const dirY = line.end.y - line.start.y

  // Circle (arc) centered at (cx, cy) with radius r.
  // Shift coordinates so the center is at (0,0) for simplicity.
  const relStartX = line.start.x - arc.center.x
  const relStartY = line.start.y - arc.center.y

  // Substitute the line equation into the circle equation:
  //   (x - cx)^2 + (y - cy)^2 = r^2
  //   (x0 + t*dx - cx)^2 + (y0 + t*dy - cy)^2 = r^2
  // Expand to get a quadratic in t: A*t^2 + B*t + C = 0
  const A = dirX * dirX + dirY * dirY
  const B = 2 * (dirX * relStartX + dirY * relStartY)
  const C = relStartX * relStartX + relStartY * relStartY - arc.radius * arc.radius

  if (A < EPS_LINE_INTERSECTION) {
    // Line is degenerate (start == end), no intersection.
    return intersections
  }

  // Solve for ts of intersections.
  const tHits = solveQuadratic(A, B, C)

  // Compute the arc's sweep and direction for filtering
  const sweep = normalizeSweep(arc.startAngle, arc.endAngle, arc.clockwise) // ≥0

  rootLoop: for (const t of tHits) {
    if (t < -EPS_LINE_INTERSECTION || t > 1 + EPS_LINE_INTERSECTION) {
      continue
    }

    // Intersection point relative to centre.
    const x = line.start.x + t * dirX - arc.center.x
    const y = line.start.y + t * dirY - arc.center.y

    // Angle and distance along the arc.
    const ang = Math.atan2(y, x)
    const angNorm = normalizeAngle(ang, arc.startAngle, arc.clockwise) // 0 … sweep

    if (sweep < 2 * Math.PI - EPS_ANGLE_INTERSECTION) {
      // Not a full circle.
      if (angNorm < -EPS_ANGLE_INTERSECTION || angNorm - sweep > EPS_ANGLE_INTERSECTION) {
        continue
      }
    }

    const arcT = angNorm / (sweep || 2 * Math.PI) // Avoid divide by zero if full circle.

    // Deduplicate – skip if coincident (tangent root pair)
    for (const h of intersections) {
      if (Math.abs(h.t1 - t) < EPS_ROOT_DUPE) {
        continue rootLoop
      }
    }

    intersections.push({
      point: { x: x + arc.center.x, y: y + arc.center.y },
      t1: Math.max(0, Math.min(1, t)),
      t2: Math.max(0, Math.min(1, arcT))
    })
  }

  // Plotter.
  // --------------------------------------------------------------------------
  const arcBounds = {
    xMin: arc.center.x - arc.radius,
    xMax: arc.center.x + arc.radius,
    yMin: arc.center.y - arc.radius,
    yMax: arc.center.y + arc.radius
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
  plotter.plotArc(arc, 'red')

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
  return []
}

export function getArcArcIntersection(arc1: Arc, arc2: Arc): Intersection[] {
  return []
}
