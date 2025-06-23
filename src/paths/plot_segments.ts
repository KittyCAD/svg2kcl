import { Plotter } from '../intersections/plotter'
import { SplitSegment } from './path_processor_v2'
import { Line } from '../intersections/intersections'
import { Bezier } from '../bezier/core'
import { Point } from '../types/base'
/**
 * Quick-and-simple plot of the raw linked split-segments.
 * Each sub-path is rendered in its own colour.
 */
export function plotLinkedSplitSegments(
  segments: SplitSegment[],
  filename = 'linked_segments.png'
): void {
  /* 1. Bounding box -------------------------------------------------- */
  const allPts: Point[] = []
  segments.forEach((s) => {
    if (s.type === 'Line') {
      allPts.push(s.geometry.start, s.geometry.end)
    } else {
      const g = s.geometry as Bezier
      allPts.push(g.start, g.control1, g.control2, g.end)
    }
  })
  const xs = allPts.map((p) => p.x)
  const ys = allPts.map((p) => p.y)
  const pad = 10
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad
  const maxY = Math.max(...ys) + pad

  /* 2. Colour per sub-path ------------------------------------------- */
  const palette = [
    '#e6194b',
    '#3cb44b',
    '#ffe119',
    '#4363d8',
    '#f58231',
    '#911eb4',
    '#46f0f0',
    '#f032e6',
    '#bcf60c',
    '#fabebe',
    '#008080',
    '#e6beff',
    '#9a6324',
    '#fffac8',
    '#800000'
  ]
  const colourOf = new Map<string, string>()
  let i = 0

  /* 3. Draw ----------------------------------------------------------- */
  const plotter = new Plotter(1200, 900, 40)
  plotter.setBounds(minX, minY, maxX, maxY)

  segments.forEach((seg) => {
    if (!colourOf.has(seg.idSubpath)) {
      colourOf.set(seg.idSubpath, palette[i++ % palette.length])
    }
    const colour = colourOf.get(seg.idSubpath)!

    if (seg.type === 'Line') {
      plotter.plotLine(seg.geometry as Line, colour, 3)
    } else {
      plotter.plotBezier(seg.geometry as Bezier, colour, 3)
    }
  })

  plotter.save(filename)
}
