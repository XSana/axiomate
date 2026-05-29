import {
  IMAGE_MAX_HEIGHT,
  IMAGE_MAX_WIDTH,
  IMAGE_TARGET_RAW_SIZE,
} from '../../constants/apiLimits.js'

export type ImageRecoveryProfile =
  | 'fit_provider_image_limit'
  | 'fit_many_image_dimension_limit'
  | 'aggressive_size_compression'
  | 'drop_or_textualize_tool_result_images'

export type ImageRecoveryRewritePolicy = {
  profile: ImageRecoveryProfile
  maxWidth: number
  maxHeight: number
  targetRawSize: number
  fallbackMaxEdge: number
  jpegQualitySteps: readonly number[]
  forceJpeg: boolean
  textualizeToolResultImages: boolean
}

export const DEFAULT_IMAGE_RECOVERY_MAX_EDGE = Math.min(
  IMAGE_MAX_WIDTH,
  IMAGE_MAX_HEIGHT,
)

export const DEFAULT_IMAGE_RECOVERY_PROFILE: ImageRecoveryProfile =
  'fit_provider_image_limit'

const mib = (value: number) => value * 1024 * 1024

export const IMAGE_RECOVERY_REWRITE_POLICIES: Record<
  ImageRecoveryProfile,
  ImageRecoveryRewritePolicy
> = {
  fit_provider_image_limit: {
    profile: 'fit_provider_image_limit',
    maxWidth: Math.min(1568, IMAGE_MAX_WIDTH),
    maxHeight: Math.min(1568, IMAGE_MAX_HEIGHT),
    targetRawSize: Math.min(IMAGE_TARGET_RAW_SIZE, mib(3)),
    fallbackMaxEdge: 1000,
    jpegQualitySteps: [80, 60, 40],
    forceJpeg: false,
    textualizeToolResultImages: false,
  },
  fit_many_image_dimension_limit: {
    profile: 'fit_many_image_dimension_limit',
    maxWidth: Math.min(1024, IMAGE_MAX_WIDTH),
    maxHeight: Math.min(1024, IMAGE_MAX_HEIGHT),
    targetRawSize: Math.min(IMAGE_TARGET_RAW_SIZE, mib(2.5)),
    fallbackMaxEdge: 768,
    jpegQualitySteps: [75, 55, 35],
    forceJpeg: false,
    textualizeToolResultImages: false,
  },
  aggressive_size_compression: {
    profile: 'aggressive_size_compression',
    maxWidth: Math.min(768, IMAGE_MAX_WIDTH),
    maxHeight: Math.min(768, IMAGE_MAX_HEIGHT),
    targetRawSize: Math.min(IMAGE_TARGET_RAW_SIZE, mib(1.25)),
    fallbackMaxEdge: 512,
    jpegQualitySteps: [60, 40, 25],
    forceJpeg: true,
    textualizeToolResultImages: false,
  },
  drop_or_textualize_tool_result_images: {
    profile: 'drop_or_textualize_tool_result_images',
    maxWidth: Math.min(1024, IMAGE_MAX_WIDTH),
    maxHeight: Math.min(1024, IMAGE_MAX_HEIGHT),
    targetRawSize: Math.min(IMAGE_TARGET_RAW_SIZE, mib(2.5)),
    fallbackMaxEdge: 768,
    jpegQualitySteps: [75, 55, 35],
    forceJpeg: false,
    textualizeToolResultImages: true,
  },
}

export function resolveImageRecoveryProfile(
  profile: ImageRecoveryProfile | undefined,
): ImageRecoveryProfile {
  return profile ?? DEFAULT_IMAGE_RECOVERY_PROFILE
}

export function getImageRecoveryRewritePolicy(
  profile: ImageRecoveryProfile | undefined,
): ImageRecoveryRewritePolicy {
  return IMAGE_RECOVERY_REWRITE_POLICIES[
    resolveImageRecoveryProfile(profile)
  ]
}
