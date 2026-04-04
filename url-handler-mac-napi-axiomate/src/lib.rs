use napi_derive::napi;

/// Wait for a macOS URL event (Apple Event kAEGetURL).
///
/// Initializes NSApplication, registers for the URL event, and pumps
/// the event loop for up to `timeout_ms` milliseconds.
///
/// Returns the URL string if one was received, or null.
/// Returns null on non-macOS platforms.
#[napi]
pub fn wait_for_url_event(timeout_ms: u32) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        macos::wait_for_url(timeout_ms)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = timeout_ms;
        None
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_long, c_void};
    use std::sync::Mutex;
    use std::sync::OnceLock;

    // CoreFoundation types
    type CFIndex = c_long;
    type CFStringRef = *const c_void;
    type CFTimeInterval = f64;

    // Apple Event types
    type AEEventClass = u32;
    type AEEventID = u32;
    type OSErr = i16;
    type AppleEventRef = *const c_void;
    type DescType = u32;

    const K_AE_GET_URL: AEEventClass = u32::from_be_bytes(*b"GURL");
    const K_INTERNET_EVENT_CLASS: AEEventID = u32::from_be_bytes(*b"GURL");
    const K_DIRECT_OBJECT: DescType = u32::from_be_bytes(*b"----");
    const TYPE_UTF8_TEXT: DescType = u32::from_be_bytes(*b"utf8");

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRunLoopRunInMode(mode: CFStringRef, seconds: CFTimeInterval, returnAfterSourceHandled: bool) -> i32;
    }

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn AEInstallEventHandler(
            theAEEventClass: AEEventClass,
            theAEEventID: AEEventID,
            handler: unsafe extern "C" fn(AppleEventRef, AppleEventRef, isize) -> OSErr,
            handlerRefcon: isize,
            isSysHandler: bool,
        ) -> OSErr;
        fn AEGetParamPtr(
            theAppleEvent: AppleEventRef,
            theAEKeyword: DescType,
            desiredType: DescType,
            actualType: *mut DescType,
            dataPtr: *mut u8,
            maximumSize: CFIndex,
            actualSize: *mut CFIndex,
        ) -> OSErr;
    }

    #[link(name = "AppKit", kind = "framework")]
    extern "C" {
        // NSApplication.sharedApplication
        fn NSApplicationLoad() -> bool;
    }

    // kCFRunLoopDefaultMode string constant
    extern "C" {
        static kCFRunLoopDefaultMode: CFStringRef;
    }

    static RECEIVED_URL: OnceLock<Mutex<Option<String>>> = OnceLock::new();

    fn url_storage() -> &'static Mutex<Option<String>> {
        RECEIVED_URL.get_or_init(|| Mutex::new(None))
    }

    unsafe extern "C" fn handle_get_url(event: AppleEventRef, _reply: AppleEventRef, _refcon: isize) -> OSErr {
        let mut buf = [0u8; 8192];
        let mut actual_size: CFIndex = 0;
        let mut actual_type: DescType = 0;

        let err = AEGetParamPtr(
            event,
            K_DIRECT_OBJECT,
            TYPE_UTF8_TEXT,
            &mut actual_type,
            buf.as_mut_ptr(),
            buf.len() as CFIndex,
            &mut actual_size,
        );

        if err == 0 && actual_size > 0 {
            let len = actual_size.min(buf.len() as CFIndex) as usize;
            if let Ok(url) = std::str::from_utf8(&buf[..len]) {
                if let Ok(mut guard) = url_storage().lock() {
                    *guard = Some(url.to_string());
                }
            }
        }

        0 // noErr
    }

    pub fn wait_for_url(timeout_ms: u32) -> Option<String> {
        unsafe {
            // Initialize NSApplication (required for Apple Event delivery)
            NSApplicationLoad();

            // Register handler for kAEGetURL
            let err = AEInstallEventHandler(
                K_INTERNET_EVENT_CLASS,
                K_AE_GET_URL,
                handle_get_url,
                0,
                false,
            );
            if err != 0 {
                return None;
            }

            // Pump run loop in 100ms intervals until timeout
            let timeout_secs = timeout_ms as f64 / 1000.0;
            let start = std::time::Instant::now();

            loop {
                // Check if URL received
                if let Ok(guard) = url_storage().lock() {
                    if guard.is_some() {
                        break;
                    }
                }

                // Check timeout
                if start.elapsed().as_secs_f64() >= timeout_secs {
                    break;
                }

                // Process events (100ms)
                CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, true);
            }

            // Return received URL
            if let Ok(mut guard) = url_storage().lock() {
                guard.take()
            } else {
                None
            }
        }
    }
}
