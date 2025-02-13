import { Point } from '../types/base'
import { PathCommand, PathCommandType } from '../types/path'
import { BezierUtils } from './bezier'

export interface WindingRegion {
  pathIndex: number // Index of original path in input array.
  points: Point[] // Points defining the region.
  windingNumber: number // Calculated winding number.
  containedBy: number[] // Indices of regions that contain this one.
}

export class WindingAnalyzer {
  // See: https://web.archive.org/web/20130126163405/http://geomalgorithms.com/a03-_inclusion.html
  private static getPathPoints(commands: PathCommand[]): Point[] {
    if (commands.length === 0) return []

    const points: Point[] = []
    let currentPosition = commands[0].position

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]
      const nextCmd = i < commands.length - 1 ? commands[i + 1] : null

      // Add current position
      points.push(currentPosition)

      // Handle bezier curves
      if (BezierUtils.isBezierCommand(cmd.type)) {
        points.push(...BezierUtils.getBezierPoints(cmd))
      }

      // Update current position.
      if (cmd.type === PathCommandType.StopAbsolute) {
        // For StopAbsolute, use its explicit position.
        currentPosition = cmd.position
      } else if (nextCmd) {
        // For other commands, use the next command's position.
        currentPosition = nextCmd.position
      }
    }

    // Ensure the path is properly closed if it ends with StopAbsolute.
    const lastCmd = commands[commands.length - 1]
    if (lastCmd.type === PathCommandType.StopAbsolute) {
      points.push(lastCmd.position)
    }

    return points
  }

  private getPolygonWinding(points: Point[]): number {
    if (points.length < 3) return 0

    let area = 0
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]
      const p2 = points[i + 1]
      area += (p2.x - p1.x) * (p2.y + p1.y)
    }

    const first = points[0]
    const last = points[points.length - 1]
    area += (first.x - last.x) * (first.y + last.y)

    return area > 0 ? 1 : -1
  }

  private isInsidePolygon(inner: Point[], outer: Point[]): boolean {
    let containedPoints = 0

    for (const point of inner) {
      let inside = false
      let j = outer.length - 1

      for (let i = 0; i < outer.length; i++) {
        const pi = outer[i]
        const pj = outer[j]

        if (
          pi.y > point.y !== pj.y > point.y &&
          point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
        ) {
          inside = !inside
        }
        j = i
      }

      if (inside) {
        containedPoints++
      }
    }

    return containedPoints > inner.length / 2
  }

  public analyzeWindingNumbers(subpaths: { commands: PathCommand[] }[]): WindingRegion[] {
    // Initialize regions with basic properties.
    const regions: WindingRegion[] = subpaths.map((path, index) => ({
      pathIndex: index,
      points: WindingAnalyzer.getPathPoints(path.commands),
      windingNumber: 0,
      containedBy: []
    }))

    // Calculate initial winding direction for each region.
    for (const region of regions) {
      region.windingNumber = this.getPolygonWinding(region.points)
    }

    // Analyze containment relationships and update winding numbers.
    for (let i = 0; i < regions.length; i++) {
      for (let j = 0; j < regions.length; j++) {
        if (i !== j && this.isInsidePolygon(regions[i].points, regions[j].points)) {
          regions[i].containedBy.push(j)
          regions[i].windingNumber += regions[j].windingNumber
        }
      }
    }

    return regions
  }
}
