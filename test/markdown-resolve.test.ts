import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { tmpRepo } from "./helpers.js";

function write(dir: string, rel: string, body: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

test("wikilinks resolve vault-wide by file name, like Obsidian", async () => {
  const dir = tmpRepo("markdown-wikilinks");
  write(dir, "wiki/sources/a.md", [
    "# Source",
    "[[Entity]] and [[other page|an alias]] and [[Concept#Heading]].",
    "[[Dup]] picks the shortest path; [[deep/Dup]] follows the path tail.",
    "[[CLAUDE.md]] names the page whose filename equals the link text.",
    "[[Missing Page]] stays unresolved.",
  ].join("\n"));
  write(dir, "wiki/sources/b.md", "# Plain link\n\n[not a wikilink](Entity.md)\n");
  write(dir, "wiki/sources/c.md", "# Near\n\n[[Near]]\n");
  write(dir, "wiki/sources/Near.md", "# Near, same folder\n");
  write(dir, "wiki/entities/Near.md", "# Near, other folder\n");
  write(dir, "wiki/entities/Entity.md", "# Entity\n");
  write(dir, "wiki/concepts/Other Page.md", "# Other page\n");
  write(dir, "wiki/concepts/Concept.md", "# Concept\n");
  write(dir, "wiki/entities/Dup.md", "# Dup\n");
  write(dir, "archive/old/deep/Dup.md", "# Old dup\n");
  write(dir, "wiki/concepts/CLAUDE.md.md", "# CLAUDE.md, the concept\n");
  write(dir, "CLAUDE.md", "# Project instructions\n");

  await buildGraph(dir);
  const graph = readGraph(wiringPath(join(dir, "graft")))!;
  const ids = new Set(graph.nodes.map((n) => n.id));
  const from = (src: string) =>
    new Set(graph.edges.filter((e) => e.source === src && ids.has(e.target)).map((e) => e.target));

  assert.deepEqual(
    [...from("wiki/sources/a.md")].sort(),
    [
      "archive/old/deep/Dup.md",
      "wiki/concepts/CLAUDE.md.md",
      "wiki/concepts/Concept.md",
      "wiki/concepts/Other Page.md",
      "wiki/entities/Dup.md",
      "wiki/entities/Entity.md",
    ],
  );
  // A plain Markdown link keeps its relative meaning: no vault-wide fallback.
  assert.equal(from("wiki/sources/b.md").size, 0);
  // The relative hit in the linking file's own folder wins over a name match elsewhere.
  assert.deepEqual([...from("wiki/sources/c.md")], ["wiki/sources/Near.md"]);
});

test("a wikilink with several name matches prefers the linking file's own folder", async () => {
  const dir = tmpRepo("markdown-wikilinks-tie");
  // `[[topic]]` misses the case-sensitive relative lookup; the name fallback is
  // case-insensitive and ranks the own folder above the shorter root path.
  write(dir, "notes/daily/today.md", "# Today\n\n[[topic]]\n");
  write(dir, "notes/daily/TOPIC.md", "# Topic next to today\n");
  write(dir, "Topic.md", "# Topic at the root\n");
  write(dir, "notes/Topic.md", "# Topic in notes\n");

  await buildGraph(dir);
  const graph = readGraph(wiringPath(join(dir, "graft")))!;
  const targets = graph.edges.filter((e) => e.source === "notes/daily/today.md").map((e) => e.target);
  assert.deepEqual(targets, ["notes/daily/TOPIC.md"]);
});
