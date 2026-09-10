/**
 * `graft build --only-dir <path>` end-to-end through the real CLI.
 *
 * The whitelist is the inverse of SKIP_DIRS: when set, ONLY files under the
 * listed repo-relative prefixes are indexed, and everything else (including
 * top-level files) is skipped. It is persisted in the source repo's local,
 * Git-ignored `.graft/config.json` (like `--include-dir`), so a later no-flag
 * build and the hooks/refresh path keep the same limited set, and recorded in the
 * fingerprint so the query-path freshness probe enumerates the identical set —
 * the excluded files must not read as phantom "added" drift on every query.
 *
 * It is strictly opt-in: a repo that never passes `--only-dir` gets no config
 * file and is indexed whole, exactly as before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { fingerprintPath, probeDrift, isClean, readFingerprint } from "../src/graph/fingerprint.js";
import { ensureFreshGraph } from "../src/graph/refresh.js";
import type { GraphV1 } from "../src/graph/types.js";

function repoWithDirs(): string {
  const d = mkdtempSync(join(tmpdir(), "graft-only-dir-"));
  mkdirSync(join(d, "src", "a"), { recursive: true });
  mkdirSync(join(d, "src", "b"), { recursive: true });
  writeFileSync(join(d, "src", "a", "a.ts"), "export function a(): number {\n  return 1;\n}\n");
  writeFileSync(join(d, "src", "b", "b.ts"), "export function b(): number {\n  return 2;\n}\n");
  writeFileSync(join(d, "top.ts"), "export function top(): number {\n  return 3;\n}\n");
  return d;
}

function runCli(args: string[]): void {
  execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { stdio: "pipe" });
}

function graphOf(d: string): GraphV1 | null {
  return readGraph(wiringPath(join(d, "graft")));
}

function paths(g: GraphV1 | null): Set<string> {
  return new Set((g?.nodes ?? []).map((n) => n.path));
}

function configOf(d: string): { onlyDirs?: string[] } | null {
  const p = join(d, ".graft", "config.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

test("without --only-dir nothing changes: whole tree, no .graft/config.json", () => {
  const d = repoWithDirs();
  try {
    runCli(["build", d]);
    runCli(["build", d]);
    const p = paths(graphOf(d));
    for (const f of ["src/a/a.ts", "src/b/b.ts", "top.ts"]) assert.ok(p.has(f), `${f} indexed by default`);
    assert.ok(!existsSync(join(d, ".graft", "config.json")), "a repo that never opts in gets no config file");
    assert.equal(readFingerprint(join(d, "graft"))?.onlyDirs, undefined, "fingerprint records no whitelist");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("--only-dir limits the walk, persists the whitelist, and the probe stays clean", () => {
  const d = repoWithDirs();
  try {
    // Default: everything is indexed.
    runCli(["build", d]);
    const full = paths(graphOf(d));
    assert.ok(full.has("src/a/a.ts"), "src/a indexed by default");
    assert.ok(full.has("src/b/b.ts"), "src/b indexed by default");
    assert.ok(full.has("top.ts"), "top.ts indexed by default");

    // Only src/a.
    runCli(["build", d, "--only-dir", "src/a"]);
    const limited = paths(graphOf(d));
    assert.ok(limited.has("src/a/a.ts"), "src/a must be indexed");
    assert.ok(!limited.has("src/b/b.ts"), "src/b must be skipped");
    assert.ok(!limited.has("top.ts"), "top.ts must be skipped");

    // Persisted in the repo's local config and recorded in the fingerprint.
    assert.deepEqual(configOf(d)?.onlyDirs, ["src/a"], "config must persist the whitelist");
    const fp = readFingerprint(join(d, "graft"));
    assert.deepEqual(fp?.onlyDirs, ["src/a"], "fingerprint must record the whitelist");

    // The fingerprint probe (the fast path `ensureFreshGraph`/hooks use, which
    // never sees CLI flags) must enumerate the same whitelisted set — so the
    // excluded src/b and top.ts are NOT reported as phantom "added" drift.
    const drift = probeDrift(d, join(d, "graft"));
    assert.ok(drift && isClean(drift), "excluded files must not read as drift");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("a later build without the flag keeps the persisted whitelist", () => {
  const d = repoWithDirs();
  try {
    runCli(["build", d, "--only-dir", "src/a"]);
    runCli(["build", d]);
    const p = paths(graphOf(d));
    assert.ok(p.has("src/a/a.ts"), "src/a still indexed");
    assert.ok(!p.has("src/b/b.ts"), "src/b stays skipped");
    assert.ok(!p.has("top.ts"), "top.ts stays skipped");
    assert.deepEqual(readFingerprint(join(d, "graft"))?.onlyDirs, ["src/a"], "fingerprint keeps the whitelist");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("the refresh path keeps the whitelist even when the fingerprint is gone", async () => {
  const d = repoWithDirs();
  try {
    runCli(["build", d, "--only-dir", "src/a"]);
    // A wiped cache: no fingerprint, so only the persisted config can carry it.
    rmSync(fingerprintPath(join(d, "graft")), { force: true });
    writeFileSync(join(d, "src", "a", "a.ts"), "export function a(): number {\n  return 11;\n}\n");
    const r = await ensureFreshGraph(d);
    assert.ok(r.refreshed, "a missing fingerprint must trigger a rebuild");
    const p = paths(graphOf(d));
    assert.ok(p.has("src/a/a.ts"), "src/a indexed after refresh");
    assert.ok(!p.has("src/b/b.ts"), "src/b stays skipped after refresh");
    assert.ok(!p.has("top.ts"), "top.ts stays skipped after refresh");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("--all-dirs lifts the whitelist, and later builds stay whole", () => {
  const d = repoWithDirs();
  try {
    runCli(["build", d, "--only-dir", "src/a"]);
    runCli(["build", d, "--all-dirs"]);
    runCli(["build", d]);
    const p = paths(graphOf(d));
    for (const f of ["src/a/a.ts", "src/b/b.ts", "top.ts"]) assert.ok(p.has(f), `${f} indexed again`);
    assert.deepEqual(configOf(d)?.onlyDirs, [], "config records the deliberate full tree");
    assert.equal(readFingerprint(join(d, "graft"))?.onlyDirs, undefined, "fingerprint records no whitelist");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("--only-dir and --all-dirs together are rejected", () => {
  const d = repoWithDirs();
  try {
    assert.throws(() => runCli(["build", d, "--only-dir", "src/a", "--all-dirs"]));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("--only-dir rejects a prefix that normalizes to empty", () => {
  const d = repoWithDirs();
  try {
    let failed = false;
    try {
      execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", "build", d, "--only-dir", "/"], {
        stdio: "pipe",
      });
    } catch {
      failed = true;
    }
    assert.ok(failed, "a bare / prefix must be rejected");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
