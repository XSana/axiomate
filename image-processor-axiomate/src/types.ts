export type ClipboardImageResult = {
  png: Buffer
  originalWidth: number
  originalHeight: number
  width: number
  height: number
}

export interface ImageMetadata {
  width: number
  height: number
  format: string
}

export interface SharpInstance {
  metadata(): Promise<ImageMetadata>
  composite(
    images: Array<{ input: Buffer }>,
  ): SharpInstance
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(options?: { quality?: number }): SharpInstance
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

export type SharpFunction = (input: Buffer) => SharpInstance

export interface SharpCreatorOptions {
  create: {
    width: number
    height: number
    channels: 3 | 4
    background: { r: number; g: number; b: number }
  }
}

export type SharpCreator = (options: SharpCreatorOptions) => SharpInstance

export interface NativeModule {
  processImage: (input: Buffer) => Promise<SharpInstance>
  readClipboardImage?: (maxWidth: number, maxHeight: number) => ClipboardImageResult | null
  hasClipboardImage?: () => boolean
}
