import { loadConfig } from "@app/config";

const level = loadConfig().port > 0 ? "info" : "silent";

export const logger = {
  info(message: string): void {
    if (level === "info") console.log(`[info] ${message}`);
  },
};
