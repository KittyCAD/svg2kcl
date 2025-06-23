import { Plotter } from '../intersections/plotter'
import { SplitSegment } from './path_processor_v2'
import { Region } from './regions_v2'
import { Line } from '../intersections/intersections'
import { Bezier } from '../bezier/core'

type Node = [number, number]
type Edge = [number, number]

/**
 * Plot every region plus the raw planar-graph edges.
 *
 * @param regions – hierarchical list from getFaceRegions()
 * @param graphNodes – same nodes you passed to solver.discover()
 * @param graphEdges – same edges you passed to solver.discover()
 * @param filename – PNG file to write
 */
export function plotRegionsAndGraph(
  regions: Region[],
  graphNodes: Node[],
  graphEdges: Edge[],
  filename = 'regions.png'
): void {
  // 1. Determine plot bounds
  const xs = graphNodes.map((p) => p[0])
  const ys = graphNodes.map((p) => p[1])
  const minX = Math.min(...xs) - 10
  const maxX = Math.max(...xs) + 10
  const minY = Math.min(...ys) - 10
  const maxY = Math.max(...ys) + 10

  const plotter = new Plotter(1200, 900, 40)
  plotter.setBounds(minX, minY, maxX, maxY)

  // 2. Draw the raw straight-line graph (grey, dashed)
  graphEdges.forEach((e, idx) => {
    const [i, j] = e
    const start = { x: graphNodes[i][0], y: graphNodes[i][1] }
    const end = { x: graphNodes[j][0], y: graphNodes[j][1] }
    plotter.plotLine({ start, end }, '#888', 1 /*lineWidth*/, `e${idx}`)
  })

  // 3. Colour palette for regions
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

  // 4. Draw every region
  regions.forEach((region, rIdx) => {
    const colour = palette[rIdx % palette.length]

    region.segments.forEach((seg: SplitSegment, sIdx: number) => {
      if (seg.type === 'Line') {
        plotter.plotLine(seg.geometry as Line, colour, 3)
      } else if (seg.type === 'CubicBezier' || seg.type === 'QuadraticBezier') {
        plotter.plotBezier(seg.geometry as Bezier, colour, 3)
      } else {
        // If you have other segment kinds, add them here.
        console.warn(`Segment type ${seg.type} not plotted.`)
      }
    })

    // Optional: put a region label roughly at its centroid
    const centroid = region.segments.reduce(
      (acc, seg) => {
        const { x, y } = seg.geometry.start
        return { x: acc.x + x, y: acc.y + y }
      },
      { x: 0, y: 0 }
    )
    centroid.x /= region.segments.length
    centroid.y /= region.segments.length

    const p = plotter['transformPoint'](centroid as any) // using a private helper
    plotter['ctx'].fillStyle = colour
    plotter['ctx'].font = '14px Arial'
    plotter['ctx'].fillText(region.id, p.x, p.y)
  })

  plotter.save(filename)
}
