/**
 * Curated library of popular, installable agent skills.
 *
 * Every entry points at a real GitHub location containing a SKILL.md, so
 * "Install" performs a real clone + copy into the user's skills directory.
 * Sources verified against github.com/anthropics/skills (skills/ directory).
 */
import type { SkillLibraryEntry } from "@/ipc/utils/skills_store";

export const SKILLS_LIBRARY: SkillLibraryEntry[] = [
  {
    slug: "pdf",
    title: "PDF Processing",
    description:
      "Comprehensive PDF manipulation: extract text and tables, create new PDFs, merge/split documents, and fill forms.",
    repoUrl: "https://github.com/anthropics/skills/tree/main/skills/pdf",
    subdirectory: "skills/pdf",
    category: "Documents",
  },
  {
    slug: "docx",
    title: "DOCX Documents",
    description:
      "Create, edit, and analyze Word documents with tracked changes, comments, formatting, and document pipelines.",
    repoUrl: "https://github.com/anthropics/skills/tree/main/skills/docx",
    subdirectory: "skills/docx",
    category: "Documents",
  },
  {
    slug: "xlsx",
    title: "Excel Spreadsheets",
    description:
      "Build, read, and modify Excel workbooks with formulas, charts, pivot tables, and multi-sheet models.",
    repoUrl: "https://github.com/anthropics/skills/tree/main/skills/xlsx",
    subdirectory: "skills/xlsx",
    category: "Documents",
  },
  {
    slug: "pptx",
    title: "PowerPoint Decks",
    description:
      "Generate professional presentations: layouts, placeholders, themes, charts, and speaker notes.",
    repoUrl: "https://github.com/anthropics/skills/tree/main/skills/pptx",
    subdirectory: "skills/pptx",
    category: "Documents",
  },
  {
    slug: "web-artifacts-builder",
    title: "Web Artifacts Builder",
    description:
      "Build complex HTML artifacts with React, Tailwind, and bundled dependencies for rich single-page outputs.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder",
    subdirectory: "skills/web-artifacts-builder",
    category: "Frontend",
  },
  {
    slug: "frontend-design",
    title: "Frontend Design",
    description:
      "Distinctive, production-grade frontend design guidance: typography, color systems, motion, and component polish.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
    subdirectory: "skills/frontend-design",
    category: "Frontend",
  },
  {
    slug: "webapp-testing",
    title: "Web App Testing",
    description:
      "Drive a headless browser with Playwright to test web apps: click through flows, fill forms, and screenshot results.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/webapp-testing",
    subdirectory: "skills/webapp-testing",
    category: "Testing",
  },
  {
    slug: "mcp-builder",
    title: "MCP Server Builder",
    description:
      "Step-by-step guidance for building high-quality Model Context Protocol (MCP) servers users can connect to.",
    repoUrl: "https://github.com/anthropics/skills/tree/main/skills/mcp-builder",
    subdirectory: "skills/mcp-builder",
    category: "Integrations",
  },
  {
    slug: "canvas-design",
    title: "Canvas Design",
    description:
      "Design polished visual art and layouts (posters, cards, hero sections) using design principles and canvas tooling.",
    repoUrl: "https://github.com/anthropics/skills/tree/main/skills/canvas-design",
    subdirectory: "skills/canvas-design",
    category: "Design",
  },
  {
    slug: "brand-guidelines",
    title: "Brand Guidelines",
    description:
      "Apply consistent colors, typography, spacing, and voice — a template for building your own brand skill.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/brand-guidelines",
    subdirectory: "skills/brand-guidelines",
    category: "Design",
  },
  {
    slug: "theme-factory",
    title: "Theme Factory",
    description:
      "Generate styled themes and apply them to artifacts across any platform with a consistent visual language.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/theme-factory",
    subdirectory: "skills/theme-factory",
    category: "Design",
  },
  {
    slug: "internal-comms",
    title: "Internal Comms",
    description:
      "Write internal company communications: status updates, newsletters, announcements, and FAQs with a natural voice.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/internal-comms",
    subdirectory: "skills/internal-comms",
    category: "Writing",
  },
  {
    slug: "doc-coauthoring",
    title: "Doc Co-Authoring",
    description:
      "Co-author documents interactively: capture intent, propose structure, and iterate section by section with the user.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring",
    subdirectory: "skills/doc-coauthoring",
    category: "Writing",
  },
  {
    slug: "slack-gif-creator",
    title: "Slack GIF Creator",
    description:
      "Create animated GIFs optimized for Slack: memes, emoji avatars, and reactions via ffmpeg + Python composition.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/slack-gif-creator",
    subdirectory: "skills/slack-gif-creator",
    category: "Media",
  },
  {
    slug: "algorithmic-art",
    title: "Algorithmic Art",
    description:
      "Create generative art using p5.js with seeded randomness, flow fields, particles, and creative coding patterns.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/algorithmic-art",
    subdirectory: "skills/algorithmic-art",
    category: "Media",
  },
  {
    slug: "skill-creator",
    title: "Skill Creator",
    description:
      "Meta-skill that guides the agent through creating new, high-quality skills with good descriptions and packaging.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
    subdirectory: "skills/skill-creator",
    category: "Meta",
  },
  {
    slug: "claude-api",
    title: "Claude API",
    description:
      "Best practices for building with the Claude API: tool use, batching, multimodal inputs, and streaming.",
    repoUrl:
      "https://github.com/anthropics/skills/tree/main/skills/claude-api",
    subdirectory: "skills/claude-api",
    category: "Integrations",
  },
];
