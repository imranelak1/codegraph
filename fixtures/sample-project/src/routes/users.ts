import { query } from "../db";
import type { User } from "../models/user";
import { logger } from "@app/util/logger";

export async function listUsers(): Promise<User[]> {
  logger.info("listing users");
  return query<User>("select id, name from users");
}

export function registerRoutes(server: unknown): void {
  logger.info(`routes registered on ${String(server)}`);
}
