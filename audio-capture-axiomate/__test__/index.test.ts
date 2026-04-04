import { describe, it, expect } from 'vitest'
import {
  isNativeAudioAvailable,
  startNativeRecording,
  stopNativeRecording,
  isNativeRecordingActive,
  startNativePlayback,
  writeNativePlaybackData,
  stopNativePlayback,
  isNativePlaying,
  microphoneAuthorizationStatus,
} from '../index'

describe('audio-capture-axiomate', () => {
  describe('isNativeAudioAvailable', () => {
    it('returns boolean', () => {
      expect(typeof isNativeAudioAvailable()).toBe('boolean')
    })
  })

  describe('recording', () => {
    it('isNativeRecordingActive returns false initially', () => {
      expect(isNativeRecordingActive()).toBe(false)
    })

    it('stopNativeRecording does not throw when not recording', () => {
      expect(() => stopNativeRecording()).not.toThrow()
    })

    it('startNativeRecording returns boolean', () => {
      const result = startNativeRecording(
        (_data) => {},
        () => {},
      )
      expect(typeof result).toBe('boolean')
      // Clean up if it started
      if (result) stopNativeRecording()
    })
  })

  describe('playback', () => {
    it('isNativePlaying returns false initially', () => {
      expect(isNativePlaying()).toBe(false)
    })

    it('stopNativePlayback does not throw when not playing', () => {
      expect(() => stopNativePlayback()).not.toThrow()
    })

    it('writeNativePlaybackData returns false when not playing', () => {
      expect(writeNativePlaybackData(Buffer.alloc(100))).toBe(false)
    })

    it('startNativePlayback returns boolean', () => {
      const result = startNativePlayback(44100, 1)
      expect(typeof result).toBe('boolean')
      if (result) stopNativePlayback()
    })
  })

  describe('microphoneAuthorizationStatus', () => {
    it('returns a number 0-3', () => {
      const status = microphoneAuthorizationStatus()
      expect(typeof status).toBe('number')
      expect(status).toBeGreaterThanOrEqual(0)
      expect(status).toBeLessThanOrEqual(3)
    })
  })
})
