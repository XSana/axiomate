use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct ClipboardImageResult {
    pub png: Buffer,
    pub original_width: u32,
    pub original_height: u32,
    pub width: u32,
    pub height: u32,
}

/// Check if the system clipboard contains an image.
/// Returns false on non-macOS platforms.
#[napi]
pub fn has_clipboard_image() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::has_image()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Read an image from the system clipboard, optionally scaling it down
/// to fit within maxWidth × maxHeight. Returns null if no image is present
/// or on non-macOS platforms.
#[napi]
pub fn read_clipboard_image(max_width: u32, max_height: u32) -> Option<ClipboardImageResult> {
    #[cfg(target_os = "macos")]
    {
        macos::read_image(max_width, max_height)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (max_width, max_height);
        None
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::ClipboardImageResult;
    use image::codecs::png::PngEncoder;
    use image::{DynamicImage, ImageEncoder};
    use napi::bindgen_prelude::Buffer;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::NSString;
    use std::sync::OnceLock;

    // Cache NSPasteboardType strings (created once, never freed)
    static TYPE_PNG: OnceLock<objc2::rc::Retained<NSString>> = OnceLock::new();
    static TYPE_TIFF: OnceLock<objc2::rc::Retained<NSString>> = OnceLock::new();

    fn pasteboard_type_png() -> &'static NSString {
        TYPE_PNG.get_or_init(|| NSString::from_str("public.png"))
    }

    fn pasteboard_type_tiff() -> &'static NSString {
        TYPE_TIFF.get_or_init(|| NSString::from_str("public.tiff"))
    }

    pub fn has_image() -> bool {
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            let types = pb.types();
            if let Some(types) = types {
                let png = pasteboard_type_png();
                let tiff = pasteboard_type_tiff();
                types.containsObject(png) || types.containsObject(tiff)
            } else {
                false
            }
        }
    }

    pub fn read_image(max_width: u32, max_height: u32) -> Option<ClipboardImageResult> {
        unsafe {
            let pb = NSPasteboard::generalPasteboard();

            // Try PNG first, then TIFF
            let data = pb
                .dataForType(pasteboard_type_png())
                .or_else(|| pb.dataForType(pasteboard_type_tiff()))?;

            // NSData.bytes() returns &[u8]
            let slice = data.bytes();

            // Decode image
            let img = image::load_from_memory(slice).ok()?;
            let original_width = img.width();
            let original_height = img.height();

            // Scale down if needed
            let img = maybe_resize(img, max_width, max_height);
            let width = img.width();
            let height = img.height();

            // Encode as PNG
            let mut png_buf = Vec::new();
            let encoder = PngEncoder::new(&mut png_buf);
            let rgba = img.to_rgba8();
            encoder
                .write_image(rgba.as_raw(), width, height, image::ExtendedColorType::Rgba8)
                .ok()?;

            Some(ClipboardImageResult {
                png: Buffer::from(png_buf),
                original_width,
                original_height,
                width,
                height,
            })
        }
    }

    fn maybe_resize(img: DynamicImage, max_width: u32, max_height: u32) -> DynamicImage {
        let w = img.width();
        let h = img.height();

        if w <= max_width && h <= max_height {
            return img;
        }

        let scale_w = max_width as f64 / w as f64;
        let scale_h = max_height as f64 / h as f64;
        let scale = scale_w.min(scale_h);

        let new_w = (w as f64 * scale).round() as u32;
        let new_h = (h as f64 * scale).round() as u32;

        img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3)
    }
}
