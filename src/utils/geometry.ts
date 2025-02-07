import { Path, PathCommand, PathCommandType, Point } from '../types/geometric'

export function isClockwise(points: Point[]): boolean {
  let sum = 0
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i]
    const next = points[i + 1]
    sum += (next.x - curr.x) * (next.y + curr.y)
  }
  return sum > 0
}

export function separateSubpaths(path: Path): {
  commands: PathCommand[]
  isClockwise: boolean
}[] {
  const subpaths: { commands: PathCommand[]; isClockwise: boolean }[] = []
  let currentCommands: PathCommand[] = []

  path.commands.forEach((command) => {
    if (
      currentCommands.length > 0 &&
      (command.type === PathCommandType.MoveAbsolute ||
        command.type === PathCommandType.MoveRelative)
    ) {
      subpaths.push({
        commands: currentCommands,
        isClockwise: isClockwise(currentCommands.map((c) => c.position))
      })
      currentCommands = []
    }
    currentCommands.push(command)
  })

  if (currentCommands.length > 0) {
    subpaths.push({
      commands: currentCommands,
      isClockwise: isClockwise(currentCommands.map((c) => c.position))
    })
  }

  return subpaths
}
