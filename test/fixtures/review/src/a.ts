// Imports the same module twice — a value import and a type-only import.
// The graph must record ONE edge a -> b, not two (fan counts stay honest).
import { x } from "./b";
import type { T } from "./b";

export const y: T = x;
