import { query } from "../db";
import type { Post } from "../models/post";

/**
 * The handler name is only known at runtime, so codeGraph cannot follow this
 * import. It is recorded as unresolved (reason: dynamic-expression) rather than
 * guessed at — the graph stays honest.
 */
export async function loadHandler(name: string) {
  const mod = await import(`./handlers/${name}`);
  return mod.default;
}

export async function listPosts(): Promise<Post[]> {
  return query<Post>("select id, title from posts");
}
