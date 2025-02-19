import { Point } from '../types/base'

export function exportPointsToCSV(points: Point[], filename: string = 'output.csv'): void {
  const csvContent = 'X,Y\n' + points.map((point) => `${point.x},${point.y}`).join('\n')

  const fs = require('fs')
  fs.writeFileSync(filename, csvContent)
}
