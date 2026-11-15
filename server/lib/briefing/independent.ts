import type { Source } from "../../../shared/briefing/schema";
import { rootDomain } from "./sources";

/**
 * A conservative count of distinct coverage. Distinct domains alone cannot prove
 * independence; obvious copied titles or snippets must not count twice.
 */
export function coverageCount(sources: Source[]): number {
  const parents = sources.map((_, i) => i);
  const find = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]!]!;
      i = parents[i]!;
    }
    return i;
  };
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  for (let i = 0; i < sources.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = sources[i]!;
      const b = sources[j]!;
      const title = normalize(a.title);
      const snippet = normalize(a.snippet);
      const sameTitle = title.split(" ").length >= 5 && title === normalize(b.title);
      const sameSnippet = snippet.length >= 100 && snippet === normalize(b.snippet);
      if (rootDomain(a.domain) === rootDomain(b.domain) || sameTitle || sameSnippet) {
        parents[find(i)] = find(j);
      }
    }
  }
  return new Set(sources.map((_, i) => find(i))).size;
}
