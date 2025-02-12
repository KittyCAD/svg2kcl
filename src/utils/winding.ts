import { Point } from '../types/base'
import { PathCommand } from '../types/path'
import { KclOperation, KclOperationType } from '../types/kcl'
import { Transform } from './transform'

export interface WindingRegion {
  outline: PathCommand[]
  windingNumber: number
}

export class WindingAnalyzer {
  private isOpenPath(commands: PathCommand[]): boolean {
    if (commands.length < 2) return true

    // Path is closed if it ends with any kind of Stop command.
    const lastCommand = commands[commands.length - 1]
    return lastCommand.type !== 'StopAbsolute' && lastCommand.type !== 'StopRelative'
  }

  private calculateWindingNumber(
    point: Point,
    subpaths: { commands: PathCommand[]; isClockwise: boolean }[],
    currentPathIndex: number // Add this parameter
  ): number {
    let windingNumber = 0

    // Only check if the point is inside the current path
    if (this.isPointInPath(point, subpaths[currentPathIndex].commands)) {
      windingNumber = subpaths[currentPathIndex].isClockwise ? 1 : -1
    }

    return windingNumber
  }

  private findRegionBoundaries(
    subpaths: { commands: PathCommand[]; isClockwise: boolean }[]
  ): WindingRegion[] {
    const regions: WindingRegion[] = []

    // Process each subpath
    for (let i = 0; i < subpaths.length; i++) {
      const subpath = subpaths[i]
      const samplePoint = this.getSamplePointInsidePath(subpath.commands)
      const windingNumber = this.calculateWindingNumber(samplePoint, subpaths, i) // Pass the index

      if (windingNumber !== 0) {
        regions.push({
          outline: subpath.commands,
          windingNumber
        })
      }
    }

    return regions
  }

  private isPointInPath(point: Point, commands: PathCommand[]): boolean {
    let inside = false
    let j = commands.length - 1

    for (let i = 0; i < commands.length; i++) {
      const pi = commands[i].position
      const pj = commands[j].position

      if (
        pi.y > point.y !== pj.y > point.y &&
        point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x
      ) {
        inside = !inside
      }
      j = i
    }

    return inside
  }

  private getSamplePointInsidePath(commands: PathCommand[]): Point {
    // Calculate centroid first.
    let sumX = 0,
      sumY = 0,
      count = 0
    for (const cmd of commands) {
      sumX += cmd.position.x
      sumY += cmd.position.y
      count++
    }

    const centroid = {
      x: sumX / count,
      y: sumY / count
    }

    // If centroid is inside, use it.
    if (this.isPointInPath(centroid, commands)) {
      return centroid
    }

    // Otherwise, try points slightly offset from vertices.
    for (const cmd of commands) {
      const offsetPoint = {
        x: cmd.position.x + (centroid.x - cmd.position.x) * 0.1,
        y: cmd.position.y + (centroid.y - cmd.position.y) * 0.1
      }
      if (this.isPointInPath(offsetPoint, commands)) {
        return offsetPoint
      }
    }

    // If all else fails, return centroid (though this shouldn't happen with valid paths).
    return centroid
  }

  public analyzeNonzeroPath(
    subpaths: { commands: PathCommand[]; isClockwise: boolean }[],
    transform: Transform,
    convertCommandsFn: (commands: PathCommand[], transform: Transform) => KclOperation[]
  ): KclOperation[] {
    const operations: KclOperation[] = []

    // Split paths into open and closed
    const openPaths = subpaths.filter((path) => this.isOpenPath(path.commands))
    const closedPaths = subpaths.filter((path) => !this.isOpenPath(path.commands))

    // Handle open paths directly - they're always independent shapes
    operations.push(...openPaths.flatMap((path) => convertCommandsFn(path.commands, transform)))

    // If we have closed paths, process them with winding number analysis
    if (closedPaths.length > 0) {
      const regions = this.findRegionBoundaries(closedPaths)

      if (regions.length > 0) {
        const geometryGroups = new Map<string, WindingRegion[]>()

        regions.forEach((region) => {
          const key = JSON.stringify(
            region.outline.map((cmd) => ({
              x: cmd.position.x,
              y: cmd.position.y
            }))
          )

          if (!geometryGroups.has(key)) {
            geometryGroups.set(key, [])
          }
          geometryGroups.get(key)!.push(region)
        })

        const uniqueRegions = Array.from(geometryGroups.values()).map((group) => {
          const combinedWindingNumber = group.reduce((sum, region) => sum + region.windingNumber, 0)
          return {
            outline: group[0].outline,
            windingNumber: combinedWindingNumber
          }
        })

        const mainRegion = uniqueRegions.reduce((outer, current) => {
          const outerArea = this.calculatePathArea(outer.outline)
          const currentArea = this.calculatePathArea(current.outline)
          return currentArea > outerArea ? current : outer
        }, uniqueRegions[0])

        operations.push(...convertCommandsFn(mainRegion.outline, transform))

        for (const region of uniqueRegions) {
          if (region === mainRegion) continue

          const isContained = this.isPathContainedInPath(region.outline, mainRegion.outline)
          const regionOps = convertCommandsFn(region.outline, transform)

          if (isContained && region.windingNumber * mainRegion.windingNumber < 0) {
            operations.push({
              type: KclOperationType.Hole,
              params: { operations: regionOps }
            })
          } else if (!this.arePathsEqual(region.outline, mainRegion.outline)) {
            operations.push(...regionOps)
          }
        }
      }
    }

    return operations
  }

  private arePathsEqual(path1: PathCommand[], path2: PathCommand[]): boolean {
    if (path1.length !== path2.length) return false

    return path1.every((cmd, i) => {
      const cmd2 = path2[i]

      // Check command type
      if (cmd.type !== cmd2.type) return false

      // Check position
      if (cmd.position.x !== cmd2.position.x || cmd.position.y !== cmd2.position.y) return false

      // Check parameters if they exist
      if (cmd.parameters && cmd2.parameters) {
        if (cmd.parameters.length !== cmd2.parameters.length) return false
        return cmd.parameters.every((param, j) => param === cmd2.parameters[j])
      }

      return true
    })
  }

  private calculatePathArea(commands: PathCommand[]): number {
    let area = 0
    for (let i = 0; i < commands.length - 1; i++) {
      const p1 = commands[i].position
      const p2 = commands[i + 1].position
      area += p1.x * p2.y - p2.x * p1.y
    }
    return Math.abs(area / 2)
  }

  private isPathContainedInPath(inner: PathCommand[], outer: PathCommand[]): boolean {
    // Test a point from the inner path (e.g., first vertex)
    return this.isPointInPath(inner[0].position, outer)
  }
}
