import type { ChatMode } from "./schemas";

export function getChatModeDisplayName(mode: ChatMode, isPro: boolean): string {
  void isPro; // Pro features are unlocked in this fork — the full Agent is available to everyone.
  switch (mode) {
    case "build":
      return "Build";
    case "ask":
      return "Ask";
    case "local-agent":
      return "Agent";
    case "plan":
      return "Plan";
  }
}
