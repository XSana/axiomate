use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

// ─── Global state ───────────────────────────────────────────────────

static RECORDING: AtomicBool = AtomicBool::new(false);
static PLAYING: AtomicBool = AtomicBool::new(false);

// cpal::Stream is !Send+!Sync, but we only access it behind a Mutex
// from the main JS thread (start/stop). The audio callback runs on
// cpal's own thread and doesn't touch these statics.
// Field holds ownership to keep the stream alive (drop = stop).
struct SendStream(#[allow(dead_code)] cpal::Stream);
unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

static RECORD_STREAM: Mutex<Option<SendStream>> = Mutex::new(None);
static PLAYBACK_STREAM: Mutex<Option<SendStream>> = Mutex::new(None);
static PLAYBACK_BUFFER: Mutex<Option<Arc<Mutex<Vec<i16>>>>> = Mutex::new(None);

// ─── Availability ───────────────────────────────────────────────────

/// Check if native audio capture is available (i.e., an input device exists).
#[napi]
pub fn is_native_audio_available() -> bool {
    cpal::default_host().default_input_device().is_some()
}

// ─── Recording ──────────────────────────────────────────────────────

/// Start recording from the default input device.
/// `on_data` receives PCM i16 LE chunks as Buffer.
/// `on_end` is called if the stream ends unexpectedly.
/// Returns true if recording started successfully.
#[napi]
pub fn start_native_recording(
    on_data: ThreadsafeFunction<Buffer, ErrorStrategy::Fatal>,
    on_end: ThreadsafeFunction<(), ErrorStrategy::Fatal>,
) -> bool {
    if RECORDING.load(Ordering::Relaxed) {
        return false;
    }

    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => return false,
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(_) => return false,
    };

    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();

    let on_data_clone = on_data.clone();
    let on_end_clone = on_end.clone();

    let err_fn = move |_err: cpal::StreamError| {
        RECORDING.store(false, Ordering::Relaxed);
        on_end_clone.call((), ThreadsafeFunctionCallMode::NonBlocking);
    };

    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // Convert f32 → i16 LE bytes
                let i16_samples: Vec<i16> = data
                    .iter()
                    .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
                    .collect();
                let bytes: Vec<u8> = i16_samples
                    .iter()
                    .flat_map(|s| s.to_le_bytes())
                    .collect();
                on_data_clone.call(
                    Buffer::from(bytes),
                    ThreadsafeFunctionCallMode::NonBlocking,
                );
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _: &cpal::InputCallbackInfo| {
                let bytes: Vec<u8> = data
                    .iter()
                    .flat_map(|s| s.to_le_bytes())
                    .collect();
                on_data_clone.call(
                    Buffer::from(bytes),
                    ThreadsafeFunctionCallMode::NonBlocking,
                );
            },
            err_fn,
            None,
        ),
        _ => return false,
    };

    let stream = match stream {
        Ok(s) => s,
        Err(_) => return false,
    };

    if stream.play().is_err() {
        return false;
    }

    RECORDING.store(true, Ordering::Relaxed);
    if let Ok(mut guard) = RECORD_STREAM.lock() {
        *guard = Some(SendStream(stream));
    }
    true
}

/// Stop the current recording.
#[napi]
pub fn stop_native_recording() {
    RECORDING.store(false, Ordering::Relaxed);
    if let Ok(mut guard) = RECORD_STREAM.lock() {
        // Dropping the stream stops it
        *guard = None;
    }
}

/// Check if recording is currently active.
#[napi]
pub fn is_native_recording_active() -> bool {
    RECORDING.load(Ordering::Relaxed)
}

// ─── Playback ───────────────────────────────────────────────────────

/// Start audio playback on the default output device.
#[napi]
pub fn start_native_playback(sample_rate: u32, channels: u32) -> bool {
    if PLAYING.load(Ordering::Relaxed) {
        return false;
    }

    let host = cpal::default_host();
    let device = match host.default_output_device() {
        Some(d) => d,
        None => return false,
    };

    let config = cpal::StreamConfig {
        channels: channels as u16,
        sample_rate: cpal::SampleRate(sample_rate),
        buffer_size: cpal::BufferSize::Default,
    };

    let buffer: Arc<Mutex<Vec<i16>>> = Arc::new(Mutex::new(Vec::new()));
    let buffer_clone = buffer.clone();

    let stream = device.build_output_stream(
        &config,
        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            if let Ok(mut buf) = buffer_clone.lock() {
                for sample in data.iter_mut() {
                    if buf.is_empty() {
                        *sample = 0.0;
                    } else {
                        let s = buf.remove(0);
                        *sample = s as f32 / 32768.0;
                    }
                }
            }
        },
        |_err| {
            PLAYING.store(false, Ordering::Relaxed);
        },
        None,
    );

    let stream = match stream {
        Ok(s) => s,
        Err(_) => return false,
    };

    if stream.play().is_err() {
        return false;
    }

    PLAYING.store(true, Ordering::Relaxed);
    if let Ok(mut guard) = PLAYBACK_STREAM.lock() {
        *guard = Some(SendStream(stream));
    }
    if let Ok(mut guard) = PLAYBACK_BUFFER.lock() {
        *guard = Some(buffer);
    }
    true
}

/// Write PCM i16 LE data to the playback buffer.
#[napi]
pub fn write_native_playback_data(data: Buffer) -> bool {
    if !PLAYING.load(Ordering::Relaxed) {
        return false;
    }

    if let Ok(guard) = PLAYBACK_BUFFER.lock() {
        if let Some(ref buffer) = *guard {
            if let Ok(mut buf) = buffer.lock() {
                // Convert i16 LE bytes to samples
                for chunk in data.chunks_exact(2) {
                    let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                    buf.push(sample);
                }
                return true;
            }
        }
    }
    false
}

/// Stop playback.
#[napi]
pub fn stop_native_playback() {
    PLAYING.store(false, Ordering::Relaxed);
    if let Ok(mut guard) = PLAYBACK_STREAM.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = PLAYBACK_BUFFER.lock() {
        *guard = None;
    }
}

/// Check if playback is active.
#[napi]
pub fn is_native_playing() -> bool {
    PLAYING.load(Ordering::Relaxed)
}

// ─── Microphone authorization ───────────────────────────────────────

/// Returns microphone authorization status.
/// macOS TCC: 0=notDetermined, 1=restricted, 2=denied, 3=authorized.
/// Linux: always 3 (no system-level mic permission API).
/// Windows: 3 if allowed, 2 if denied via registry.
#[napi]
pub fn microphone_authorization_status() -> i32 {
    #[cfg(target_os = "macos")]
    {
        macos_mic_status()
    }
    #[cfg(target_os = "linux")]
    {
        3 // authorized — Linux has no system mic permission API
    }
    #[cfg(target_os = "windows")]
    {
        windows_mic_status()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        0 // notDetermined
    }
}

#[cfg(target_os = "macos")]
fn macos_mic_status() -> i32 {
    // Use AVFoundation's AVCaptureDevice.authorizationStatus
    // via CoreFoundation C bridge
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        // AVAuthorizationStatus AVCaptureDevice_authorizationStatusForMediaType(CFStringRef)
        // We use the raw ObjC runtime instead
    }

    // Simpler approach: try to open an input device.
    // If cpal can open one, we have permission.
    let host = cpal::default_host();
    match host.default_input_device() {
        Some(device) => {
            match device.default_input_config() {
                Ok(_) => 3,  // authorized
                Err(_) => 2, // denied
            }
        }
        None => 0, // notDetermined (no device found)
    }
}

#[cfg(target_os = "windows")]
fn windows_mic_status() -> i32 {
    // Check Windows privacy settings via registry
    // HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone
    use std::process::Command;
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone",
            "/v",
            "Value",
        ])
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if stdout.contains("Deny") {
                2 // denied
            } else {
                3 // authorized (or not configured = allowed)
            }
        }
        Err(_) => 3, // Can't check registry, assume allowed
    }
}
