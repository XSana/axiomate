import { describe, it, expect, beforeAll } from 'vitest'
import { getImageProcessor, getImageCreator, sharp, sharpAsync } from '../src/index.js'

// 1x1 red PNG (68 bytes)
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

// 2x2 blue PNG
const BLUE_2x2_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGAB8IBQFxBAJdAAAAAElFTkSuQmCC',
  'base64',
)

describe('sharp image processing', () => {
  beforeAll(async () => {
    // Ensure sharp is loaded before sync tests
    await getImageProcessor()
  })

  describe('getImageProcessor', () => {
    it('returns a function', async () => {
      const fn = await getImageProcessor()
      expect(typeof fn).toBe('function')
    })

    it('returns same instance on second call', async () => {
      const fn1 = await getImageProcessor()
      const fn2 = await getImageProcessor()
      expect(fn1).toBe(fn2)
    })
  })

  describe('getImageCreator', () => {
    it('returns a function', async () => {
      const fn = await getImageCreator()
      expect(typeof fn).toBe('function')
    })
  })

  describe('metadata', () => {
    it('reads PNG metadata', async () => {
      const meta = await sharp(RED_PNG).metadata()
      expect(meta.width).toBe(1)
      expect(meta.height).toBe(1)
      expect(meta.format).toBe('png')
    })

    it('reads 2x2 PNG metadata', async () => {
      const meta = await sharp(BLUE_2x2_PNG).metadata()
      expect(meta.width).toBe(2)
      expect(meta.height).toBe(2)
    })
  })

  describe('resize', () => {
    it('resizes image', async () => {
      const creator = await getImageCreator()
      const img = creator({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
      const resized = await img.resize(50, 50).png().toBuffer()
      const meta = await sharp(resized).metadata()
      expect(meta.width).toBe(50)
      expect(meta.height).toBe(50)
    })

    it('respects withoutEnlargement', async () => {
      const buf = await sharp(RED_PNG)
        .resize(100, 100, { withoutEnlargement: true })
        .toBuffer()
      const meta = await sharp(buf).metadata()
      // 1x1 image should NOT be enlarged to 100x100
      expect(meta.width).toBeLessThanOrEqual(1)
      expect(meta.height).toBeLessThanOrEqual(1)
    })

    it('respects fit inside', async () => {
      const creator = await getImageCreator()
      const img = creator({
        create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 255, b: 0 } },
      })
      const buf = await img.resize(50, 50, { fit: 'inside' }).png().toBuffer()
      const meta = await sharp(buf).metadata()
      // 200x100 fit inside 50x50 → 50x25
      expect(meta.width).toBeLessThanOrEqual(50)
      expect(meta.height).toBeLessThanOrEqual(50)
    })
  })

  describe('format conversion', () => {
    it('converts to JPEG', async () => {
      const buf = await sharp(RED_PNG).jpeg({ quality: 80 }).toBuffer()
      expect(buf.length).toBeGreaterThan(0)
      // JPEG starts with FF D8
      expect(buf[0]).toBe(0xff)
      expect(buf[1]).toBe(0xd8)
    })

    it('converts to WebP', async () => {
      const buf = await sharp(RED_PNG).webp({ quality: 80 }).toBuffer()
      expect(buf.length).toBeGreaterThan(0)
      // WebP starts with RIFF
      expect(buf.subarray(0, 4).toString()).toBe('RIFF')
    })

    it('re-encodes PNG with compression', async () => {
      const buf = await sharp(RED_PNG)
        .png({ compressionLevel: 9, palette: true })
        .toBuffer()
      expect(buf.length).toBeGreaterThan(0)
      // PNG starts with 89 50 4E 47
      expect(buf[0]).toBe(0x89)
      expect(buf[1]).toBe(0x50)
    })
  })

  describe('chained operations', () => {
    it('resize + jpeg', async () => {
      const creator = await getImageCreator()
      const img = creator({
        create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } },
      })
      const buf = await img
        .resize(50, 50, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer()
      expect(buf.length).toBeGreaterThan(0)
      expect(buf[0]).toBe(0xff) // JPEG
    })

    it('resize + png', async () => {
      const creator = await getImageCreator()
      const img = creator({
        create: { width: 80, height: 80, channels: 3, background: { r: 128, g: 128, b: 128 } },
      })
      const buf = await img
        .resize(40, 40)
        .png({ compressionLevel: 9, palette: true })
        .toBuffer()
      expect(buf[0]).toBe(0x89) // PNG
    })
  })

  describe('sharpAsync', () => {
    it('works without prior getImageProcessor call', async () => {
      const instance = await sharpAsync(RED_PNG)
      const meta = await instance.metadata()
      expect(meta.width).toBe(1)
    })
  })

  describe('error handling', () => {
    it('throws on invalid buffer', async () => {
      await expect(sharp(Buffer.from('not an image')).metadata()).rejects.toThrow()
    })
  })
})
