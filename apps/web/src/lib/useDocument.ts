import { useEffect, useState } from "react";
import type { CodeGraphDocument } from "@core";

export type LoadState =
  | { status: "loading" }
  | { status: "ready"; doc: CodeGraphDocument; source: string }
  | { status: "error"; message: string };

const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ["/codegraph.json", "live document"],
  ["/codegraph.sample.json", "sample project"],
];

/** Load the one JSON document: a freshly-generated one if present, else the committed sample. */
export function useDocument(): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const [url, source] of SOURCES) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const doc = (await res.json()) as CodeGraphDocument;
          if (!cancelled) setState({ status: "ready", doc, source });
          return;
        } catch {
          // try the next source
        }
      }
      if (!cancelled) {
        setState({
          status: "error",
          message: "No document found. Generate one with:  npm run analyze:sample",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
