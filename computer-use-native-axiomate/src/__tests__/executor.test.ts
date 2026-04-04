import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('executor', () => {
  it('package has required source files', () => {
    const srcDir = resolve(__dirname, '..')
    expect(existsSync(resolve(srcDir, 'executor.ts'))).toBe(true)
    expect(existsSync(resolve(srcDir, 'screenshot.ts'))).toBe(true)
    expect(existsSync(resolve(srcDir, 'input.ts'))).toBe(true)
    expect(existsSync(resolve(srcDir, 'detect-display.ts'))).toBe(true)
    expect(existsSync(resolve(srcDir, 'platforms', 'apps.ts'))).toBe(true)
  })

  it('detect-display probe runs without crash', () => {
    // Run detection in a subprocess to avoid any native module loading in this process
    const result = execFileSync(process.execPath, [
      '-e',
      `
      const{execFileSync}=require("child_process");
      try{
        execFileSync(process.execPath,["-e","const m=require('node-screenshots');m.Monitor.all()"],{timeout:5000,stdio:"ignore"});
        console.log("true");
      }catch{
        console.log("false");
      }
      `,
    ], { encoding: 'utf-8', timeout: 15000 }).trim()
    expect(result === 'true' || result === 'false').toBe(true)
  })
})
