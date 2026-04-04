/** Check if native audio capture is available (input device exists). */
export function isNativeAudioAvailable(): boolean

/** Start recording from default input. Returns true if started. */
export function startNativeRecording(
  onData: (data: Buffer) => void,
  onEnd: () => void,
): boolean

/** Stop recording. */
export function stopNativeRecording(): void

/** Check if recording is active. */
export function isNativeRecordingActive(): boolean

/** Start playback on default output. Returns true if started. */
export function startNativePlayback(sampleRate: number, channels: number): boolean

/** Write PCM i16 LE data to playback buffer. */
export function writeNativePlaybackData(data: Buffer): boolean

/** Stop playback. */
export function stopNativePlayback(): void

/** Check if playback is active. */
export function isNativePlaying(): boolean

/**
 * Microphone authorization status.
 * macOS: 0=notDetermined, 1=restricted, 2=denied, 3=authorized
 * Linux: always 3
 * Windows: 3 if allowed, 2 if denied
 * No native module: 0
 */
export function microphoneAuthorizationStatus(): number
