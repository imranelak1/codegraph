/**
 * @codegraph/core — the browser-safe surface.
 *
 * Types (the document contract) plus pure algorithms. The web app imports from
 * here; it never imports the Node analyzer. This is the "same document, every
 * consumer" boundary made concrete.
 */

export * from "./types";
export * from "./graph";
export * from "./health";
