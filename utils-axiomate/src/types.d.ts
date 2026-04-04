declare const Bun: any

declare module 'bidi-js' {
  interface BidiResult {
    levels: number[]
    paragraphs: Array<{ start: number; end: number; level: number }>
  }
  function bidiFactory(): {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl' | 'auto'): BidiResult
    getReorderSegments(
      text: string,
      embeddingLevels: BidiResult,
      start?: number,
      end?: number,
    ): Array<[number, number]>
  }
  export default bidiFactory
}
