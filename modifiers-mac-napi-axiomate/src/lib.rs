use napi_derive::napi;

/// Get all currently pressed modifier keys.
/// Returns an array of modifier names: "shift", "command", "control", "option".
/// Returns empty array on non-macOS platforms.
#[napi]
pub fn get_modifiers() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        macos::get_modifiers()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

/// Check if a specific modifier key is currently pressed.
/// Returns false on non-macOS platforms.
#[napi]
pub fn is_modifier_pressed(modifier: String) -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::is_modifier_pressed(&modifier)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = modifier;
        false
    }
}

/// Pre-warm the module (no-op, but triggers loading of the .node binary).
#[napi]
pub fn prewarm() {}

#[cfg(target_os = "macos")]
mod macos {
    // CoreGraphics event source flags
    // https://developer.apple.com/documentation/coregraphics/cgeventsourcestateid
    const COMBINED_SESSION_STATE: i32 = 0; // kCGEventSourceStateCombinedSessionState

    // CGEventFlags bit masks
    const MASK_SHIFT: u64 = 0x00020000;     // kCGEventFlagMaskShift
    const MASK_CONTROL: u64 = 0x00040000;   // kCGEventFlagMaskControl
    const MASK_ALTERNATE: u64 = 0x00080000; // kCGEventFlagMaskAlternate (Option)
    const MASK_COMMAND: u64 = 0x00100000;   // kCGEventFlagMaskCommand

    extern "C" {
        fn CGEventSourceFlagsState(stateID: i32) -> u64;
    }

    fn get_flags() -> u64 {
        unsafe { CGEventSourceFlagsState(COMBINED_SESSION_STATE) }
    }

    pub fn get_modifiers() -> Vec<String> {
        let flags = get_flags();
        let mut result = Vec::new();
        if flags & MASK_SHIFT != 0 {
            result.push("shift".to_string());
        }
        if flags & MASK_COMMAND != 0 {
            result.push("command".to_string());
        }
        if flags & MASK_CONTROL != 0 {
            result.push("control".to_string());
        }
        if flags & MASK_ALTERNATE != 0 {
            result.push("option".to_string());
        }
        result
    }

    pub fn is_modifier_pressed(modifier: &str) -> bool {
        let flags = get_flags();
        match modifier {
            "shift" => flags & MASK_SHIFT != 0,
            "command" => flags & MASK_COMMAND != 0,
            "control" => flags & MASK_CONTROL != 0,
            "option" => flags & MASK_ALTERNATE != 0,
            _ => false,
        }
    }
}
