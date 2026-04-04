// Bun global type — only available in Bun runtime, checked via typeof.
// bun:bundle and MACRO are now handled by runtime/bun-polyfill.ts and runtime/macro.ts.
declare const Bun:
  | {
      hash(input: string, seed?: bigint | number): bigint
      gc(force?: boolean): void
      version: string
      semver: {
        satisfies(version: string, range: string): boolean
        order(a: string, b: string): number
        [key: string]: any
      }
      stringWidth(input: string, options?: any): number
      wrapAnsi(input: string, columns: number, options?: any): string
      embeddedFiles: any[]
      spawn(args: any, options?: any): any
      listen(options: any): any
      which(name: string): string | null
      YAML: { parse(input: string): any; stringify(value: any): string; [key: string]: any }
      JSONL: { parse(input: string): any[]; stringify(values: any[]): string; [key: string]: any }
      indexOfFirstDifference(a: string, b: string): number
      generateHeapSnapshot(): any
    }
  | undefined
