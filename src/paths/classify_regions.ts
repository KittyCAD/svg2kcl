import earcut from 'earcut'
import robustInside from 'robust-point-in-polygon'
import { FillRule, Point } from '../types/base'
import { PathRegion } from '../types/regions'
import { FragmentMap } from '../types/fragments'
import { getRegionPoints } from '../paths/regions'

function inside(pt: Point, loop: Point[]): boolean {
  const poly = loop.map((p) => [p.x, p.y])
  return robustInside(poly as unknown as number[][], [pt.x, pt.y]) === 1
}

function safeCentroid(poly: Point[]): Point {
  const verts: number[] = []
  poly.forEach((p) => verts.push(p.x, p.y))
  // earcut gives one triangle even for convex quads,
  // so verts.length ≥ 6 ⇒ at least one triangle.
  const tri = earcut(verts, undefined, 2).slice(0, 3)
  const ax = verts[tri[0] * 2],
    ay = verts[tri[0] * 2 + 1]
  const bx = verts[tri[1] * 2],
    by = verts[tri[1] * 2 + 1]
  const cx = verts[tri[2] * 2],
    cy = verts[tri[2] * 2 + 1]
  return { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3 }
}

export function classifyRegions(
  regions: PathRegion[],
  fragmentMap: FragmentMap,
  fillRule: FillRule
): Map<string, boolean> {
  // Pre-compute one guaranteed-inside point and signed area for every face.
  const meta = regions.map((r) => {
    const pts = getRegionPoints(r, fragmentMap)
    return {
      id: r.id,
      pts,
      inPt: safeCentroid(pts),
      sign: Math.sign(
        pts.reduce(
          (a, p, i, arr) =>
            a +
            arr[(i + arr.length - 1) % arr.length].x * p.y -
            p.x * arr[(i + arr.length - 1) % arr.length].y,
          0
        )
      )
    }
  })

  // For every face, count how many outer faces contain its test-point.
  const depth = new Map<string, number>()
  const wSum = new Map<string, number>()
  meta.forEach((m) => {
    depth.set(m.id, 0)
    wSum.set(m.id, 0)
  })

  meta.forEach((outer) => {
    meta.forEach((inner) => {
      if (outer.id === inner.id) return
      if (inside(inner.inPt, outer.pts)) {
        depth.set(inner.id, depth.get(inner.id)! + 1)
        wSum.set(inner.id, wSum.get(inner.id)! + outer.sign)
      }
    })
  })

  // Decide hole vs solid.
  const hole = new Map<string, boolean>()
  meta.forEach((m) => {
    hole.set(
      m.id,
      fillRule === FillRule.EvenOdd ? depth.get(m.id)! % 2 === 1 : wSum.get(m.id)! === 0 // non-zero rule
    )
  })
  return hole
}
