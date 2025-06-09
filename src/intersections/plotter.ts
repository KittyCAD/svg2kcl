import { Canvas, CanvasRenderingContext2D, createCanvas } from 'canvas'
import fs from 'fs'
import { Point } from '../types/base'
import { Arc, Bezier, Intersection, Line } from './intersections'

export class Plotter {
  private canvas: Canvas
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private margin: number
  private scaleX: number = 1
  private scaleY: number = 1
  private minX: number
  private minY: number
  private maxX: number
  private maxY: number

  constructor(width = 800, height = 600, margin = 50) {
    this.canvas = createCanvas(width, height)
    this.ctx = this.canvas.getContext('2d')
    this.width = width
    this.height = height
    this.margin = margin

    this.minX = 0
    this.minY = 0
    this.maxX = 10
    this.maxY = 10
    this.updateScale()

    this.setupCanvas()
  }

  private setupCanvas(): void {
    this.ctx.fillStyle = 'white'
    this.ctx.fillRect(0, 0, this.width, this.height)
  }

  setBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    this.minX = Math.floor(minX)
    this.minY = Math.floor(minY)
    this.maxX = Math.ceil(maxX)
    this.maxY = Math.ceil(maxY)
    this.updateScale()
    this.drawAxes()
  }

  private updateScale(): void {
    this.scaleX = (this.width - 2 * this.margin) / (this.maxX - this.minX)
    this.scaleY = (this.height - 2 * this.margin) / (this.maxY - this.minY)
  }

  private transformX(x: number): number {
    return this.margin + (x - this.minX) * this.scaleX
  }

  private transformY(y: number): number {
    return this.height - this.margin - (y - this.minY) * this.scaleY
  }

  private transformPoint(point: Point): Point {
    return {
      x: this.transformX(point.x),
      y: this.transformY(point.y)
    }
  }

  drawAxes(): void {
    this.ctx.strokeStyle = '#000000'
    this.ctx.lineWidth = 2
    this.ctx.setLineDash([])

    this.ctx.beginPath()
    this.ctx.moveTo(this.margin, this.transformY(0))
    this.ctx.lineTo(this.width - this.margin, this.transformY(0))
    this.ctx.moveTo(this.transformX(0), this.margin)
    this.ctx.lineTo(this.transformX(0), this.height - this.margin)
    this.ctx.stroke()

    this.ctx.strokeStyle = '#000000'
    this.ctx.lineWidth = 2
    this.ctx.beginPath()
    this.ctx.moveTo(this.margin, this.height - this.margin)
    this.ctx.lineTo(this.width - this.margin, this.height - this.margin)
    this.ctx.moveTo(this.margin, this.margin)
    this.ctx.lineTo(this.margin, this.height - this.margin)
    this.ctx.stroke()

    this.ctx.fillStyle = '#333'
    this.ctx.font = '12px Arial'
    this.ctx.textAlign = 'center'
    this.ctx.textBaseline = 'top'
    // X axis min
    this.ctx.fillText(this.minX.toString(), this.margin, this.height - this.margin + 5)
    // X axis max
    this.ctx.fillText(this.maxX.toString(), this.width - this.margin, this.height - this.margin + 5)
    this.ctx.textAlign = 'right'
    this.ctx.textBaseline = 'middle'
    // Y axis min
    this.ctx.fillText(this.minY.toString(), this.margin - 5, this.height - this.margin)
    // Y axis max
    this.ctx.fillText(this.maxY.toString(), this.margin - 5, this.margin)
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'alphabetic'
  }

  plotLine(line: Line, color = 'blue', lineWidth = 2, label?: string): void {
    const start = this.transformPoint(line.start)
    const end = this.transformPoint(line.end)

    this.ctx.strokeStyle = color
    this.ctx.lineWidth = lineWidth
    this.ctx.setLineDash([])

    this.ctx.beginPath()
    this.ctx.moveTo(start.x, start.y)
    this.ctx.lineTo(end.x, end.y)
    this.ctx.stroke()

    if (label) {
      this.ctx.fillStyle = color
      this.ctx.font = '12px Arial'
      const midPoint = {
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2 - 10
      }
      this.ctx.fillText(label, midPoint.x, midPoint.y)
    }
  }

  plotBezier(bezier: Bezier, color = 'green', lineWidth = 2, label?: string): void {
    const start = this.transformPoint(bezier.start)
    const control1 = this.transformPoint(bezier.control1)
    const control2 = this.transformPoint(bezier.control2)
    const end = this.transformPoint(bezier.end)

    this.ctx.strokeStyle = color
    this.ctx.lineWidth = lineWidth
    this.ctx.setLineDash([])

    this.ctx.beginPath()
    this.ctx.moveTo(start.x, start.y)
    this.ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y)
    this.ctx.stroke()

    // Draw control points and lines (optional)
    this.ctx.strokeStyle = color
    this.ctx.lineWidth = 1
    this.ctx.setLineDash([5, 5])
    this.ctx.beginPath()
    this.ctx.moveTo(start.x, start.y)
    this.ctx.lineTo(control1.x, control1.y)
    this.ctx.moveTo(end.x, end.y)
    this.ctx.lineTo(control2.x, control2.y)
    this.ctx.stroke()

    this.ctx.fillStyle = color
    this.ctx.fillRect(control1.x - 2, control1.y - 2, 4, 4)
    this.ctx.fillRect(control2.x - 2, control2.y - 2, 4, 4)

    if (label) {
      this.ctx.fillStyle = color
      this.ctx.font = '12px Arial'
      this.ctx.fillText(label, start.x + 5, start.y - 5)
    }
  }

  plotArc(arc: Arc, color = 'purple', lineWidth = 2, label?: string): void {
    const center = this.transformPoint(arc.center)
    const radiusX = arc.radius * this.scaleX
    const radiusY = arc.radius * this.scaleY

    this.ctx.strokeStyle = color
    this.ctx.lineWidth = lineWidth
    this.ctx.setLineDash([])

    let startAngle = arc.startAngle
    let endAngle = arc.endAngle

    // Canvas Y is flipped, so we need to adjust angles
    startAngle = -startAngle
    endAngle = -endAngle

    if (arc.clockwise) {
      ;[startAngle, endAngle] = [endAngle, startAngle]
    }

    this.ctx.beginPath()
    this.ctx.ellipse(
      center.x,
      center.y,
      radiusX,
      radiusY,
      0,
      startAngle,
      endAngle,
      arc.clockwise || false
    )
    this.ctx.stroke()

    if (label) {
      this.ctx.fillStyle = color
      this.ctx.font = '12px Arial'
      this.ctx.fillText(label, center.x + radiusX + 5, center.y)
    }
  }

  plotIntersections(intersections: Intersection[], color = 'red', radius = 4): void {
    this.ctx.fillStyle = color

    intersections.forEach((intersection, index) => {
      const point = this.transformPoint(intersection.point)

      this.ctx.beginPath()
      this.ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI)
      this.ctx.fill()

      // Add intersection number
      this.ctx.fillStyle = 'white'
      this.ctx.font = 'bold 10px Arial'
      this.ctx.textAlign = 'center'
      this.ctx.fillText((index + 1).toString(), point.x, point.y + 3)
      this.ctx.fillStyle = color
    })
  }

  plotPoint(point: Point, color = 'black', radius = 5, label?: string): void {
    const transformedPoint = this.transformPoint(point)

    this.ctx.fillStyle = color
    this.ctx.beginPath()
    this.ctx.arc(transformedPoint.x, transformedPoint.y, radius, 0, 2 * Math.PI)
    this.ctx.fill()

    if (label) {
      this.ctx.fillStyle = color
      this.ctx.font = '12px Arial'
      this.ctx.fillText(label, transformedPoint.x + 5, transformedPoint.y - 5)
    }
  }

  addTitle(title: string): void {
    this.ctx.fillStyle = 'black'
    this.ctx.font = 'bold 16px Arial'
    this.ctx.textAlign = 'center'
    this.ctx.fillText(title, this.width / 2, 30)
  }

  save(filename: string): void {
    const buffer = this.canvas.toBuffer('image/png')
    fs.writeFileSync(filename, buffer)
  }

  clear(): void {
    this.setupCanvas()
  }
}
