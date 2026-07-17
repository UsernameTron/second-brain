#!/usr/bin/env bash
# engstatus.sh — deterministic engineering status sweep. No model in the loop.
#
# Writes STATUS.md per repo + a rolled-up INDEX.md, emits a ready-to-paste narrative
# prompt (facts baked in, so prose is one paste away), and appends a dated facts-only
# change digest to second-brain. Structural health is git-derived; it never runs your
# builds and never promotes anything.
#
# bash 3.2 safe (macOS). Read-only except for the status files it writes.
#
# Cron it:  0 6 * * *  /usr/bin/env bash ~/bin/engstatus.sh >> ~/.engstatus.log 2>&1

set -uo pipefail

# ---------- config (override via env) ----------
PROJECTS_ROOT="${PROJECTS_ROOT:-$HOME/projects}"
SECOND_BRAIN="${SECOND_BRAIN:-$HOME/projects/second-brain}"
EXCLUDE_RE="${EXCLUDE_RE:-(/node_modules/|/\.Trash/|ispn|genesys|asana)}"  # case-insensitive; hard exclusions
MAXDEPTH="${MAXDEPTH:-5}"   # .git search depth (repo root up to depth 4 under root — catches group/projects/repo)
TODAY="$(date +%F)"

# put status dir in second-brain if it exists, else fall back beside projects
if [ -d "$SECOND_BRAIN" ]; then
  STATUS_DIR="$SECOND_BRAIN/engineering-status"
  DIGEST_TARGET="$SECOND_BRAIN/state/decisions.md"
else
  STATUS_DIR="$PROJECTS_ROOT/engineering-status"
  DIGEST_TARGET=""   # no second-brain → skip digest
fi
INDEX="$STATUS_DIR/INDEX.md"
PROMPT="$STATUS_DIR/NARRATIVE-PROMPT.md"
SNAPSHOT="$STATUS_DIR/.last-snapshot"
mkdir -p "$STATUS_DIR"

NEW_SNAPSHOT="$(mktemp)"
ROWS_FILE="$(mktemp)"
GREEN=0; YELLOW=0; RED=0; COUNT=0

base_branch() {  # echo the base branch that actually exists
  local r="$1" b
  for b in main master develop; do
    git -C "$r" rev-parse --verify --quiet "refs/heads/$b" >/dev/null 2>&1 && { echo "$b"; return; }
  done
  git -C "$r" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##'
}

# A lifecycle keyword only counts when the line DECLARES the project's status: a
# status label ("**Current state:** SUPERSEDED"), a heading ("## PROJECT PARKED"),
# or a bold banner ("**PARKED — reason**"). Prose that merely MENTIONS a superseded
# file/version is not a project status.
#
# Why (audit 2026-07-17): the bare `grep -qiE 'PARKED|...'` over head -20 that this
# replaces was wrong on 4 of the 6 repos it fired on — active repos read PARKED
# because their STATE.md happened to say "the 2026-05-01 version of this file is
# superseded", "superseded gsd-studio-0.0.3.vsix deleted", "Commission VERIFIED
# (dormant)", or "**SUPERSEDED — this file was a stale duplicate**". Only Jess-SDR
# ("## PROJECT PARKED") and ctg-content-generation ("**Current state:** SUPERSEDED",
# already caught by its SUPERSEDED.md marker) were real.
#
# Strictly narrower than the old grep, so it can only remove false positives, never
# add one. Echoes the matched token so a SUPERSEDED project isn't reported "PARKED".
LIFECYCLE_RE='PARKED|ON[- ]HOLD|SUPERSEDED|DORMANT'
DOCSCOPE_RE='this file|this doc|this STATE|version of this|stale duplicate'

lifecycle_token() {  # $1 = STATE file; echoes PARKED|ON-HOLD|SUPERSEDED|DORMANT or nothing
  head -20 "$1" 2>/dev/null \
    | grep -iE "$LIFECYCLE_RE" \
    | grep -viE "$DOCSCOPE_RE" \
    | grep -iE "^[[:space:]>*_#-]*\**[[:space:]]*([A-Za-z][A-Za-z0-9]*[[:space:]]+)?(current state|status|stage|state|lifecycle|classification)\**[[:space:]]*:[[:space:]]*\**[[:space:]]*(${LIFECYCLE_RE})|^[[:space:]]*#{1,6}[[:space:]].*(${LIFECYCLE_RE})|^[[:space:]>]*\*\*[[:space:]]*(${LIFECYCLE_RE})" \
    | grep -oiE "$LIFECYCLE_RE" | head -1 | tr '[:lower:]' '[:upper:]'
}

# ---------- discover repos (bash 3.2: no mapfile) ----------
while IFS= read -r gd; do
  repo="$(dirname "$gd")"
  printf '%s' "$repo" | grep -qiE "$EXCLUDE_RE" && continue

  name="$(basename "$repo")"
  cur="$(git -C "$repo" branch --show-current 2>/dev/null)"
  [ -z "$cur" ] && cur="(detached)"
  base="$(base_branch "$repo")"

  # Ignore this sweep's OWN artifact. STATUS.md is rewritten every run (the
  # `_generated` date alone changes daily), so counting it made every swept repo
  # permanently dirty → a false 🟡 "uncommitted changes" on repos with zero real
  # work in progress: the dashboard manufacturing the dirtiness it reports, and
  # (once the Stop hook auto-commits it) freezing that stale claim into git.
  # Matches both ` M STATUS.md` (tracked) and `?? STATUS.md` (untracked).
  dirty=0; git -C "$repo" status --porcelain 2>/dev/null | grep -vE '^.{2} STATUS\.md$' | grep -q . && dirty=1

  ahead=0; behind=0
  if [ -n "$base" ] && [ "$base" != "$cur" ] && [ "$cur" != "(detached)" ]; then
    # Compare against the remote-tracking base when it exists — a stale local base
    # produced self-contradictory ahead/unpushed counts (audit 2026-07-16 §B1).
    cmp_base="$base"
    git -C "$repo" rev-parse --verify --quiet "refs/remotes/origin/$base" >/dev/null 2>&1 && cmp_base="origin/$base"
    ahead="$(git -C "$repo" rev-list --count "$cmp_base..HEAD" 2>/dev/null || echo 0)"
    behind="$(git -C "$repo" rev-list --count "HEAD..$cmp_base" 2>/dev/null || echo 0)"
  fi

  if git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    unpushed="$(git -C "$repo" rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  else
    unpushed="no-upstream"
  fi

  last="$(git -C "$repo" log -1 --format='%ci %h %s' 2>/dev/null)"
  ts="$(git -C "$repo" log -1 --format='%ct' 2>/dev/null || echo 0)"
  # Exclude vendored/third-party trees from todo counts (audit §B1: content-generation
  # showed todos=209 of pure vendored-asset noise).
  todos="$(git -C "$repo" grep -I -E 'TODO|FIXME' -- ':!node_modules' ':!vendor' ':!venv' ':!public_html' ':!*.min.js' ':!*.map' 2>/dev/null | wc -l | tr -d ' ')"
  planning="no"; [ -d "$repo/.planning" ] && planning="yes"
  # GSD planning can live at the root (sentiment-analysis pattern) — count that too.
  [ "$planning" = "no" ] && [ -f "$repo/PROJECT.md" ] && [ -f "$repo/ROADMAP.md" ] && planning="yes(root)"
  ci="no"; [ -d "$repo/.github/workflows" ] && ci="yes"
  pickup=""; for f in START-HERE-NEXT.md START-HERE.md NEXT.md; do [ -f "$repo/$f" ] && { pickup="$f"; break; }; done

  # ---------- structural health (git-derived) ----------
  health="green"; hreason="on ${base:-?}, clean, nothing pending"
  if [ "$cur" = "(detached)" ]; then health="red"; hreason="detached HEAD"
  elif [ -f "$repo/BLOCKER.md" ] || [ -f "$repo/.blocked" ]; then health="red"; hreason="BLOCKER file present"
  elif [ "$ahead" -gt 0 ] && [ "$behind" -gt 0 ]; then health="red"; hreason="diverged from $base ($ahead ahead, $behind behind)"
  elif [ -n "$base" ] && [ "$cur" != "$base" ]; then health="yellow"; hreason="on \`$cur\`, not $base ($ahead ahead) — unmerged branch"
  elif [ "$dirty" -eq 1 ]; then health="yellow"; hreason="uncommitted changes in the working tree"
  elif [ "$unpushed" != "no-upstream" ] && [ "$unpushed" != "0" ]; then health="yellow"; hreason="$unpushed unpushed commit(s)"
  elif [ "$behind" -gt 0 ]; then health="yellow"; hreason="$behind commit(s) behind $base"
  fi

  case "$health" in
    green)  emoji="🟢"; GREEN=$((GREEN+1));;
    yellow) emoji="🟡"; YELLOW=$((YELLOW+1));;
    red)    emoji="🔴"; RED=$((RED+1));;
  esac
  COUNT=$((COUNT+1))

  # stage heuristic (facts; the model refines to prose)
  # Lifecycle markers win over git-activity guesses (audit §B1: parked/superseded
  # projects were labeled "active").
  lifecycle=""
  [ -f "$repo/SUPERSEDED.md" ] && lifecycle="SUPERSEDED (see SUPERSEDED.md)"
  if [ -z "$lifecycle" ]; then
    for lf in ".planning/STATE.md" "STATE.md"; do
      [ -n "$lifecycle" ] && break
      [ -f "$repo/$lf" ] || continue
      ltok="$(lifecycle_token "$repo/$lf")"
      [ -n "$ltok" ] && lifecycle="$ltok (per $lf header)"
    done
  fi
  if [ -n "$lifecycle" ]; then
    stage="$lifecycle"
  elif [ "$cur" = "$base" ] && [ "$dirty" -eq 0 ] && [ "$ahead" -eq 0 ] && [ "$behind" -eq 0 ]; then
    stage="on $base, in sync"
  elif [ "$planning" != "no" ]; then
    stage="has GSD planning — phase state in .planning/STATE.md (not verified here)"
  else
    stage="working tree/branch activity — see branch status (not a verified 'active' claim)"
  fi

  # next-step hint (facts)
  if [ -n "$pickup" ]; then next="see $pickup"
  elif [ "$health" = "red" ]; then next="$hreason — unblock"
  elif [ "$health" = "yellow" ]; then next="$hreason — resolve"
  else next="continue / verify build + deploy"
  fi

  # ---------- per-repo STATUS.md ----------
  # NEVER overwrite a human-authored STATUS.md: only write when absent or when the
  # existing file carries the generator marker (audit-remediation 2026-07-16).
  if [ -f "$repo/STATUS.md" ] && ! head -3 "$repo/STATUS.md" | grep -q '_generated'; then
    echo "  skip (human STATUS.md): $repo" >&2
  else
  {
    echo "# STATUS — $name"
    echo "_generated $TODAY · facts only (git-derived); run NARRATIVE-PROMPT.md for prose_"
    echo
    echo "- **Path:** $repo"
    echo "- **Stage:** $stage"
    echo "- **Branch status:** on \`$cur\`${base:+, base \`$base\`}; ahead $ahead / behind $behind; dirty=$([ "$dirty" -eq 1 ] && echo yes || echo no); unpushed=$unpushed"
    echo "- **Health:** $emoji — $hreason"
    echo "- **Signals:** planning=$planning · ci=$ci · todos=$todos${pickup:+ · pickup=$pickup}"
    echo "- **Last commit:** ${last:-none}"
    echo
    echo "_Structural health is git-only. Build/deploy correctness needs a human or model pass._"
  } > "$repo/STATUS.md"
  fi

  echo "$name|$cur|$emoji|$ahead|$behind|$dirty|$unpushed" >> "$NEW_SNAPSHOT"
  printf '%s\t%s\t%s\t%s\t%s\n' "$ts" "$name" "$emoji" "$hreason" "$next" >> "$ROWS_FILE"
done < <(find "$PROJECTS_ROOT" -maxdepth "$MAXDEPTH" -type d -name .git 2>/dev/null | sort)

# ---------- rolled-up INDEX.md ----------
{
  echo "# Engineering status — $TODAY"
  echo "_$GREEN 🟢 · $YELLOW 🟡 · $RED 🔴 across $COUNT repos. Facts only; paste NARRATIVE-PROMPT.md into Claude for prose._"
  echo
  echo "| Project | Health | Why | Next / pickup |"
  echo "|---|---|---|---|"
  sort -t"$(printf '\t')" -k1,1nr "$ROWS_FILE" | while IFS="$(printf '\t')" read -r ts name emoji why next; do
    echo "| $name | $emoji | $why | $next |"
  done
} > "$INDEX"

# ---------- ready-to-paste narrative prompt ----------
{
  echo "# Paste this whole file into Claude for the plain-English pickup readout"
  echo
  echo "You are giving Connor a plain-English engineering pickup readout he can act on cold."
  echo "Below are machine-derived facts per project. For EACH project, write a short block with"
  echo "exactly: Path, Current stage, Branch status, Health (one-line reason), and 1-3 immediate"
  echo "next steps. Rules: lead with the takeaway; plain English, no jargon; structural health is"
  echo "git-only, so where build/deploy correctness matters, say it still needs checking; if facts"
  echo "and any doc disagree, trust the facts. Start with a one-line portfolio summary."
  echo
  echo "FACTS:"
  echo '```'
  while IFS= read -r line; do
    repo="$line"
    [ -f "$repo/STATUS.md" ] && { sed '1,2d' "$repo/STATUS.md"; echo; }
  done < <(find "$PROJECTS_ROOT" -maxdepth "$MAXDEPTH" -type d -name .git 2>/dev/null | while IFS= read -r gd; do d="$(dirname "$gd")"; printf '%s' "$d" | grep -qiE "$EXCLUDE_RE" || echo "$d"; done | sort)
  echo '```'
} > "$PROMPT"

# ---------- change digest to second-brain (facts only, no promote) ----------
if [ -n "$DIGEST_TARGET" ] && [ -f "$DIGEST_TARGET" ]; then
  if [ -f "$SNAPSHOT" ]; then
    CHANGES="$(diff "$SNAPSHOT" "$NEW_SNAPSHOT" 2>/dev/null | grep -E '^[<>]' || true)"
  else
    CHANGES="__FIRST_RUN__"
  fi
  if [ -n "$CHANGES" ]; then
    {
      echo
      echo "<!-- engineering status digest $TODAY -->"
      echo "### Engineering status digest $TODAY"
      echo "$GREEN green / $YELLOW yellow / $RED red across $COUNT repos."
      if [ "$CHANGES" = "__FIRST_RUN__" ]; then
        echo "- First run — baseline snapshot captured; no prior state to diff."
      else
        echo "Changes since last run (repo|branch|health|ahead|behind|dirty|unpushed):"
        printf '%s\n' "$CHANGES" | sed 's/^< /- was:  /; s/^> /- now:  /'
      fi
    } >> "$DIGEST_TARGET"
  fi
fi

mv -f "$NEW_SNAPSHOT" "$SNAPSHOT"
rm -f "$ROWS_FILE"

echo "swept $COUNT repos: ${GREEN}gr / ${YELLOW}yel / ${RED}red"
echo "  INDEX:  $INDEX"
echo "  PROMPT: $PROMPT  (paste into Claude for prose)"
[ -n "$DIGEST_TARGET" ] && [ -f "$DIGEST_TARGET" ] && echo "  digest: appended to $DIGEST_TARGET (if changed)"
