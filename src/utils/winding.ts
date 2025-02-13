import { Point } from '../types/base'
import { PathCommand, PathCommandType } from '../types/path'
import { KclOperation, KclOperationType } from '../types/kcl'
import { Transform } from './transform'

export class WindingAnalyzer {
  public analyzeNonzeroPath(
    subpaths: { commands: PathCommand[]; isClockwise: boolean }[],
    transform: Transform,
    convertCommandsFn: (commands: PathCommand[], transform: Transform) => KclOperation[]
  ): KclOperation[] {
    const operations: KclOperation[] = []

    // Sort paths by area (largest first)
    const sortedPaths = [...subpaths].sort(
      (a, b) => this.calculatePathArea(b.commands) - this.calculatePathArea(a.commands)
    )

    const processedPaths = new Set<number>()

    for (let i = 0; i < sortedPaths.length; i++) {
      if (processedPaths.has(i)) continue

      const currentPath = sortedPaths[i]
      const pathOps = convertCommandsFn(currentPath.commands, transform)

      // Find holes for this path
      const holes: KclOperation[] = []

      for (let j = i + 1; j < sortedPaths.length; j++) {
        if (processedPaths.has(j)) continue

        const potentialHole = sortedPaths[j]
        if (
          this.isPathContainedInPath(potentialHole.commands, currentPath.commands) &&
          currentPath.isClockwise !== potentialHole.isClockwise
        ) {
          holes.push({
            type: KclOperationType.Hole,
            params: {
              operations: convertCommandsFn(potentialHole.commands, transform)
            }
          })
          processedPaths.add(j)
        }
      }

      operations.push(...pathOps, ...holes)
      processedPaths.add(i)
    }

    return operations
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

  private isPointInPath(point: Point, commands: PathCommand[]): boolean {
    let inside = false
    let j = commands.length - 1

    for (let i = 0; i < commands.length; i++) {
      const pPrev = commands[i].position
      const pCur = commands[j].position

      if (
        pPrev.y > point.y !== pCur.y > point.y &&
        point.x < ((pCur.x - pPrev.x) * (point.y - pPrev.y)) / (pCur.y - pPrev.y) + pPrev.x
      ) {
        inside = !inside
      }
      j = i
    }

    return inside
  }

  private isPathContainedInPath(inner: PathCommand[], outer: PathCommand[]): boolean {
    return this.isPointInPath(inner[0].position, outer)
  }
}
