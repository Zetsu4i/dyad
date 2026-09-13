import { z } from "zod";
import { createClient, defineContract } from "../contracts/core";

// =============================================================================
// E2B Schemas
// =============================================================================

export const ValidateE2bApiKeyParamsSchema = z.object({
  apiKey: z.string().min(1),
});

export const ValidateE2bApiKeyResultSchema = z.object({
  valid: z.boolean(),
  error: z.string().nullable().optional(),
  sandboxCount: z.number().int().nonnegative().optional(),
});

export const RunE2bCommandParamsSchema = z.object({
  appId: z.number(),
  command: z.string().min(1).max(100_000),
  timeoutMs: z.number().int().min(1000).max(600_000).optional(),
});

export const RunE2bCommandResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
});

export const GetE2bSandboxStateParamsSchema = z.object({
  appId: z.number(),
});

export const GetE2bSandboxStateResultSchema = z.object({
  attached: z.boolean(),
  runtimeMode: z.enum(["host", "docker", "cloud", "e2b"]),
  sandboxId: z.string().nullable().optional(),
  state: z.enum(["starting", "running", "restoring", "saving", "stopping", "stopped", "paused", "failed"]).nullable().optional(),
  previewUrl: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
});

export type ValidateE2bApiKeyParams = z.infer<
  typeof ValidateE2bApiKeyParamsSchema
>;
export type ValidateE2bApiKeyResult = z.infer<
  typeof ValidateE2bApiKeyResultSchema
>;
export type RunE2bCommandParams = z.infer<typeof RunE2bCommandParamsSchema>;
export type RunE2bCommandResult = z.infer<typeof RunE2bCommandResultSchema>;
export type GetE2bSandboxStateResult = z.infer<
  typeof GetE2bSandboxStateResultSchema
>;

export const e2bContracts = {
  validateApiKey: defineContract({
    channel: "e2b:validate-api-key",
    input: ValidateE2bApiKeyParamsSchema,
    output: ValidateE2bApiKeyResultSchema,
  }),
  runCommand: defineContract({
    channel: "e2b:run-command",
    input: RunE2bCommandParamsSchema,
    output: RunE2bCommandResultSchema,
  }),
  getSandboxState: defineContract({
    channel: "e2b:get-sandbox-state",
    input: GetE2bSandboxStateParamsSchema,
    output: GetE2bSandboxStateResultSchema,
  }),
} as const;

export const e2bClient = createClient(e2bContracts);
