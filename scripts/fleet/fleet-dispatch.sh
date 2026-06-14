#!/usr/bin/env bash
# Fleet dispatcher (bash companion) for Aether worktree-based parallel dev.
# Mirrors fleet-dispatch.ps1 for use from Git Bash. Requires: git, jq.
#
#   ./fleet-dispatch.sh list
#   ./fleet-dispatch.sh dispatch 1.3 0.5 0.1 --dry-run
#   ./fleet-dispatch.sh dispatch 1.3
#   ./fleet-dispatch.sh status
#   ./fleet-dispatch.sh collect 1.3
#   ./fleet-dispatch.sh cleanup 1.3 --delete-branch
#
# This script only orchestrates git worktrees + briefs. It never edits Aether
# source — the agent you launch does the implementation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/wu-manifest.json"
command -v jq >/dev/null || { echo "jq is required (https://jqlang.github.io/jq/)"; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO_PARENT="$(dirname "$REPO_ROOT")"
BASE_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
PREFIX="$(jq -r '.worktreePrefix' "$MANIFEST")"
HANDOFF="$(jq -r '.handoff' "$MANIFEST")"

wu_field() { jq -r --arg id "$1" --arg f "$2" '.workUnits[$id][$f] // ""' "$MANIFEST"; }
wu_exists() { [ "$(jq -r --arg id "$1" '.workUnits[$id] // "null"' "$MANIFEST")" != "null" ]; }
wt_path()  { echo "$REPO_PARENT/${PREFIX}$1"; }
branch_of() { echo "wu/$1-$(wu_field "$1" slug)"; }

write_brief() {
  local id="$1" path="$2"
  local title spec files deps notes agent
  title="$(wu_field "$id" title)"; spec="$(wu_field "$id" spec)"
  files="$(jq -r --arg id "$id" '.workUnits[$id].files | join(", ")' "$MANIFEST")"
  deps="$(jq -r --arg id "$id" '(.workUnits[$id].deps | join(", ")) // ""' "$MANIFEST")"
  [ -z "$deps" ] && deps="(none)"
  notes="$(wu_field "$id" notes)"; agent="$(wu_field "$id" suggestedAgent)"
  cat > "$path/FLEET_BRIEF.md" <<EOF
# Fleet brief — WU-$id: $title

Read the master plan first: $HANDOFF
Then implement **Work Unit $id — $title**.

- Spec section: $spec
- Likely files: $files
- Depends on (must be merged first): $deps
- Suggested agent: $agent
${notes:+WU-specific note: $notes}

## Rules (binding)
- Honor the Shared Contract (CODEX_HANDOFF §3) and the do-not-break list (§6).
- Isolated on branch '$(branch_of "$id")' off '$BASE_BRANCH'. Touch only this WU's files.
- Do NOT commit FLEET_BRIEF.md (it is the brief, not source).
- Communicate via the orchestrator only (no peer-to-peer).

## Before you finish, run the gates
- cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check
- (repo root) pnpm test
Report the diff and which gates passed.
EOF
}

cmd="${1:-list}"; shift || true
DRY=0; DELBR=0; IDS=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --delete-branch) DELBR=1 ;;
    *) IDS+=("$a") ;;
  esac
done

case "$cmd" in
  list)
    echo "Work Units (from $HANDOFF):"; echo
    jq -r '.workUnits | to_entries[] | "\(.key)\t\(.value.phase)\t\(.value.title)\t\((.value.deps|join(","))//"-")\t\(.value.suggestedAgent)"' "$MANIFEST" \
      | while IFS=$'\t' read -r id ph title deps ag; do
          printf '%-6s P%-4s %-44s deps:%-10s [%s]\n' "$id" "$ph" "$title" "${deps:--}" "$ag"
        done
    echo; echo "Dispatch with:  ./fleet-dispatch.sh dispatch <id> [<id> ...] [--dry-run]"
    ;;
  dispatch)
    [ "${#IDS[@]}" -gt 0 ] || { echo "Pass Work Unit ids, e.g. dispatch 1.3 0.5 0.1"; exit 1; }
    for id in "${IDS[@]}"; do
      wu_exists "$id" || { echo "Unknown WU '$id'"; exit 1; }
      path="$(wt_path "$id")"; branch="$(branch_of "$id")"; agent="$(wu_field "$id" suggestedAgent)"
      echo; echo "=== WU-$id : $(wu_field "$id" title) ==="
      notes="$(wu_field "$id" notes)"; [[ "$notes" == *LOCKSTEP* ]] && echo "  ! $notes"
      if [ "$DRY" -eq 1 ]; then
        echo "  [dry-run] git -C $REPO_ROOT worktree add -b $branch $path $BASE_BRANCH"
        echo "  [dry-run] write FLEET_BRIEF.md"
      else
        [ -d "$path" ] || git -C "$REPO_ROOT" worktree add -b "$branch" "$path" "$BASE_BRANCH"
        write_brief "$id" "$path"
      fi
      echo "  launch:  cd \"$path\" && $agent   # then: 'Read FLEET_BRIEF.md and implement it.'"
    done
    [ "$DRY" -eq 1 ] && echo && echo "(dry-run: nothing was created)"
    ;;
  status)
    echo "Active worktrees:"; echo; git -C "$REPO_ROOT" worktree list
    echo; echo "WU branch divergence vs '$BASE_BRANCH' (ahead/behind):"; echo
    git -C "$REPO_ROOT" for-each-ref --format='%(refname:short)' refs/heads/wu | while read -r b; do
      c="$(git -C "$REPO_ROOT" rev-list --left-right --count "$BASE_BRANCH...$b" 2>/dev/null || echo '0 0')"
      printf '%-34s +%s ahead / -%s behind\n' "$b" "${c#* }" "${c% *}"
    done
    ;;
  collect)
    for id in "${IDS[@]}"; do
      branch="$(branch_of "$id")"
      echo; echo "=== Review WU-$id ($branch) ==="
      git -C "$REPO_ROOT" diff --stat "$BASE_BRANCH...$branch"
      echo "  merge when green:  git -C \"$REPO_ROOT\" merge --no-ff $branch"
    done
    ;;
  cleanup)
    for id in "${IDS[@]}"; do
      path="$(wt_path "$id")"; branch="$(branch_of "$id")"
      echo "=== Cleanup WU-$id ==="
      git -C "$REPO_ROOT" worktree remove "$path" --force
      [ "$DELBR" -eq 1 ] && git -C "$REPO_ROOT" branch -D "$branch"
    done
    ;;
  *) echo "Unknown command: $cmd"; exit 1 ;;
esac
