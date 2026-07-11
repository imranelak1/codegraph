// "@lib/thing" is also matched by the greedy "*" -> ./vendor/* pattern, whose
// target does NOT exist. Resolution must fall through to the more specific
// "@lib/*" -> ./src/lib/* pattern (which resolves), not report an unresolved miss.
import { z } from "@lib/thing";

export const w = z;
