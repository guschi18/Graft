import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { markdownCatalogs, personalizedPageRank, preparePageRankTopology } from "../src/ask/graphrank.js";
import { tmpRepo } from "./helpers.js";

function write(dir: string, rel: string, body: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

test("a Markdown catalog that links most of the vault sits out the PageRank walk", async () => {
  const dir = tmpRepo("markdown-catalog");
  const pages = Array.from({ length: 60 }, (_, i) => `Page ${i}`);
  pages.forEach((p, i) => write(dir, `wiki/entities/${p}.md`, `# ${p}\n\ntopic${i} [[${pages[(i + 1) % pages.length]}]]\n`));
  write(dir, "wiki/index.md", `# Index\n\n${pages.map((p) => `- [[${p}]] - summary`).join("\n")}\n`);
  write(dir, "wiki/log.md", `# Log\n\n${pages.slice(0, 10).map((p) => `- ingest [[${p}]]`).join("\n")}\n`);

  await buildGraph(dir);
  const graph = readGraph(wiringPath(join(dir, "graft")))!;

  // The catalog keeps its edges in the graph — `graft callers` still sees them.
  assert.equal(graph.edges.filter((e) => e.source === "wiki/index.md").length, 60);
  assert.deepEqual([...markdownCatalogs(graph)], ["wiki/index.md"]);

  const topology = preparePageRankTopology(graph);
  assert.equal(topology.adjacency.has("wiki/index.md"), false);
  assert.ok(topology.adjacency.has("wiki/log.md"), "a page linking a minority of the vault keeps walking");

  const rank = personalizedPageRank(graph, new Map([["wiki/entities/Page 1.md", 1]]));
  assert.equal(rank.get("wiki/index.md"), undefined);
  assert.ok((rank.get("wiki/entities/Page 2.md") ?? 0) > 0, "real neighbours still receive mass");
});
