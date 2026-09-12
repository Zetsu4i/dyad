import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

// =============================================================================
// Skill Schemas
// =============================================================================

export const SkillMetaSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  source: z.enum(["local", "github"]),
  sourceUrl: z.string().optional(),
  installedAt: z.string(),
  fileCount: z.number(),
});

export type SkillMetaDto = z.infer<typeof SkillMetaSchema>;

export const SkillFileSchema = z.object({
  relPath: z.string(),
  content: z.string(),
});

export type SkillFileDto = z.infer<typeof SkillFileSchema>;

const CreateSkillParamsSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  skillMd: z.string().optional(),
});

const InstallFromGithubParamsSchema = z.object({
  url: z.string().min(1),
});

const FilePathParamsSchema = z.object({
  slug: z.string(),
  relPath: z.string(),
});

const SaveFileParamsSchema = FilePathParamsSchema.extend({
  content: z.string(),
});

const SetEnabledParamsSchema = z.object({
  slug: z.string(),
  enabled: z.boolean(),
});

export const SkillLibraryEntrySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  repoUrl: z.string(),
  subdirectory: z.string().optional(),
  category: z.string(),
});

export type SkillLibraryEntryDto = z.infer<typeof SkillLibraryEntrySchema>;

const InstallResultSchema = z.object({
  installed: z.array(z.string()),
  skipped: z.array(z.string()),
});

// =============================================================================
// Skill Contracts
// =============================================================================

export const skillContracts = {
  list: defineContract({
    channel: "skills:list",
    input: z.void(),
    output: z.array(SkillMetaSchema),
  }),

  getFiles: defineContract({
    channel: "skills:get-files",
    input: z.object({ slug: z.string() }),
    output: z.array(SkillFileSchema),
  }),

  create: defineContract({
    channel: "skills:create",
    input: CreateSkillParamsSchema,
    output: SkillMetaSchema,
  }),

  saveFile: defineContract({
    channel: "skills:save-file",
    input: SaveFileParamsSchema,
    output: z.void(),
  }),

  readFile: defineContract({
    channel: "skills:read-file",
    input: FilePathParamsSchema,
    output: z.string().nullable(),
  }),

  deleteFile: defineContract({
    channel: "skills:delete-file",
    input: FilePathParamsSchema,
    output: z.void(),
  }),

  remove: defineContract({
    channel: "skills:remove",
    input: z.object({ slug: z.string() }),
    output: z.void(),
  }),

  setEnabled: defineContract({
    channel: "skills:set-enabled",
    input: SetEnabledParamsSchema,
    output: z.void(),
  }),

  installFromGithub: defineContract({
    channel: "skills:install-from-github",
    input: InstallFromGithubParamsSchema,
    output: InstallResultSchema,
  }),

  library: defineContract({
    channel: "skills:library",
    input: z.void(),
    output: z.array(SkillLibraryEntrySchema),
  }),
} as const;

// =============================================================================
// Skill Client
// =============================================================================

export const skillClient = createClient(skillContracts);
