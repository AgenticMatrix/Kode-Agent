#!/bin/bash
# install.sh — One-click installer for Kode Agent
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/AgenticMatrix/Kode-Agent/main/install.sh | bash
#   OR
#   ./install.sh
#
# This script:
#   1. Checks Node.js >= 18
#   2. Installs kode-agent globally via npm
#   3. Creates ~/.kode configuration directory
#   4. Optionally sets up API keys
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║        Kode Agent — One-Click Installer          ║"
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
  echo "Kode Agent requires Node.js >= ${NODE_MIN_VERSION}."
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
  echo -e "${YELLOW}WARNING: Node.js v${NODE_MAJOR} detected. Kode Agent recommends v${NODE_MIN_VERSION}+.${NC}"
  echo "Some features may not work correctly."
  echo ""
fi

# ---------------------------------------------------------------------------
# 2. Check npm / install kode-agent
# ---------------------------------------------------------------------------
if ! command -v npm &> /dev/null; then
  echo -e "${RED}ERROR: npm is not available.${NC}"
  exit 1
fi

echo ""
echo -e "${CYAN}Installing kode-agent globally...${NC}"
if npm install -g kode-agent 2>&1; then
  echo -e "${GREEN}✅ kode-agent installed successfully${NC}"
else
  echo -e "${RED}❌ npm install failed${NC}"
  echo ""
  echo "If this is a development install, try:"
  echo "  git clone https://github.com/AgenticMatrix/Kode-Agent.git"
  echo "  cd kode-agent && pnpm install && pnpm build"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Verify installation
# ---------------------------------------------------------------------------
echo ""
echo -e "${CYAN}Verifying installation...${NC}"

if command -v kode &> /dev/null; then
  KODE_VERSION=$(kode --version 2>/dev/null || echo "unknown")
  echo -e "${GREEN}✅ kode command available (${KODE_VERSION})${NC}"
elif npx kode --version &> /dev/null 2>&1; then
  echo -e "${GREEN}✅ kode available via npx${NC}"
else
  echo -e "${YELLOW}⚠️  kode command not on PATH — you may need to restart your shell${NC}"
fi

# ---------------------------------------------------------------------------
# 4. Create configuration directory
# ---------------------------------------------------------------------------
KODE_DIR="${HOME}/.kode"

echo ""
echo -e "${CYAN}Setting up configuration...${NC}"

mkdir -p "${KODE_DIR}"
mkdir -p "${KODE_DIR}/sessions"
mkdir -p "${KODE_DIR}/skills"
mkdir -p "${KODE_DIR}/scratchpad"

echo -e "${GREEN}✅ Configuration directory created at ${KODE_DIR}${NC}"

# ---------------------------------------------------------------------------
# 5. API Key setup
# ---------------------------------------------------------------------------
echo ""
echo -e "${YELLOW}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║  API Key Configuration                          ║${NC}"
echo -e "${YELLOW}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo "Kode Agent supports multiple LLM providers:"
echo "  - Anthropic (default):  ANTHROPIC_API_KEY"
echo "  - DeepSeek:             DEEPSEEK_API_KEY"
echo "  - OpenAI:               OPENAI_API_KEY"
echo ""

# Check if API keys are already set
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo -e "${GREEN}✅ ANTHROPIC_API_KEY is already set${NC}"
else
  echo -e "${YELLOW}⚠️  ANTHROPIC_API_KEY is not set${NC}"
  echo ""
  echo "To set it now, enter your Anthropic API key (or press Enter to skip):"
  read -r -p "API Key: " api_key

  if [ -n "$api_key" ]; then
    # Detect shell config file
    SHELL_CONFIG=""
    if [ -f "${HOME}/.zshrc" ]; then
      SHELL_CONFIG="${HOME}/.zshrc"
    elif [ -f "${HOME}/.bashrc" ]; then
      SHELL_CONFIG="${HOME}/.bashrc"
    elif [ -f "${HOME}/.bash_profile" ]; then
      SHELL_CONFIG="${HOME}/.bash_profile"
    fi

    if [ -n "$SHELL_CONFIG" ]; then
      echo "" >> "$SHELL_CONFIG"
      echo "# Kode Agent — API Key" >> "$SHELL_CONFIG"
      echo "export ANTHROPIC_API_KEY=${api_key}" >> "$SHELL_CONFIG"
      echo -e "${GREEN}✅ API key added to ${SHELL_CONFIG}${NC}"
      echo ""
      echo -e "${YELLOW}Run 'source ${SHELL_CONFIG}' or restart your terminal to apply.${NC}"
    else
      echo -e "${YELLOW}Could not detect shell config file. Add this to your shell profile:${NC}"
      echo "  export ANTHROPIC_API_KEY=${api_key}"
    fi
  else
    echo "Skipped. You can set it later:"
    echo "  export ANTHROPIC_API_KEY=your-key-here"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Kode Agent installation complete!               ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Quick Start:${NC}"
echo ""
echo "  # Start an interactive session"
echo "  kode"
echo ""
echo "  # Ask a one-shot question"
echo "  kode 'Explain this codebase'"
echo ""
echo "  # Run in coordinator mode (multi-worker)"
echo "  kode --coordinator 'Fix the auth bug'"
echo ""
echo -e "${CYAN}Configuration:${NC}"
echo "  ~/.kode/           — Configuration directory"
echo "  ~/.kode/config.yaml — Provider & model settings"
echo "  KODE.md              — Project-specific instructions"
echo ""
echo -e "${YELLOW}Documentation: https://github.com/AgenticMatrix/Kode-Agent${NC}"
