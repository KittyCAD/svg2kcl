import { Point } from '../types/base'

export function exportPointsToCSV(points: Point[], filename: string = 'output.csv'): void {
  const csvContent = 'X,Y\n' + points.map((point) => `${point.x},${point.y}`).join('\n')

  const fs = require('fs')
  fs.writeFileSync(filename, csvContent)
}

interface PlotData {
  x: number[]
  y: number[]
  mode: string
  type: string
  color: string
  marker?: string
}

export class Plotter {
  private plotData: PlotData[] = []

  addPoints(
    points: Point[],
    mode: string = 'lines',
    type: string = 'scatter',
    color: string = 'blue'
  ): void {
    this.plotData.push({
      x: points.map((p) => p.x),
      y: points.map((p) => p.y * -1),
      mode,
      type,
      color
    })
  }

  createPlot(filename: string = 'plot.html'): void {
    const fs = require('fs')
    const htmlContent = `
    <html>
    <head>
        <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    </head>
    <body>
        <div id="plot"></div>
        <script>
            var data = ${JSON.stringify(
              this.plotData.map((d) => ({
                x: d.x,
                y: d.y,
                mode: d.mode,
                type: d.type,
                line: { color: d.color },
                marker: {
                  size: 8,
                  color: d.color,
                  symbol: d.marker || 'circle' // Can be 'circle', 'square', 'diamond', 'cross', etc.
                }
              }))
            )};

            Plotly.newPlot('plot', data);
        </script>
    </body>
    </html>
    `

    fs.writeFileSync(filename, htmlContent)
  }
}
