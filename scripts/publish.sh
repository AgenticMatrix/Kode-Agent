#!/bin/bash
# publish.sh — NPM publish orchestration for the Coder Agent monorepo
#
# Usage: ./scripts/publish.sh
#   Requires NODE_AUTH_TOKEN env var for npm authentication.
#   Called automatically by .github/workflows/release.yml on version tags.
#
# Publishing order (dependency-ordered):
#   1. @coder/shared    — shared types & utilities (no deps)
#   2. @coder/provider  — LLM provider abstraction (depends on shared)
#   3. @coder/tools     — 26+ tool implementations (depends on shared)
#   4. @coder/tui       — Terminal UI framework (no coder deps)
#   5. @coder/skills    — Skills system (depends on shared)
#   6. @coder/core      — Core runtime engine (depends on shared)
#   7. @coder/cli       — CLI entrypoint (depends on all above)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ---------------------------------------------------------------------------
# 1. Read current version
# ---------------------------------------------------------------------------
VERSION=$(node -p "require('./package.json').version")
echo "=== Publishing coder-agent v${VERSION} ==="

# Verify we're on the right tag
CURRENT_TAG=$(git describe --tags --exact-match 2>/dev/null || echo "none")
if [ "$CURRENT_TAG" != "v${VERSION}" ]; then
  echo "WARNING: Current git tag (${CURRENT_TAG}) doesn't match package.json version (v${VERSION})"
  echo "Continuing anyway — this might be a dry-run or manual publish."
fi

# ---------------------------------------------------------------------------
# 2. Check npm auth
# ---------------------------------------------------------------------------
if [ -z "${NODE_AUTH_TOKEN:-}" ] && [ -z "${NPM_TOKEN:-}" ]; then
  echo "ERROR: Neither NODE_AUTH_TOKEN nor NPM_TOKEN is set."
  echo "Set one of them to authenticate with the npm registry."
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Publish packages in dependency order
# ---------------------------------------------------------------------------
PACKAGES=(
  "@coder/shared"
  "@coder/provider"
  "@coder/tools"
  "@coder/tui"
  "@coder/skills"
  "@coder/core"
  "@coder/cli"
)

echo ""
echo "=== Publishing ${#PACKAGES[@]} packages ==="

FAILED_PACKAGES=()

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "--- Publishing ${pkg} ---"

  if pnpm publish --filter "${pkg}" --access public --no-git-checks 2>&1; then
    echo "✅ ${pkg} published successfully"
  else
    echo "❌ ${pkg} publish failed"
    FAILED_PACKAGES+=("${pkg}")
  fi
done

# ---------------------------------------------------------------------------
# 4. Report results
# ---------------------------------------------------------------------------
echo ""
echo "=== Publish Summary ==="

if [ ${#FAILED_PACKAGES[@]} -eq 0 ]; then
  echo "✅ All ${#PACKAGES[@]} packages published to npm"
  echo ""
  echo "Install with: npm install -g coder-agent"
  exit 0
else
  echo "❌ ${#FAILED_PACKAGES[@]} packages failed to publish:"
  for pkg in "${FAILED_PACKAGES[@]}"; do
    echo "   - ${pkg}"
  done
  exit 1
fi
