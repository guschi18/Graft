#!/bin/bash
# Canonical template for the Claude Code Cloud / Codex Cloud "Setup script"
# field. Paste this verbatim into a new project's environment dialog
# (claude.ai/code -> cloud icon -> Add/edit cloud environment -> Setup
# script), and also drop a copy at <repo>/scripts/cloud-setup.sh as a
# reference (it is NOT read automatically — the UI field is the only place
# that actually runs it). Leave the environment's "Environment variables"
# field empty; graft needs no key for the structural (non-LLM) graph.
#
# A plain `npm install -g "git+https://.../Graft.git#sha"` fails: the
# package builds native modules (tree-sitter grammars, incl. Kotlin) that a
# git-URL npm install doesn't reliably compile in the cloud sandbox. This
# clones, builds locally, then installs the built tree globally — proven
# working across Pablo_Finanzen_Brain and kickbase-app.
#
# Pin GRAFT_SHA to a real, pushed commit on github.com/guschi18/Graft —
# never a branch name — so the install is reproducible. Check
# D:\Tools\Graft\Graft-Rollout-Prompt.md for the current recommended pin
# before reusing this in a new project.
set -euo pipefail

GRAFT_SHA="c38758e2127677dd103ea405643ed26d50e1faa2"
TMP_DIR="$(mktemp -d)"

git clone --quiet \
  https://github.com/guschi18/Graft.git \
  "$TMP_DIR/graft"

git -C "$TMP_DIR/graft" checkout --quiet "$GRAFT_SHA"

cd "$TMP_DIR/graft"

npm install --include=dev --ignore-scripts
npm rebuild tree-sitter-kotlin --build-from-source
npm run build
node scripts/stamp-telemetry-key.mjs
npm install --global --ignore-scripts "$TMP_DIR/graft"

for repo in /home/user/*; do
  if [ -f "$repo/.claude/skills/graft/SKILL.md" ]; then
    echo "Building Graft graph in $repo"
    (cd "$repo" && graft build .)

    # The graft SessionStart hook rewrites these files fresh in the cloud
    # (/tmp paths, template). Tell git to ignore that so none of it gets
    # committed.
    for f in .claude/helpers/graft-hooks.cjs .claude/helpers/graft-statusline.cjs .claude/skills/graft/SKILL.md; do
      if git -C "$repo" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
        git -C "$repo" update-index --skip-worktree "$f"
      fi
    done
  fi
done

graft --version
