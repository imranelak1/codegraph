import { Pool } from "pg";
import { makePool } from "./pool";

let pool: ReturnType<typeof makePool> | null = null;

export function connect(url: string): void {
  pool = makePool(url);
}

export async function query<T>(sql: string): Promise<T[]> {
  if (!pool) throw new Error("db not connected");
  return pool.run<T>(sql);
}

export type { Pool };
