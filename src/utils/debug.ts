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
  marker: string
  name: string
  visible: boolean
}

export class Plotter {
  private plotData: PlotData[] = []
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private width: number = 800
  private height: number = 600
  private padding: number = 50
  private toggles: HTMLDivElement | null = null

  constructor(width: number = 800, height: number = 600) {
    this.width = width
    this.height = height
  }

  addPoints(
    points: Point[],
    mode: string = 'lines',
    type: string = 'scatter',
    color: string = 'blue',
    name: string = ''
  ): void {
    this.plotData.push({
      x: points.map((p) => p.x),
      y: points.map((p) => p.y * -1),
      mode,
      type,
      color,
      name: name || `Series ${this.plotData.length + 1}`,
      visible: true,
      marker: 'circle'
    })
  }

  private calculateBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity

    for (const data of this.plotData) {
      if (!data.visible) continue

      for (let i = 0; i < data.x.length; i++) {
        minX = Math.min(minX, data.x[i])
        maxX = Math.max(maxX, data.x[i])
        minY = Math.min(minY, data.y[i])
        maxY = Math.max(maxY, data.y[i])
      }
    }

    // If no visible data, return defaults
    if (minX === Infinity) {
      return { minX: 0, maxX: 10, minY: 0, maxY: 10 }
    }

    // Add a small margin
    const xMargin = (maxX - minX) * 0.1 || 1
    const yMargin = (maxY - minY) * 0.1 || 1

    return {
      minX: minX - xMargin,
      maxX: maxX + xMargin,
      minY: minY - yMargin,
      maxY: maxY + yMargin
    }
  }

  private scaleToCanvas(
    x: number,
    y: number,
    bounds: { minX: number; maxX: number; minY: number; maxY: number }
  ): { x: number; y: number } {
    const xScale = (this.width - this.padding * 2) / (bounds.maxX - bounds.minX)
    const yScale = (this.height - this.padding * 2) / (bounds.maxY - bounds.minY)

    return {
      x: this.padding + (x - bounds.minX) * xScale,
      y: this.height - this.padding - (y - bounds.minY) * yScale
    }
  }

  private drawAxes(bounds: { minX: number; maxX: number; minY: number; maxY: number }): void {
    if (!this.ctx) return

    this.ctx.strokeStyle = '#333'
    this.ctx.lineWidth = 1
    this.ctx.beginPath()

    // X-axis
    const xAxisY = this.scaleToCanvas(0, bounds.minY, bounds).y
    this.ctx.moveTo(this.padding, xAxisY)
    this.ctx.lineTo(this.width - this.padding, xAxisY)

    // Y-axis
    const yAxisX = this.scaleToCanvas(bounds.minX, 0, bounds).x
    this.ctx.moveTo(yAxisX, this.padding)
    this.ctx.lineTo(yAxisX, this.height - this.padding)

    this.ctx.stroke()

    // Draw labels
    this.ctx.fillStyle = '#333'
    this.ctx.font = '12px Arial'
    this.ctx.textAlign = 'center'

    // X-axis labels
    const xStep = (bounds.maxX - bounds.minX) / 5
    for (let i = 0; i <= 5; i++) {
      const x = bounds.minX + i * xStep
      const { x: canvasX, y: canvasY } = this.scaleToCanvas(x, bounds.minY, bounds)
      this.ctx.fillText(x.toFixed(1), canvasX, canvasY + 20)
    }

    // Y-axis labels
    const yStep = (bounds.maxY - bounds.minY) / 5
    this.ctx.textAlign = 'right'
    for (let i = 0; i <= 5; i++) {
      const y = bounds.minY + i * yStep
      const { x: canvasX, y: canvasY } = this.scaleToCanvas(bounds.minX, y, bounds)
      this.ctx.fillText(y.toFixed(1), canvasX - 10, canvasY + 4)
    }
  }

  private drawLegend(): void {
    if (!this.ctx) return

    const legendX = this.width - this.padding - 150
    const legendY = this.padding
    const itemHeight = 20

    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
    this.ctx.fillRect(legendX - 10, legendY - 10, 160, (this.plotData.length + 1) * itemHeight)
    this.ctx.strokeStyle = '#333'
    this.ctx.strokeRect(legendX - 10, legendY - 10, 160, (this.plotData.length + 1) * itemHeight)

    this.ctx.fillStyle = '#333'
    this.ctx.font = 'bold 12px Arial'
    this.ctx.textAlign = 'left'
    this.ctx.fillText('Legend', legendX, legendY + 5)

    this.ctx.font = '12px Arial'
    for (let i = 0; i < this.plotData.length; i++) {
      const data = this.plotData[i]
      const y = legendY + (i + 1) * itemHeight + 5

      // Draw color marker
      this.ctx.fillStyle = data.color
      this.ctx.fillRect(legendX, y - 8, 10, 10)
      this.ctx.strokeStyle = '#333'
      this.ctx.strokeRect(legendX, y - 8, 10, 10)

      // Draw series name
      this.ctx.fillStyle = data.visible ? '#333' : '#999'
      this.ctx.fillText(data.name, legendX + 20, y)
    }
  }

  private drawData(bounds: { minX: number; maxX: number; minY: number; maxY: number }): void {
    if (!this.ctx) return

    for (const data of this.plotData) {
      if (!data.visible || data.x.length === 0) continue

      this.ctx.strokeStyle = data.color
      this.ctx.fillStyle = data.color
      this.ctx.lineWidth = 2

      if (data.mode.includes('lines')) {
        this.ctx.beginPath()
        const startPoint = this.scaleToCanvas(data.x[0], data.y[0], bounds)
        this.ctx.moveTo(startPoint.x, startPoint.y)

        for (let i = 1; i < data.x.length; i++) {
          const point = this.scaleToCanvas(data.x[i], data.y[i], bounds)
          this.ctx.lineTo(point.x, point.y)
        }

        this.ctx.stroke()
      }

      if (data.mode.includes('markers')) {
        for (let i = 0; i < data.x.length; i++) {
          const point = this.scaleToCanvas(data.x[i], data.y[i], bounds)
          this.ctx.beginPath()

          const size = 5

          if (data.marker === 'square') {
            this.ctx.rect(point.x - size, point.y - size, size * 2, size * 2)
          } else if (data.marker === 'diamond') {
            this.ctx.moveTo(point.x, point.y - size)
            this.ctx.lineTo(point.x + size, point.y)
            this.ctx.lineTo(point.x, point.y + size)
            this.ctx.lineTo(point.x - size, point.y)
            this.ctx.lineTo(point.x, point.y - size)
          } else if (data.marker === 'cross') {
            this.ctx.moveTo(point.x - size, point.y - size)
            this.ctx.lineTo(point.x + size, point.y + size)
            this.ctx.moveTo(point.x + size, point.y - size)
            this.ctx.lineTo(point.x - size, point.y + size)
          } else {
            // Default to circle
            this.ctx.arc(point.x, point.y, size, 0, 2 * Math.PI)
          }

          if (data.mode === 'markers') {
            this.ctx.fill()
          } else {
            this.ctx.stroke()
            this.ctx.fill()
          }
        }
      }
    }
  }

  private render(): void {
    if (!this.ctx) return

    // Clear canvas
    this.ctx.clearRect(0, 0, this.width, this.height)

    // Calculate bounds from visible data
    const bounds = this.calculateBounds()

    // Draw grid, axes, and labels
    this.drawAxes(bounds)

    // Draw data series
    this.drawData(bounds)

    // Draw legend
    this.drawLegend()
  }

  private createToggleControls(container: HTMLDivElement): void {
    // Create toggle all button
    const toggleAllBtn = document.createElement('button')
    toggleAllBtn.textContent = 'Toggle All Series'
    toggleAllBtn.style.marginRight = '10px'
    toggleAllBtn.style.marginBottom = '10px'
    toggleAllBtn.addEventListener('click', () => {
      const allVisible = this.plotData.every((data) => data.visible)
      this.plotData.forEach((data) => {
        data.visible = !allVisible
      })
      this.render()
      this.updateToggleButtons()
    })
    container.appendChild(toggleAllBtn)

    // Create individual toggle buttons
    this.plotData.forEach((data, index) => {
      const btn = document.createElement('button')
      btn.dataset.index = index.toString()
      btn.textContent = data.name || `Series ${index + 1}`
      btn.style.marginRight = '5px'
      btn.style.marginBottom = '5px'
      btn.style.opacity = data.visible ? '1' : '0.5'
      btn.style.backgroundColor = data.color
      btn.style.color = this.getContrastColor(data.color)
      btn.style.border = '1px solid #333'
      btn.style.borderRadius = '4px'
      btn.style.padding = '5px 10px'

      btn.addEventListener('click', () => {
        data.visible = !data.visible
        btn.style.opacity = data.visible ? '1' : '0.5'
        this.render()
      })

      container.appendChild(btn)
    })
  }

  private updateToggleButtons(): void {
    if (!this.toggles) return

    // Update button states
    const buttons = this.toggles.querySelectorAll('button')
    buttons.forEach((btn, index) => {
      if (index === 0) return // Skip toggle all button
      const dataIndex = parseInt(btn.dataset.index || '0')
      btn.style.opacity = this.plotData[dataIndex].visible ? '1' : '0.5'
    })
  }

  private getContrastColor(hexColor: string): string {
    // Convert hex to RGB
    const r = parseInt(hexColor.slice(1, 3), 16)
    const g = parseInt(hexColor.slice(3, 5), 16)
    const b = parseInt(hexColor.slice(5, 7), 16)

    // Calculate perceived brightness
    const brightness = (r * 299 + g * 587 + b * 114) / 1000

    // Return black or white based on brightness
    return brightness > 128 ? 'black' : 'white'
  }

  createPlot(filename: string = 'plot.html'): void {
    const fs = require('fs')

    const htmlContent = `
    <html>
    <head>
        <title>Canvas Plotter</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 20px;
            }
            .container {
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .controls {
                margin-bottom: 10px;
                width: ${this.width}px;
            }
            canvas {
                border: 1px solid #ddd;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div id="controls" class="controls"></div>
            <canvas id="plot" width="${this.width}" height="${this.height}"></canvas>
        </div>
        <script>
            // Plot data
            const plotData = ${JSON.stringify(this.plotData)};
            
            // Canvas setup
            const canvas = document.getElementById('plot');
            const ctx = canvas.getContext('2d');
            const width = ${this.width};
            const height = ${this.height};
            const padding = ${this.padding};
            
            // Utility functions
            function calculateBounds() {
                let minX = Infinity;
                let maxX = -Infinity;
                let minY = Infinity;
                let maxY = -Infinity;
                
                for (const data of plotData) {
                    if (!data.visible) continue;
                    
                    for (let i = 0; i < data.x.length; i++) {
                        minX = Math.min(minX, data.x[i]);
                        maxX = Math.max(maxX, data.x[i]);
                        minY = Math.min(minY, data.y[i]);
                        maxY = Math.max(maxY, data.y[i]);
                    }
                }
                
                // If no visible data, return defaults
                if (minX === Infinity) {
                    return { minX: 0, maxX: 10, minY: 0, maxY: 10 };
                }
                
                // Add a small margin
                const xMargin = (maxX - minX) * 0.1 || 1;
                const yMargin = (maxY - minY) * 0.1 || 1;
                
                return {
                    minX: minX - xMargin,
                    maxX: maxX + xMargin,
                    minY: minY - yMargin,
                    maxY: maxY + yMargin
                };
            }
            
            function scaleToCanvas(x, y, bounds) {
                const xScale = (width - padding * 2) / (bounds.maxX - bounds.minX);
                const yScale = (height - padding * 2) / (bounds.maxY - bounds.minY);
                
                return {
                    x: padding + (x - bounds.minX) * xScale,
                    y: height - padding - (y - bounds.minY) * yScale
                };
            }
            
            function drawAxes(bounds) {
                ctx.strokeStyle = '#333';
                ctx.lineWidth = 1;
                ctx.beginPath();
                
                // X-axis
                const xAxisY = scaleToCanvas(0, bounds.minY, bounds).y;
                ctx.moveTo(padding, xAxisY);
                ctx.lineTo(width - padding, xAxisY);
                
                // Y-axis
                const yAxisX = scaleToCanvas(bounds.minX, 0, bounds).x;
                ctx.moveTo(yAxisX, padding);
                ctx.lineTo(yAxisX, height - padding);
                
                ctx.stroke();
                
                // Draw labels
                ctx.fillStyle = '#333';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                
                // X-axis labels
                const xStep = (bounds.maxX - bounds.minX) / 5;
                for (let i = 0; i <= 5; i++) {
                    const x = bounds.minX + i * xStep;
                    const { x: canvasX, y: canvasY } = scaleToCanvas(x, bounds.minY, bounds);
                    ctx.fillText(x.toFixed(1), canvasX, canvasY + 20);
                }
                
                // Y-axis labels
                const yStep = (bounds.maxY - bounds.minY) / 5;
                ctx.textAlign = 'right';
                for (let i = 0; i <= 5; i++) {
                    const y = bounds.minY + i * yStep;
                    const { x: canvasX, y: canvasY } = scaleToCanvas(bounds.minX, y, bounds);
                    ctx.fillText(y.toFixed(1), canvasX - 10, canvasY + 4);
                }
            }
            
            function drawLegend() {
                const legendX = width - padding - 150;
                const legendY = padding;
                const itemHeight = 20;
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.fillRect(legendX - 10, legendY - 10, 160, (plotData.length + 1) * itemHeight);
                ctx.strokeStyle = '#333';
                ctx.strokeRect(legendX - 10, legendY - 10, 160, (plotData.length + 1) * itemHeight);
                
                ctx.fillStyle = '#333';
                ctx.font = 'bold 12px Arial';
                ctx.textAlign = 'left';
                ctx.fillText('Legend', legendX, legendY + 5);
                
                ctx.font = '12px Arial';
                for (let i = 0; i < plotData.length; i++) {
                    const data = plotData[i];
                    const y = legendY + (i + 1) * itemHeight + 5;
                    
                    // Draw color marker
                    ctx.fillStyle = data.color;
                    ctx.fillRect(legendX, y - 8, 10, 10);
                    ctx.strokeStyle = '#333';
                    ctx.strokeRect(legendX, y - 8, 10, 10);
                    
                    // Draw series name
                    ctx.fillStyle = data.visible ? '#333' : '#999';
                    ctx.fillText(data.name, legendX + 20, y);
                }
            }
            
            function drawData(bounds) {
                for (const data of plotData) {
                    if (!data.visible || data.x.length === 0) continue;
                    
                    ctx.strokeStyle = data.color;
                    ctx.fillStyle = data.color;
                    ctx.lineWidth = 2;
                    
                    if (data.mode.includes('lines')) {
                        ctx.beginPath();
                        const startPoint = scaleToCanvas(data.x[0], data.y[0], bounds);
                        ctx.moveTo(startPoint.x, startPoint.y);
                        
                        for (let i = 1; i < data.x.length; i++) {
                            const point = scaleToCanvas(data.x[i], data.y[i], bounds);
                            ctx.lineTo(point.x, point.y);
                        }
                        
                        ctx.stroke();
                    }
                    
                    if (data.mode.includes('markers')) {
                        for (let i = 0; i < data.x.length; i++) {
                            const point = scaleToCanvas(data.x[i], data.y[i], bounds);
                            ctx.beginPath();
                            
                            const size = 5;
                            
                            if (data.marker === 'square') {
                                ctx.rect(point.x - size, point.y - size, size * 2, size * 2);
                            } else if (data.marker === 'diamond') {
                                ctx.moveTo(point.x, point.y - size);
                                ctx.lineTo(point.x + size, point.y);
                                ctx.lineTo(point.x, point.y + size);
                                ctx.lineTo(point.x - size, point.y);
                                ctx.lineTo(point.x, point.y - size);
                            } else if (data.marker === 'cross') {
                                ctx.moveTo(point.x - size, point.y - size);
                                ctx.lineTo(point.x + size, point.y + size);
                                ctx.moveTo(point.x + size, point.y - size);
                                ctx.lineTo(point.x - size, point.y + size);
                            } else {
                                // Default to circle
                                ctx.arc(point.x, point.y, size, 0, 2 * Math.PI);
                            }
                            
                            if (data.mode === 'markers') {
                                ctx.fill();
                            } else {
                                ctx.stroke();
                                ctx.fill();
                            }
                        }
                    }
                }
            }
            
            function render() {
                // Clear canvas
                ctx.clearRect(0, 0, width, height);
                
                // Calculate bounds from visible data
                const bounds = calculateBounds();
                
                // Draw grid, axes, and labels
                drawAxes(bounds);
                
                // Draw data series
                drawData(bounds);
                
                // Draw legend
                drawLegend();
            }
            
            function createToggleControls() {
                const controls = document.getElementById('controls');
                
                // Create toggle all button
                const toggleAllBtn = document.createElement('button');
                toggleAllBtn.textContent = 'Toggle All Series';
                toggleAllBtn.style.marginRight = '10px';
                toggleAllBtn.style.marginBottom = '10px';
                toggleAllBtn.addEventListener('click', () => {
                    const allVisible = plotData.every(data => data.visible);
                    plotData.forEach(data => {
                        data.visible = !allVisible;
                    });
                    render();
                    updateToggleButtons();
                });
                controls.appendChild(toggleAllBtn);
                
                // Create individual toggle buttons
                plotData.forEach((data, index) => {
                    const btn = document.createElement('button');
                    btn.dataset.index = index.toString();
                    btn.textContent = data.name || series;
                    btn.style.marginRight = '5px';
                    btn.style.marginBottom = '5px';
                    btn.style.opacity = data.visible ? '1' : '0.5';
                    btn.style.backgroundColor = data.color;
                    btn.style.color = getContrastColor(data.color);
                    btn.style.border = '1px solid #333';
                    btn.style.borderRadius = '4px';
                    btn.style.padding = '5px 10px';
                    
                    btn.addEventListener('click', () => {
                        data.visible = !data.visible;
                        btn.style.opacity = data.visible ? '1' : '0.5';
                        render();
                    });
                    
                    controls.appendChild(btn);
                });
            }
            
            function updateToggleButtons() {
                const controls = document.getElementById('controls');
                const buttons = controls.querySelectorAll('button');
                
                buttons.forEach((btn, index) => {
                    if (index === 0) return; // Skip toggle all button
                    const dataIndex = parseInt(btn.dataset.index);
                    btn.style.opacity = plotData[dataIndex].visible ? '1' : '0.5';
                });
            }
            
            function getContrastColor(hexColor) {
                // Convert hex to RGB
                const r = parseInt(hexColor.slice(1, 3), 16);
                const g = parseInt(hexColor.slice(3, 5), 16);
                const b = parseInt(hexColor.slice(5, 7), 16);
                
                // Calculate perceived brightness
                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                
                // Return black or white based on brightness
                return brightness > 128 ? 'black' : 'white';
            }
            
            // Initialize
            createToggleControls();
            render();
        </script>
    </body>
    </html>
    `

    fs.writeFileSync(filename, htmlContent)
  }
}
