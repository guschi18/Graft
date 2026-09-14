# Standard-Prompt: Graft in einem neuen Projekt einrichten

Einmal pro neuem Repo an Claude Code / Codex / OpenCode geben (Platzhalter
`<REPO-PFAD>` und `<DOCS-AUSSCHLUSS>` ausfuellen). Ergebnis: dasselbe Setup
wie in Pablo_Finanzen_Brain, x-bookmarks und kickbase-app — lokal fuer alle
drei Agenten nutzbar, ohne Cloud-Fehlversuche.

---

Wir richten Graft (Repo-Context-Graph, `@nanonets/graft`, unser Fork
`github.com/guschi18/Graft`, global gelinkt als `graft`-CLI) in `<REPO-PFAD>`
ein — fuer Claude Code, Codex und OpenCode, lokal und cloudfaehig.

**Recherche zuerst (nur lesen):**
1. `git status` — sauberer Stand vor Config-Aenderungen?
2. Existiert schon `.mcp.json`, `.claude/skills/graft/`, ein
   `<!-- graft:start -->`-Block in `AGENTS.md`, oder eine leere/verwaiste
   `graft/`-Ordnerleiche von einem Vorversuch?
3. Hat das Repo eine "CLAUDE.md und AGENTS.md sind immer identisch"-Regel
   (grep in CLAUDE.md/AGENTS.md nach "Gepaarte Dateien" o.ae.)? Falls ja: die
   Regel gilt **nicht** fuer den Graft-Block (siehe Schritt 3).
4. Skill-Mirror-Konvention pruefen: mirrort das Repo `.claude/skills/` nach
   `.codex/skills/` und `.agents/skills/` (Datei-Duplikat oder Symlink)?

**Umsetzung:**

1. `graft --version` (sollte 0.17.0+ zeigen, global via `D:\Tools\Graft`
   gelinkt). `graft init --agents agents claude --no-global` im Repo-Root
   ausfuehren. `--no-global` haelt alles repo-lokal — Codex/OpenCode-MCP
   global zu registrieren ist eine separate, repo-uebergreifende
   Grundsatzentscheidung, hier nicht mit anfassen.

2. Nach `init` git diff/status pruefen, dann von Hand nachziehen:
   - **CLAUDE.md != AGENTS.md beim Graft-Block.** Graft schreibt den
     `<!-- graft:start -->…<!-- graft:end -->`-Block nur in `AGENTS.md` und
     ruehrt `CLAUDE.md` nie an (offizielles Design, Quelle: Graft-README
     "Agent integration" — "Claude Code … never touches your CLAUDE.md").
     Hat das Repo eine strikte "immer identisch"-Regel, dort eine explizite
     Ausnahme dokumentieren und `CLAUDE.md` stattdessen eine schlanke
     `## Graft`-Notiz bekommen (Vorlage: kickbase-app `CLAUDE.md`,
     Abschnitt "## Graft"). Sonst bleibt `CLAUDE.md` unveraendert.
   - `.claude/skills/graft/SKILL.md` nach `.codex/skills/graft/` und ggf.
     `.agents/skills/graft/` mirrorn, per Repo-Konvention (Kopie, kein
     Symlink unter Windows). Wichtig: Graft's SessionStart-Hook schreibt die
     Claude-Quelldatei bei jeder Session neu — die Mirrors muessen nach
     jeder Aenderung erneut manuell nachgezogen werden.
   - `opencode.json`: `mcp.graft`-Eintrag (`{"type":"local","command":
     ["graft","mcp"],"enabled":true}`) prüfen/ergaenzen, verwaiste
     Permission-Reste (z. B. `"graft version*"`) durch `"graft*"` /
     `"npx graft*"` ersetzen.
   - `.graft/config.json` mit `onlyDirs` anlegen — Kern-Code-Ordner plus nur
     die noch relevanten Doku-Ordner. **Ausschliessen**: Archiv-/History-Docs
     (`<DOCS-AUSSCHLUSS>`, z. B. `docs/archiv`, `docs/old`,
     `wiki/attic` — alles, was abgeschlossene/veraltete Planung ist), sonst
     verwaessern die den `graft ask`-Lexical-Ranking messbar (erlebt in
     kickbase-app: Archiv-Tickets schlugen die echte Trefferdatei).
   - `.ignore` pruefen/anlegen, damit ripgrep `graft/` durchsucht, aber
     `graft/.cache/` und `graft/.graph/` ausschliesst.

3. **Verifikation** (lokal, vor Cloud):
   ```
   graft build
   graft check          # muss "graph check: OK" zeigen
   graft map
   graft ask "<eine echte Frage zum Repo>" --source
   graft callers <ein bekanntes Symbol>
   ```
   Erwartung: Top-Treffer sind echte Quelldateien, keine Archiv-/Noise-Docs.
   Falls doch: `.graft/config.json`-Scope nachschaerfen (Schritt 2), nicht
   sofort auf Deep-Build (`--deep`, braucht LLM-Key + kostet) ausweichen —
   das behebt Scope-Rauschen nicht, nur fehlende Semantik.

4. **Cloud (Claude Code Cloud + Codex Cloud):** Ein simples
   `npm install -g "git+https://github.com/guschi18/Graft.git#<sha>"` **schlaegt
   fehl** — das Paket baut native tree-sitter-Grammatiken (u. a. Kotlin), die
   ein Git-URL-npm-Install in der Cloud-Sandbox nicht zuverlaessig kompiliert.
   Stattdessen `scripts/cloud-setup.sh` (Kopie aus
   `D:\Tools\Graft\Github-repo.md`-Praxis bzw. 1:1 aus kickbase-app
   uebernehmen) ins Repo legen — klont Graft in ein Tempverzeichnis, baut es
   lokal, installiert erst dann global, baut den Graph pro erkanntem Repo vor
   und setzt `skip-worktree` auf die vom SessionStart-Hook neu geschriebenen
   Helper-/Skill-Dateien. Dieses Skript wird **nicht** automatisch gelesen —
   sein kompletter Inhalt muss manuell ins **Setup-script**-Feld der
   jeweiligen Cloud-Umgebung eingetragen werden:
   [claude.ai/code](https://claude.ai/code) → Cloud-Icon → Umgebung
   bearbeiten/anlegen → Feld **Setup script**. Feld **Environment variables**
   bleibt leer (kein Key fuer den strukturellen Graph noetig). **Network
   access** auf `Trusted` belassen (`github.com`, `registry.npmjs.org` sind
   dort bereits erlaubt). Dieselben Zeilen zusaetzlich ins
   Codex-Cloud-Setup-Script-Feld eintragen.
   OpenCode: nur wenn es bei diesem Nutzer tatsaechlich in einem
   Cloud/Remote-Modus laeuft (aktuell bei uns: nein) — sonst reicht der
   lokale `mcp.graft`-Eintrag.

5. **Committen** (nur die Graft-Wiring-Dateien, nie `graft/` selbst):
   `.mcp.json`, `.claude/settings.json`, `.claude/helpers/`,
   `.claude/skills/graft/`, `.codex/skills/graft/`, `.agents/skills/graft/`
   (falls vorhanden), `opencode.json`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`,
   `.ignore`, `.graft/config.json`, `scripts/cloud-setup.sh`.

**Bei Unklarheit fragen statt annehmen:** `--no-global` vs. global,
`.graft/config.json`-Scope, ob das Repo tatsaechlich in Cloud-Umgebungen
laeuft. Diese drei Punkte waren bei jedem bisherigen Rollout
(Pablo_Finanzen_Brain, x-bookmarks, kickbase-app) repo-spezifisch anders.

---

*Zuletzt aktualisiert nach dem kickbase-app-Rollout (2026-09-14): CLAUDE.md/
AGENTS.md-Trennung korrigiert, funktionierendes Cloud-Setup-Skript (Build aus
Source statt `npm install -g git+...`), Docs-Scope-Heuristik gegen
Archiv-Rauschen ergaenzt.*
