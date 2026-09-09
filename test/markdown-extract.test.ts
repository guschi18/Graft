import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { buildContext } from "../src/context/build.js";
import { checkGraph } from "../src/graph/check.js";
import { ask } from "../src/ask/ask.js";
import { readAskIndex } from "../src/ask/index-file.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { fakeProviders, tmpRepo } from "./helpers.js";

test("Markdown files become searchable nodes and local links become resolved edges", async () => {
  const dir = tmpRepo("markdown");
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "README.md"), [
    "# Product handbook",
    "",
    "Read the [guide](docs/guide.md#setup), [[docs/reference]], and [notes](<docs/team notes.markdown>).",
    "![not a document link](ghost.md)",
    "`[also ignored](ghost.md)`",
    "```md",
    "[fenced example](ghost.md)",
    "```",
    "[external](https://example.com/docs.md)",
    "padding ".repeat(2500),
    "endofdocumentneedle",
  ].join("\n"));
  writeFileSync(join(dir, "docs", "guide.md"), "# Guide\n\n[Home](../README.md)\n");
  writeFileSync(join(dir, "docs", "reference.md"), "# Reference\n");
  writeFileSync(join(dir, "docs", "team notes.markdown"), "# Team notes\n");

  const built = await buildGraph(dir);
  const graph = readGraph(wiringPath(join(dir, "graft")))!;
  const files = graph.nodes.filter((n) => n.kind === "file").map((n) => n.id).sort();
  assert.deepEqual(files, ["README.md", "docs/guide.md", "docs/reference.md", "docs/team notes.markdown"]);
  assert.deepEqual(built.languages, ["markdown"]);
  assert.ok(graph.nodes.every((n) => n.origin === "markdown"));
  assert.match(graph.nodes.find((n) => n.id === "README.md")?.signature ?? "", /^Product handbook Read the/);

  const edges = new Set(graph.edges.map((e) => `${e.source}->${e.target}:${e.relation}`));
  assert.ok(edges.has("README.md->docs/guide.md:imports"));
  assert.ok(edges.has("README.md->docs/reference.md:imports"));
  assert.ok(edges.has("README.md->docs/team notes.markdown:imports"));
  assert.ok(edges.has("docs/guide.md->README.md:imports"));
  assert.ok(![...edges].some((e) => e.includes("ghost.md") || e.includes("example.com")));

  const index = readAskIndex(join(dir, "graft"))!;
  assert.ok(index.docs.find((d) => d.id === "README.md")?.body.some(([word]) => word === "handbook"));
  assert.ok(index.docs.find((d) => d.id === "README.md")?.body.some(([word]) => word === "endofdocumentneedle"));
  assert.equal(ask(dir, "handbook").hits[0]?.pointer, "README.md");
  assert.equal(ask(dir, "endofdocumentneedle").hits[0]?.pointer, "README.md");
  assert.ok(existsSync(join(dir, "graft", "README.md")));
  assert.ok(existsSync(join(dir, "graft", "docs", "guide.md")));
  const readmeCard = readFileSync(join(dir, "graft", "README.md"), "utf8");
  assert.match(readmeCard, /Product handbook Read the guide/);
  assert.doesNotMatch(readmeCard, /No extracted symbols/);
  assert.equal((await checkGraph(dir)).ok, true);

  writeFileSync(join(dir, "docs", "guide.md"), "# Updated guide\n");
  assert.deepEqual((await checkGraph(dir)).changed, ["docs/guide.md"]);
});

test("the deep concept pass includes Markdown by default", async () => {
  const dir = tmpRepo("markdown-context");
  writeFileSync(join(dir, "README.md"), "# Product\n\n[[Documentation Architecture]]\n");

  const result = await buildContext(dir, { ...fakeProviders(), model: "fake" });

  assert.equal(result.files, 1);
  assert.equal(result.nodes, 1);
  assert.ok(existsSync(join(dir, "graft", "documentation-architecture.md")));
});
