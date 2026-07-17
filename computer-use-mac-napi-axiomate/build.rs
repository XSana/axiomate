extern crate napi_build;

fn main() {
    napi_build::setup();

    // Link AppKit (NSWorkspace, NSRunningApplication), ApplicationServices
    // (Accessibility trust APIs), CoreGraphics (CGEventTap, CGWindowList),
    // and ScreenCaptureKit (SCContentFilter, SCStream) on macOS.
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=ApplicationServices");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    }
}
