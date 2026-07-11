/**
 * @codegraph/analyzer — the Node surface.
 *
 * A pure library: it reads the filesystem and shells out to git, but has no DOM
 * and makes no network calls. The web app, the CLI, and the GitHub Action all
 * drive the same `analyze()` and render the same document.
 */

export { analyze, type AnalyzeOptions } from "./analyze";
export { parseFile, type ParsedFile, type RawImport } from "./parser";
export { resolveImport, tryResolveFile, resolveViaPaths, isBuiltin } from "./resolver";
export type { ResolveResult, ResolverPaths } from "./resolver";
export { loadTsConfig, type LoadedTsConfig } from "./tsconfig";
export { parseLcov, applyCoverage, loadLcov, type FileCoverage } from "./coverage";
export { collectGit, gitAvailable } from "./git";
export { walkSourceFiles, relId, toPosix } from "./fs-util";

// Re-export the core so a single import gives a consumer types + algorithms.
export * from "../core/index";
