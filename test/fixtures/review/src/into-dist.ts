// Resolves to a real file inside an ignored build directory (dist/). It exists
// on disk but is NOT part of the analyzed graph, so it must be recorded as
// unresolved (reason: excluded) rather than silently lifting the resolution rate.
import bundle from "../dist/bundle.js";

export const b = bundle;
