/** Markdown documents become file nodes; local document links become graph edges. */
import { basename, posix } from "node:path";
import { contentHash } from "../util/id.js";
import type { ExtractResult, RawEdge } from "./extract.js";
import type { NodeV1 } from "./types.js";

const EXTENSIONS = [".md", ".markdown"];
const MAX_PREVIEW_CHARS = 500;

export function markdownExtensions(): string[] {
  return [...EXTENSIONS];
}

export function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase();
  return EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Keep only local links and normalize them for the existing import resolver. */
function localTarget(raw: string, wiki = false): string | null {
  let target = raw.trim().replace(/^<|>$/g, "");
  if (!target || target.startsWith("#") || target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  target = target.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  try { target = decodeURIComponent(target); } catch { /* keep the literal path */ }
  if (!target) return null;
  if (wiki && !posix.extname(target)) target += ".md";
  return target.startsWith(".") || target.startsWith("/") ? target : `./${target}`;
}

function links(source: string): string[] {
  const found = new Set<string>();
  let fence: "`" | "~" | null = null;
  for (const line of source.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1][0] as "`" | "~" | undefined;
    if (marker) {
      if (fence === marker) fence = null;
      else if (fence === null) fence = marker;
      continue;
    }
    if (fence) continue;

    // ponytail: inline links + path-shaped wikilinks cover the common graph case;
    // use a CommonMark parser if reference definitions or nested destinations matter.
    const prose = line.replace(/`[^`]*`/g, "");
    for (const match of prose.matchAll(/(?<!!)\[[^\]]+\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)) {
      const target = localTarget(match[1] ?? match[2]);
      if (target) found.add(target);
    }
    for (const match of prose.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const target = localTarget(match[1], true);
      if (target) found.add(target);
    }
  }
  return [...found];
}

/** Small deterministic excerpt for cards and the viewer; the full text stays in the ask index. */
function preview(source: string): string | null {
  const text = source
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[*`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > MAX_PREVIEW_CHARS
    ? `${text.slice(0, MAX_PREVIEW_CHARS - 1).trimEnd()}…`
    : text;
}

export function extractMarkdown(rel: string, source: string): ExtractResult {
  const bodyText = source.replace(/\s+/g, " ").trim();
  const node: NodeV1 = {
    id: rel,
    name: basename(rel),
    kind: "file",
    path: rel,
    span: `L1-L${source.split(/\r?\n/).length}`,
    signature: preview(source),
    exported: true,
    origin: "markdown",
    body_hash: contentHash(source),
    chars: source.length,
    body_text: bodyText,
    summary_state: "pending",
    summary: null,
    crux: null,
  };
  const rawEdges: RawEdge[] = links(source).map((specifier) => ({
    source: rel,
    relation: "imports",
    specifier,
    file: rel,
  }));
  return { nodes: [node], rawEdges };
}
