// Three imports codeGraph cannot follow. Each is recorded in `unresolved[]`
// with a machine-readable reason — none are silently dropped.

// reason: module-not-found
import { thing } from "./does-not-exist";

// reason: unmatched-tsconfig-path  (@app/* -> src/*, but src/security/secret is missing)
import { secret } from "@app/security/secret";

// reason: extension-miss  (a directory with no index file)
import * as models from "./models";

export const boom = () => thing ?? secret ?? models;
