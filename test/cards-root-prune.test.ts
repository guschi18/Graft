/**
 * Root-level wiring cards (`graft/<stem>.md`) share the directory with concept
 * nodes, so the subdir prune in `writeCards` never reached them: a root source
 * that was deleted, or fell outside an `--only-dir` whitelist, left its card
 * behind for good — and `ask` kept surfacing it. These tests pin the prune, and
 * that it never touches a live card, a concept node, or a hand-dropped note.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "cards-root-prune-"));
  writeFileSync(join(dir, "main.ts"), "export function rootFn(a: number): number {\n  return a * 2;\n}\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "foo.ts"), "export function nestedFn(a: number): number {\n  return a + 1;\n}\n");
  return dir;
}

test("a live root card survives rebuilds unchanged", async () => {
  const dir = fixture();
  try {
    await buildGraph(dir);
    await buildGraph(dir);
    const card = join(dir, "graft", "main.md");
    assert.ok(existsSync(card), "root source keeps its top-level card");
    assert.match(readFileSync(card, "utf8"), /^# main\.ts/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the card of a deleted root source is pruned", async () => {
  const dir = fixture();
  try {
    await buildGraph(dir);
    assert.ok(existsSync(join(dir, "graft", "main.md")));
    rmSync(join(dir, "main.ts"));
    await buildGraph(dir);
    assert.ok(!existsSync(join(dir, "graft", "main.md")), "stale root card must be pruned");
    assert.ok(existsSync(join(dir, "graft", "src", "foo.md")), "nested card stays");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a root source outside an --only-dir whitelist loses its card", async () => {
  const dir = fixture();
  try {
    await buildGraph(dir);
    assert.ok(existsSync(join(dir, "graft", "main.md")));
    await buildGraph(dir, { onlyDirs: ["src"] });
    assert.ok(!existsSync(join(dir, "graft", "main.md")), "excluded root card must be pruned");
    assert.ok(existsSync(join(dir, "graft", "src", "foo.md")), "whitelisted card stays");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concept nodes and hand-dropped notes at the top level are never pruned", async () => {
  const dir = fixture();
  try {
    await buildGraph(dir);
    const concept = join(dir, "graft", "auth-service.md");
    const notes = join(dir, "graft", "notes.md");
    writeFileSync(concept, "---\nslug: auth-service\nname: Auth Service\ntype: concept\n---\n\n# Auth Service\n");
    writeFileSync(notes, "# stray notes\n");
    rmSync(join(dir, "main.ts"));
    await buildGraph(dir);
    assert.ok(existsSync(concept), "a concept node (slug) must survive");
    assert.ok(existsSync(notes), "a hand-dropped note must survive");
    assert.ok(existsSync(join(dir, "graft", "INDEX.md")), "INDEX.md must survive");
    assert.ok(!existsSync(join(dir, "graft", "main.md")), "only the stale wiring card goes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
