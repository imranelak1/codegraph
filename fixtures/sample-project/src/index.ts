import { createServer } from "./server";
import { registerRoutes } from "@app/routes";
import { loadConfig } from "@app/config";

export function main() {
  const cfg = loadConfig();
  const server = createServer(cfg);
  registerRoutes(server);
  return server;
}
