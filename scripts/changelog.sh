#!/bin/bash
# changelog.sh — Generate CHANGELOG.md from conventional commits
#
# Usage: ./scripts/changelog.sh [version]
#   version — the version tag (e.g., "v0.2.0"). Defaults to "HEAD".
#
# Groups commits by type:
#   feat:     → ✨ Features
#   fix:      → 🐛 Bug Fixes
#   perf:     → ⚡ Performance
#   refactor: → ♻️ Refactoring
#   docs:     → 📝 Documentation
#   test:     → ✅ Tests
#   chore:    → 🔧 Chores
#   ci:       → 👷 CI/CD
#   style:    → 💄 Style
#   build:    → 🏗️ Build
#
# Uses git log between the previous tag and the specified version.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-HEAD}"
CHANGELOG_FILE="CHANGELOG.md"

# Find the previous tag (the one before $VERSION)
PREVIOUS_TAG=$(git describe --tags --abbrev=0 "${VERSION}^" 2>/dev/null || echo "")

if [ -z "$PREVIOUS_TAG" ]; then
  # No previous tag — use the first commit
  PREVIOUS_TAG=$(git rev-list --max-parents=0 HEAD)
  echo "No previous tag found — using first commit as baseline."
fi

RANGE="${PREVIOUS_TAG}..${VERSION}"

echo "=== Generating CHANGELOG for ${VERSION} (${RANGE}) ==="

# ---------------------------------------------------------------------------
# Group commits by conventional commit type
# ---------------------------------------------------------------------------

declare -A GROUPS
declare -A EMOJI

EMOJI[feat]="✨ Features"
EMOJI[fix]="🐛 Bug Fixes"
EMOJI[perf]="⚡ Performance"
EMOJI[refactor]="♻️ Refactoring"
EMOJI[docs]="📝 Documentation"
EMOJI[test]="✅ Tests"
EMOJI[chore]="🔧 Chores"
EMOJI[ci]="👷 CI/CD"
EMOJI[style]="💄 Style"
EMOJI[build]="🏗️ Build"

# Collect commits
while IFS= read -r line; do
  # Parse conventional commit: type(scope)?: message
  if [[ "$line" =~ ^([a-zA-Z]+)(\([^)]+\))?!?:\ (.*)$ ]]; then
    type="${BASH_REMATCH[1]}"
    scope="${BASH_REMATCH[2]}"
    message="${BASH_REMATCH[3]}"

    # Strip parentheses from scope
    scope="${scope//(/}"
    scope="${scope//)/}"

    if [ -n "$scope" ]; then
      formatted="- **${scope}**: ${message}"
    else
      formatted="- ${message}"
    fi

    GROUPS["$type"]="${GROUPS[$type]:-}${formatted}
"
  else
    # Non-conventional commit — put in "Other"
    GROUPS["other"]="${GROUPS[other]:-}- ${line}
"
  fi
done < <(git log --oneline --no-merges "${RANGE}" 2>/dev/null || echo "No commits found")

# Get the date
DATE=$(date +%Y-%m-%d)

# ---------------------------------------------------------------------------
# Write CHANGELOG.md
# ---------------------------------------------------------------------------

{
  echo "# Changelog"
  echo ""
  echo "## ${VERSION} (${DATE})"
  echo ""

  # Ordered by importance
  ORDER=("feat" "fix" "perf" "refactor" "docs" "test" "ci" "build" "style" "chore" "other")

  for type in "${ORDER[@]}"; do
    if [ -n "${GROUPS[$type]:-}" ]; then
      echo "### ${EMOJI[$type]:-$type}"
      echo ""
      echo "${GROUPS[$type]}"
    fi
  done

  if [ -f "$CHANGELOG_FILE" ]; then
    echo ""
    # Append previous changelog content (skip the header line)
    tail -n +2 "$CHANGELOG_FILE"
  fi
} > "${CHANGELOG_FILE}.tmp"

mv "${CHANGELOG_FILE}.tmp" "$CHANGELOG_FILE"

COMMIT_COUNT=$(git log --oneline --no-merges "${RANGE}" 2>/dev/null | wc -l | tr -d ' ')
echo "=== Generated ${CHANGELOG_FILE} with ${COMMIT_COUNT} commits ==="
