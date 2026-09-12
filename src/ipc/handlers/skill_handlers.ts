import { skillContracts } from "@/ipc/types/skills";
import { createLoggedTypedHandler } from "./base";
import log from "electron-log";
import {
  createSkill,
  deleteSkillFile,
  getSkillFileContent,
  getSkillFiles,
  installSkillsFromGithub,
  listSkills,
  removeSkill,
  resyncLiveSandboxes,
  saveSkillFile,
  setSkillEnabled,
} from "../utils/skills_store";
import { SKILLS_LIBRARY } from "@/shared/skills_library";

const logger = log.scope("skill_handlers");

export function registerSkillHandlers() {
  const handleTyped = createLoggedTypedHandler(logger);

  handleTyped(skillContracts.list, async () => {
    return listSkills();
  });

  handleTyped(skillContracts.getFiles, async (_, { slug }) => {
    return getSkillFiles(slug);
  });

  handleTyped(skillContracts.create, async (_, params) => {
    const meta = createSkill(params);
    void resyncLiveSandboxes();
    return meta;
  });

  handleTyped(skillContracts.saveFile, async (_, { slug, relPath, content }) => {
    saveSkillFile(slug, relPath, content);
    void resyncLiveSandboxes();
  });

  handleTyped(skillContracts.readFile, async (_, { slug, relPath }) => {
    return getSkillFileContent(slug, relPath);
  });

  handleTyped(skillContracts.deleteFile, async (_, { slug, relPath }) => {
    deleteSkillFile(slug, relPath);
    void resyncLiveSandboxes();
  });

  handleTyped(skillContracts.remove, async (_, { slug }) => {
    removeSkill(slug);
    void resyncLiveSandboxes();
  });

  handleTyped(skillContracts.setEnabled, async (_, { slug, enabled }) => {
    setSkillEnabled(slug, enabled);
    void resyncLiveSandboxes();
  });

  handleTyped(skillContracts.installFromGithub, async (_, { url }) => {
    const result = await installSkillsFromGithub({ url });
    void resyncLiveSandboxes();
    return result;
  });

  handleTyped(skillContracts.library, async () => {
    return SKILLS_LIBRARY;
  });

  logger.debug("Skill handlers registered");
}
