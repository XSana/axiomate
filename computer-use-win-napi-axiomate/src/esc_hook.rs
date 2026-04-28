//! Windows global Escape hotkey via WH_KEYBOARD_LL.
//!
//! Mirrors the macOS CGEventTap hotkey in computer-use-mac-napi-axiomate:
//! while registered, system-wide ESC keydown fires the JS callback (turn
//! abort) and is **consumed** before reaching any application — PI defense
//! so a prompt-injected `key("escape")` from the model cannot dismiss
//! confirmation dialogs.
//!
//! ## Threading model
//!
//! WH_KEYBOARD_LL fires the hook procedure on the same thread that called
//! SetWindowsHookExW, and that thread MUST run a Win32 message pump
//! (GetMessage / DispatchMessage). napi's main thread is busy with V8 and
//! has no Win32 message loop, so we spawn a dedicated worker thread that
//! installs the hook and runs the pump for the hook's lifetime.
//!
//! Lifecycle:
//!   register   → spawn worker thread → SetWindowsHookExW → pump messages
//!   unregister → PostThreadMessageW(WM_QUIT) → pump exits → UnhookWindowsHookEx → join
//!
//! The hook proc returns within microseconds (one atomic load + maybe one
//! NonBlocking ThreadsafeFunction call). Win32 unhooks any hook that takes
//! >300ms to return, so we never do real work in the proc itself.
//!
//! ## notify_expected_escape decay
//!
//! When the model synthesizes an Escape (executor's `key("escape")` path),
//! we don't want our own tap to abort the turn. The executor calls
//! notify_expected_escape() ~1ms before injecting the synthetic event;
//! that sets a 100ms expiration timestamp. Hook proc checks the timestamp
//! before calling the callback — within the window, the synthetic ESC
//! flows through to its target without firing the abort.

use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW,
    SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HHOOK,
    KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
};

// ── State (process-global) ────────────────────────────────────────────────
// HOOK_HANDLE: HHOOK is a wrapper around isize; we store the raw value so the
//   static can be const-initialized (HHOOK itself isn't const-default).
// THREAD_ID: 0 = no hook thread; non-zero = thread is alive and pumping.
// THREAD_HANDLE: JoinHandle so unregister can join after WM_QUIT.
// CALLBACK: the JS callback to invoke on real ESC.
// EXPECTED_ESC_UNTIL_MS: timestamp through which a keydown should be passed
//   through (synthetic ESC), not treated as a user abort.
static HOOK_HANDLE: Mutex<Option<isize>> = Mutex::new(None);
static THREAD_ID: AtomicU32 = AtomicU32::new(0);
static THREAD_HANDLE: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
static CALLBACK: Mutex<Option<ThreadsafeFunction<()>>> = Mutex::new(None);
static EXPECTED_ESC_UNTIL_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ── Hook procedure ───────────────────────────────────────────────────────
// Runs on the worker thread (same one that called SetWindowsHookExW). Must
// be fast: any return >300ms causes the OS to silently uninstall the hook.

extern "system" fn keyboard_hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // Per docs: code < 0 means the hook MUST chain without further
    // processing. We never read lparam in that case.
    if code < 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    // SAFETY: when code >= 0 and the hook is WH_KEYBOARD_LL, lparam points
    // to a KBDLLHOOKSTRUCT owned by the OS for this dispatch.
    let s = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
    let event = wparam.0 as u32;
    let is_keydown = event == WM_KEYDOWN || event == WM_SYSKEYDOWN;

    if is_keydown && s.vkCode == VK_ESCAPE.0 as u32 {
        // Decay window for model-synthesized ESC. If the executor recently
        // called notify_expected_escape(), let this keydown flow to its
        // target (don't abort, don't consume).
        let now = now_ms();
        let until = EXPECTED_ESC_UNTIL_MS.load(Ordering::Relaxed);
        if now < until {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        // Real user ESC: invoke JS callback (non-blocking) and consume.
        // Returning a non-zero LRESULT prevents the event from propagating
        // to other apps — the PI defense bit.
        if let Ok(guard) = CALLBACK.lock() {
            if let Some(tsfn) = guard.as_ref() {
                tsfn.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
            }
        }
        return LRESULT(1);
    }

    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

// ── Worker thread main ────────────────────────────────────────────────────
// Installs the hook, then runs a GetMessage/DispatchMessage pump until WM_QUIT.
// Unhooks on exit (must happen on the same thread that installed).

fn hook_thread_main() {
    // hMod=NULL is allowed for low-level hooks when the hook proc lives in
    // the calling process (which our cdylib does — it's loaded into Node's
    // address space). Avoids needing GetModuleHandle for the .node file
    // (its filename would be brittle to depend on).
    let hook = unsafe {
        SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(keyboard_hook_proc),
            HINSTANCE(std::ptr::null_mut()),
            0, // 0 thread id = global hook (all threads in current desktop)
        )
    };

    let hook = match hook {
        Ok(h) => h,
        Err(_) => {
            // Install failed (typically: low-integrity desktop, secure
            // desktop in transition, or a hook count limit hit). Thread
            // exits without setting THREAD_ID; caller's spin times out
            // and returns false. The agent layer falls back to "no ESC
            // abort, use Ctrl+C" — same fallback path mac uses when
            // CGEventTap creation fails.
            return;
        }
    };

    if let Ok(mut g) = HOOK_HANDLE.lock() {
        *g = Some(hook.0 as isize);
    }

    // Mark ready. register() spins until this is non-zero.
    THREAD_ID.store(unsafe { GetCurrentThreadId() }, Ordering::SeqCst);

    // Message pump. WH_KEYBOARD_LL needs this thread to dispatch messages
    // for the hook proc to fire. Loop exits when GetMessage returns FALSE
    // (received WM_QUIT) or BOOL(-1) (error — hwnd invalid).
    let mut msg = MSG::default();
    loop {
        let ret = unsafe { GetMessageW(&mut msg, None, 0, 0) };
        if !ret.as_bool() {
            // 0 = WM_QUIT. -1 = error. Both: exit pump.
            break;
        }
        unsafe {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }

    // Unhook on the same thread. Errors here are logged by Win but not
    // actionable from our side (process is shutting down or hook was
    // already torn down).
    let hook_to_remove = HOOK_HANDLE.lock().ok().and_then(|mut g| g.take());
    if let Some(h) = hook_to_remove {
        let _ = unsafe { UnhookWindowsHookEx(HHOOK(h as *mut _)) };
    }
    THREAD_ID.store(0, Ordering::SeqCst);
}

// ── Public API (called from #[napi] wrappers in lib.rs) ──────────────────

pub fn register(callback: ThreadsafeFunction<()>) -> bool {
    // Idempotent re-register: if a thread is already running we update the
    // callback (in case the JS side rebuilt it across CU sessions) and
    // return success.
    if THREAD_ID.load(Ordering::SeqCst) != 0 {
        if let Ok(mut g) = CALLBACK.lock() {
            *g = Some(callback);
        }
        return true;
    }

    // First registration: install callback, spawn worker, spin briefly to
    // confirm hook installed.
    if let Ok(mut g) = CALLBACK.lock() {
        *g = Some(callback);
    } else {
        return false;
    }

    let handle = thread::spawn(hook_thread_main);
    if let Ok(mut g) = THREAD_HANDLE.lock() {
        *g = Some(handle);
    }

    // Spin up to 50ms for the hook to install. SetWindowsHookExW is fast
    // (microseconds) on the happy path; slow only when contended with
    // session-switch events. If we time out, the agent gets `false` and
    // tells the user to use Ctrl+C — same UX as mac without Accessibility.
    for _ in 0..50 {
        if THREAD_ID.load(Ordering::SeqCst) != 0 {
            return true;
        }
        thread::sleep(Duration::from_millis(1));
    }
    false
}

pub fn unregister() {
    // Drain THREAD_ID first so a concurrent register sees us as not-running
    // and doesn't fast-path to "already registered".
    let tid = THREAD_ID.swap(0, Ordering::SeqCst);
    if tid != 0 {
        // PostThreadMessageW returns Err if the thread already exited (race
        // with hook install failure). That's fine — there's nothing to
        // wake up, and join will return immediately.
        let _ = unsafe { PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0)) };
    }

    // Take the JoinHandle out of the mutex BEFORE joining so we don't hold
    // the lock across a potentially slow join (the worker thread doesn't
    // touch THREAD_HANDLE, so this is paranoia, not necessity).
    let handle = THREAD_HANDLE.lock().ok().and_then(|mut g| g.take());
    if let Some(h) = handle {
        let _ = h.join();
    }

    if let Ok(mut g) = CALLBACK.lock() {
        *g = None;
    }
}

pub fn notify_expected_escape() {
    // 100ms decay matches mac's pattern. The executor calls this immediately
    // before injecting a synthetic ESC; the hook proc compares against this
    // timestamp on each ESC keydown.
    let now = now_ms();
    EXPECTED_ESC_UNTIL_MS.store(now + 100, Ordering::Relaxed);
}
