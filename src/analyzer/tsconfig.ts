/**
 * Load `baseUrl` and `paths` from the nearest tsconfig, using the TypeScript
 * API (not hand-parsing JSON — tsconfig allows comments and `extends`).
 */

import ts from "typescript";
import { dirname, isAbsolute, resolve } from "node:path";

export interface LoadedTsConfig {
  /** Absolute baseUrl, or null when the project has neither baseUrl nor paths. */
  baseUrl: string | null;
  paths: Record<string, string[]>;
  configPath: string | null;
}

export function loadTsConfig(root: string): LoadedTsConfig {
  const configPath =
    ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json") ??
    ts.findConfigFile(root, ts.sys.fileExists, "jsconfig.json") ??
    null;

  if (!configPath) return { baseUrl: null, paths: {}, configPath: null };

  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, dirname(configPath));
  const opts = parsed.options;
  const configDir = dirname(configPath);

  const paths = (opts.paths as Record<string, string[]> | undefined) ?? {};
  let baseUrl: string | null = null;
  if (opts.baseUrl) {
    baseUrl = isAbsolute(opts.baseUrl) ? opts.baseUrl : resolve(configDir, opts.baseUrl);
  } else if (Object.keys(paths).length > 0) {
    // TS 4.1+ allows `paths` without baseUrl; targets are relative to the config dir.
    baseUrl = configDir;
  }

  return { baseUrl, paths, configPath };
}
