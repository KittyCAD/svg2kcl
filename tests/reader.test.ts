import { describe, expect, it } from '@jest/globals'
import path from 'path'
import { SvgReader, SvgReadError } from '../src/reader/base'
import { ElementType } from '../src/types/elements'

const dataDir = path.join(__dirname, 'data', 'elements')

describe('SvgReader', () => {
  const reader = new SvgReader()

  describe('Basic Element Reading', () => {
    it('should correctly read basic_path.svg', async () => {
      const filepath = path.join(dataDir, 'basic_path.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.viewBox).toEqual({ xMin: 0, yMin: 0, width: 100, height: 100 })
      expect(svg.elements).toHaveLength(1)
      expect(svg.elements[0].type).toBe(ElementType.Path)
    })

    it('should correctly read basic_rectangle.svg', async () => {
      const filepath = path.join(dataDir, 'basic_rectangle.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(2)
      expect(svg.elements[0].type).toBe(ElementType.Rectangle)
      expect(svg.elements[1].type).toBe(ElementType.Rectangle)

      // Check rounded rectangle attributes
      const roundedRect = svg.elements[1] as any
      expect(roundedRect.rx).toBe(10)
      expect(roundedRect.ry).toBe(10)
    })

    it('should correctly read basic_circle.svg', async () => {
      const filepath = path.join(dataDir, 'basic_circle.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(2)
      svg.elements.forEach((element) => {
        expect(element.type).toBe(ElementType.Circle)
      })
    })

    it('should correctly read basic_line.svg', async () => {
      const filepath = path.join(dataDir, 'basic_line.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(2)
      svg.elements.forEach((element) => {
        expect(element.type).toBe(ElementType.Line)
      })
    })

    it('should correctly read basic_polyline.svg', async () => {
      const filepath = path.join(dataDir, 'basic_polyline.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(2)
      svg.elements.forEach((element) => {
        expect(element.type).toBe(ElementType.Polyline)
      })
    })

    it('should correctly read basic_polygon.svg', async () => {
      const filepath = path.join(dataDir, 'basic_polygon.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(2)
      svg.elements.forEach((element) => {
        expect(element.type).toBe(ElementType.Polygon)
      })
    })
  })

  describe('Group Element Reading', () => {
    it('should correctly read basic_group.svg', async () => {
      const filepath = path.join(dataDir, 'basic_group.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(2)
      svg.elements.forEach((element) => {
        expect(element.type).toBe(ElementType.Group)
      })

      // Check first group contents
      const firstGroup = svg.elements[0] as any
      expect(firstGroup.children).toHaveLength(2)
      expect(firstGroup.children[0].type).toBe(ElementType.Rectangle)
      expect(firstGroup.children[1].type).toBe(ElementType.Circle)

      // Check second group contents
      const secondGroup = svg.elements[1] as any
      expect(secondGroup.children).toHaveLength(2)
      expect(secondGroup.children[0].type).toBe(ElementType.Line)
      expect(secondGroup.children[1].type).toBe(ElementType.Polygon)
    })

    it('should correctly read nested_group.svg', async () => {
      const filepath = path.join(dataDir, 'nested_group.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(1)
      expect(svg.elements[0].type).toBe(ElementType.Group)

      const rootGroup = svg.elements[0] as any
      expect(rootGroup.children).toHaveLength(2)
      expect(rootGroup.children[0].type).toBe(ElementType.Group)
      expect(rootGroup.children[1].type).toBe(ElementType.Group)

      // Check nested group contents
      const firstNestedGroup = rootGroup.children[0]
      expect(firstNestedGroup.children).toHaveLength(2)
      expect(firstNestedGroup.children[0].type).toBe(ElementType.Rectangle)
      expect(firstNestedGroup.children[1].type).toBe(ElementType.Circle)
    })
  })

  describe('Complex Cases', () => {
    it('should correctly read mixed_elements.svg', async () => {
      const filepath = path.join(dataDir, 'mixed_elements.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(5)
      expect(svg.elements[0].type).toBe(ElementType.Rectangle)
      expect(svg.elements[1].type).toBe(ElementType.Circle)
      expect(svg.elements[2].type).toBe(ElementType.Line)
      expect(svg.elements[3].type).toBe(ElementType.Path)
      expect(svg.elements[4].type).toBe(ElementType.Polygon)
    })
  })

  describe('Error Cases', () => {
    it('should throw error for non-existent file', async () => {
      const filepath = path.join(dataDir, 'non_existent.svg')
      await expect(reader.readFile(filepath)).rejects.toThrow(SvgReadError)
    })

    it('should correctly read invalid_polyline.svg without throwing', async () => {
      const filepath = path.join(dataDir, 'invalid_polyline.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(1)
      expect(svg.elements[0].type).toBe(ElementType.Polyline)
    })

    it('should correctly read invalid_polygon.svg without throwing', async () => {
      const filepath = path.join(dataDir, 'invalid_polygon.svg')
      const svg = await reader.readFile(filepath)

      expect(svg.elements).toHaveLength(1)
      expect(svg.elements[0].type).toBe(ElementType.Polygon)
    })

    it('should throw error for invalid XML', async () => {
      const filepath = path.join(dataDir, 'invalid.svg')
      await expect(reader.readFile(filepath)).rejects.toThrow(SvgReadError)
    })
  })
})
