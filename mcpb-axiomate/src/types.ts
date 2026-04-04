import * as z from "zod";
import {
  McpbManifestSchema,
  McpbSignatureInfoSchema,
  McpbUserConfigurationOptionSchema,
  McpbUserConfigValuesSchema,
  McpServerConfigSchema,
  McpbManifestMcpConfigSchema,
} from "./schemas.js";

export type McpbManifest = z.infer<typeof McpbManifestSchema>;
export type McpbSignatureInfo = z.infer<typeof McpbSignatureInfoSchema>;
export type McpbUserConfigurationOption = z.infer<typeof McpbUserConfigurationOptionSchema>;
export type McpbUserConfigValues = z.infer<typeof McpbUserConfigValuesSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpbManifestMcpConfig = z.infer<typeof McpbManifestMcpConfigSchema>;
