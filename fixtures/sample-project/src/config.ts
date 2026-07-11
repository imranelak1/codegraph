import { readEnv } from "./env";

export interface Config {
  dbUrl: string;
  port: number;
}

export function loadConfig(): Config {
  return {
    dbUrl: readEnv("DB_URL", "pg://localhost/app"),
    port: Number(readEnv("PORT", "3000")),
  };
}
