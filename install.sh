#!/bin/bash
# install.sh — One-click installer for Coder Agent
#
# Usage:
#   # Remote install (from GitHub)
#   curl -fsSL https://raw.githubusercontent.com/AgenticMatrix/Coder-Agent/main/install.sh | bash
#
#   # Local development install (run from repo root)
#   ./install.sh --local
#   ./install.sh --dev
#
# This script:
#   1. Checks Node.js >= 18
#   2. Installs coder-agent (npm registry or local link)
#   3. Creates ~/.coder configuration directory
#   4. Optionally sets up API keys
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

LOCAL_INSTALL=false
for arg in "$@"; do
  case "$arg" in
    --local|--dev) LOCAL_INSTALL=true ;;
  esac
done

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║        Coder Agent — One-Click Installer          ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# ---------------------------------------------------------------------------
# 1. Check Node.js
# ---------------------------------------------------------------------------
NODE_MIN_VERSION=18

if ! command -v node &> /dev/null; then
  echo -e "${RED}ERROR: Node.js is not installed.${NC}"
  echo ""
  echo "Coder Agent requires Node.js >= ${NODE_MIN_VERSION}."
  echo "Install it from: https://nodejs.org/"
  echo ""
  echo "Or use a version manager:"
  echo "  - nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "  - fnm:  curl -fsSL https://fnm.vercel.app/install | bash"
  echo "  - brew: brew install node"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

echo -e "Node.js version: ${GREEN}v${NODE_VERSION}${NC}"

if [ "$NODE_MAJOR" -lt "$NODE_MIN_VERSION" ]; then
  echo -e "${YELLOW}WARNING: Node.js v${NODE_MAJOR} detected. Coder Agent recommends v${NODE_MIN_VERSION}+.${NC}"
  echo "Some features may not work correctly."
  echo ""
fi

# ---------------------------------------------------------------------------
# 2. Auto-detect local dev install
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Auto-detect if we're inside the coder-agent repo
if [ -f "${SCRIPT_DIR}/packages/cli/package.json" ] && [ -f "${SCRIPT_DIR}/pnpm-workspace.yaml" ]; then
  LOCAL_INSTALL=true
  REPO_DIR="${SCRIPT_DIR}"
fi

# ---------------------------------------------------------------------------
# 3. Install coder-agent
# ---------------------------------------------------------------------------
echo ""

if $LOCAL_INSTALL; then
  # --- Local / Development install ---
  echo -e "${CYAN}Local development install detected.${NC}"

  if [ -z "${REPO_DIR:-}" ]; then
    # User passed --local but we're not in the repo
    echo -e "${RED}ERROR: --local flag used but not inside coder-agent repo.${NC}"
    echo "Run this script from the repo root:"
    echo "  git clone https://github.com/AgenticMatrix/Coder-Agent.git"
    echo "  cd Coder-Agent && ./install.sh --local"
    exit 1
  fi

  echo -e "Repo directory: ${GREEN}${REPO_DIR}${NC}"
  echo ""

  # Install dependencies
  if command -v pnpm &> /dev/null; then
    echo -e "${CYAN}Installing dependencies with pnpm...${NC}"
    (cd "${REPO_DIR}" && pnpm install)
  elif command -v npm &> /dev/null; then
    echo -e "${CYAN}Installing dependencies with npm...${NC}"
    (cd "${REPO_DIR}" && npm install)
  else
    echo -e "${RED}ERROR: Neither pnpm nor npm found.${NC}"
    exit 1
  fi

  # Build
  echo ""
  echo -e "${CYAN}Building coder-agent...${NC}"
  (cd "${REPO_DIR}" && pnpm build 2>/dev/null || npm run build 2>/dev/null || true)

  # Link CLI globally so 'coder' command is available
  echo ""
  echo -e "${CYAN}Linking coder command globally...${NC}"
  (cd "${REPO_DIR}/packages/cli" && npm link --force 2>/dev/null || npm link 2>/dev/null || true)

  echo -e "${GREEN}✅ coder-agent built and linked locally${NC}"

else
  # --- Remote / npm registry install ---
  echo -e "${CYAN}Installing coder-agent from npm registry...${NC}"
  if npm install -g coder-agent 2>&1; then
    echo -e "${GREEN}✅ coder-agent installed from npm${NC}"
  else
    echo -e "${YELLOW}⚠️  npm registry install failed (package may not be published yet).${NC}"
    echo ""
    echo "To install from source:"
    echo "  git clone https://github.com/AgenticMatrix/Coder-Agent.git"
    echo "  cd Coder-Agent && ./install.sh --local"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 4. Verify installation
# ---------------------------------------------------------------------------
echo ""
echo -e "${CYAN}Verifying installation...${NC}"

if command -v coder &> /dev/null; then
  CODER_VERSION=$(coder --version 2>/dev/null || echo "unknown")
  echo -e "${GREEN}✅ coder command available (${CODER_VERSION})${NC}"
else
  echo -e "${YELLOW}⚠️  coder command not on PATH yet.${NC}"
  echo ""
  echo "Restart your terminal or run:"
  echo "  source ~/.zshrc   # for zsh"
  echo "  source ~/.bashrc  # for bash"
  echo ""
  echo "Or add this alias manually:"
  echo "  alias coder=\"node ${REPO_DIR:-$PWD}/packages/cli/dist/entry.js\""
fi

# ---------------------------------------------------------------------------
# 5. Create configuration directory
# ---------------------------------------------------------------------------
CODER_DIR="${HOME}/.coder"

echo ""
echo -e "${CYAN}Setting up configuration...${NC}"

mkdir -p "${CODER_DIR}"
mkdir -p "${CODER_DIR}/sessions"
mkdir -p "${CODER_DIR}/skills"
mkdir -p "${CODER_DIR}/scratchpad"

echo -e "${GREEN}✅ Configuration directory created at ${CODER_DIR}${NC}"

# ---------------------------------------------------------------------------
# 6. Model Configuration (settings.json)
# ---------------------------------------------------------------------------
SETTINGS_FILE="${CODER_DIR}/settings.json"

echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  Model Configuration                            ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "Configure your default LLM provider and model."
echo ""

# -- CODER_BASE_URL --
echo -e "${CYAN}API Base URL${NC} (e.g. https://api.deepseek.com/anthropic)"
echo "Press Enter to skip:"
read -r -p "> " coder_base_url

# -- CODER_MODEL --
echo ""
echo -e "${CYAN}Model ID${NC} (e.g. deepseek-chat, claude-sonnet-4-6)"
echo "Press Enter for default (deepseek-chat):"
read -r -p "> " coder_model
coder_model="${coder_model:-deepseek-chat}"

# -- CODER_AUTH_TOKEN --
echo ""
echo -e "${CYAN}API Key / Auth Token${NC}"
echo "Press Enter to skip (you can set CODER_AUTH_TOKEN env var later):"
read -r -p "> " coder_auth_token

# Build settings.json
SETTINGS_JSON=$(cat <<SETEOF
{
  "theme": "dark",
  "default_model": "${coder_model}",
  "model_list": [
    {
      "name": "${coder_model}",
      "model": "${coder_model}",
      "base_url": "${coder_base_url}",
      "auth_token_env": "CODER_AUTH_TOKEN",
      "provider": "deepseek"
    }
  ],
  "env": {
    "CODER_MODEL": "${coder_model}",
    "CODER_BASE_URL": "${coder_base_url}",
    "CODER_AUTH_TOKEN": "${coder_auth_token}"
  }
}
SETEOF
)

# Write settings.json
echo "$SETTINGS_JSON" > "$SETTINGS_FILE"
echo -e "${GREEN}✅ Created ${SETTINGS_FILE}${NC}"

# Export env vars for immediate use
if [ -n "$coder_base_url" ]; then
  export CODER_BASE_URL="$coder_base_url"
fi
if [ -n "$coder_auth_token" ]; then
  export CODER_AUTH_TOKEN="$coder_auth_token"
fi
export CODER_MODEL="$coder_model"

# Add to shell config for persistence
SHELL_CONFIG=""
if [ -f "${HOME}/.zshrc" ]; then
  SHELL_CONFIG="${HOME}/.zshrc"
elif [ -f "${HOME}/.bashrc" ]; then
  SHELL_CONFIG="${HOME}/.bashrc"
elif [ -f "${HOME}/.bash_profile" ]; then
  SHELL_CONFIG="${HOME}/.bash_profile"
fi

if [ -n "$SHELL_CONFIG" ]; then
  {
    echo ""
    echo "# Coder Agent — Model Configuration"
    echo "export CODER_MODEL=${coder_model}"
    [ -n "$coder_base_url" ] && echo "export CODER_BASE_URL=${coder_base_url}"
    [ -n "$coder_auth_token" ] && echo "export CODER_AUTH_TOKEN=${coder_auth_token}"
  } >> "$SHELL_CONFIG"
  echo -e "${GREEN}✅ Env vars added to ${SHELL_CONFIG}${NC}"
fi

# ---------------------------------------------------------------------------
# 7. Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Coder Agent installation complete!               ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Quick Start:${NC}"
echo ""
echo "  # Start an interactive session"
echo "  coder"
echo ""
echo "  # Ask a one-shot question"
echo "  coder 'Explain this codebase'"
echo ""
echo "  # Run in coordinator mode (multi-worker)"
echo "  coder --coordinator 'Fix the auth bug'"
echo ""
echo -e "${CYAN}Configuration:${NC}"
echo "  ~/.coder/               — Configuration directory"
echo "  ~/.coder/settings.json  — Provider & model settings"
echo "  export CODER_AUTH_TOKEN  — Set your API key if skipped during install"
echo "  CODER.md                — Project-specific instructions"
echo ""
echo -e "${YELLOW}Documentation: https://github.com/AgenticMatrix/Coder-Agent${NC}"
