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
#   1. Checks Node.js >= 22
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
echo "║        Coder Agent — One-Click Installer         ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# ---------------------------------------------------------------------------
# 1. Check Node.js
# ---------------------------------------------------------------------------
NODE_MIN_VERSION=22

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
  echo -e "${YELLOW}Node.js v${NODE_MAJOR} detected. Coder Agent requires >= ${NODE_MIN_VERSION}.${NC}"
  echo ""

  # Try to auto-install Node.js 22
  AUTO_INSTALLED=false

  # Option 1: fnm (fast, cross-platform)
  if ! $AUTO_INSTALLED && command -v fnm &> /dev/null; then
    echo -e "${CYAN}fnm detected. Installing Node.js 22...${NC}"
    fnm install 22 && fnm use 22 && AUTO_INSTALLED=true
  fi

  # Option 2: nvm
  if ! $AUTO_INSTALLED && [ -s "$HOME/.nvm/nvm.sh" ]; then
    echo -e "${CYAN}nvm detected. Installing Node.js 22...${NC}"
    . "$HOME/.nvm/nvm.sh" && nvm install 22 && nvm use 22 && AUTO_INSTALLED=true
  fi

  # Option 3: Try to install fnm if it is not available
  if ! $AUTO_INSTALLED; then
    echo -e "${CYAN}No Node.js version manager found. Attempting to install fnm...${NC}"
    if command -v curl &> /dev/null; then
      curl -fsSL https://fnm.vercel.app/install | bash
      # Source fnm for current session
      FNM_PATH="$HOME/.local/share/fnm"
      [ -d "$HOME/.fnm" ] && FNM_PATH="$HOME/.fnm"
      if [ -f "$FNM_PATH/fnm" ]; then
        export PATH="$FNM_PATH:$PATH"
        eval "$(fnm env)"
        fnm install 22 && fnm use 22 && AUTO_INSTALLED=true
      fi
    fi
  fi

  if $AUTO_INSTALLED; then
    NODE_VERSION=$(node -v | sed "s/v//")
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    echo -e "${GREEN}✅ Node.js upgraded to v${NODE_VERSION}${NC}"
    echo ""
  else
    echo -e "${RED}ERROR: Could not automatically install Node.js >= ${NODE_MIN_VERSION}.${NC}"
    echo ""
    echo "Please install Node.js 22+ manually:"
    echo "  - fnm:  curl -fsSL https://fnm.vercel.app/install | bash"
    echo "  - nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    echo "  - brew: brew install node@22"
    echo "  - Official: https://nodejs.org/"
    exit 1
  fi
fi

# Check npm version
NPM_MIN_VERSION=10

if command -v npm &> /dev/null; then
  NPM_VERSION=$(npm -v)
  NPM_MAJOR=$(echo "$NPM_VERSION" | cut -d. -f1)
  echo -e "npm version: ${GREEN}v${NPM_VERSION}${NC}"

  if [ "$NPM_MAJOR" -lt "$NPM_MIN_VERSION" ]; then
    echo -e "${YELLOW}WARNING: npm v${NPM_MAJOR} detected. npm >= ${NPM_MIN_VERSION} recommended.${NC}"
    echo "You can upgrade npm with: npm install -g npm@latest"
    echo ""
  fi
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

  # Check for pnpm (required for this monorepo)
  if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}pnpm is required but not found.${NC}"
    echo ""
    echo "This project uses pnpm workspaces — npm is not supported."

    # Try to auto-install pnpm via npm or corepack
    if command -v npm &> /dev/null; then
      echo -e "${CYAN}Installing pnpm via npm...${NC}"
      npm install -g pnpm 2>/dev/null || true
    elif command -v corepack &> /dev/null; then
      echo -e "${CYAN}Installing pnpm via corepack...${NC}"
      corepack enable pnpm 2>/dev/null || true
      corepack prepare pnpm@latest --activate 2>/dev/null || true
    fi

    if ! command -v pnpm &> /dev/null; then
      echo -e "${RED}ERROR: Could not install pnpm automatically.${NC}"
      echo "Install it manually: npm install -g pnpm"
      exit 1
    fi
    echo -e "${GREEN}✅ pnpm installed${NC}"
  fi

  echo -e "${CYAN}Installing dependencies with pnpm...${NC}"
  (cd "${REPO_DIR}" && pnpm install)

  # Build
  echo ""
  echo -e "${CYAN}Building coder-agent...${NC}"
  (cd "${REPO_DIR}" && pnpm build)

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
  echo -e "${YELLOW}⚠️  coder command not on PATH yet. Configuring PATH automatically...${NC}"

  # Detect shell
  SHELL_NAME=$(basename "$SHELL" 2>/dev/null || echo "bash")

  # Find the global npm bin directory
  NPM_BIN_DIR=$(npm bin -g 2>/dev/null || echo "")
  if [ -z "$NPM_BIN_DIR" ]; then
    NPM_PREFIX=$(npm config get prefix 2>/dev/null || echo "")
    if [ -n "$NPM_PREFIX" ]; then
      NPM_BIN_DIR="${NPM_PREFIX}/bin"
    fi
  fi

  # Add npm global bin to PATH if not already there
  if [ -n "$NPM_BIN_DIR" ] && ! echo "$PATH" | tr ':' '\n' | grep -qxF "$NPM_BIN_DIR"; then
    case "$SHELL_NAME" in
      zsh)
        RC_FILE="$HOME/.zshrc"
        ;;
      bash)
        if [ -f "$HOME/.bash_profile" ]; then
          RC_FILE="$HOME/.bash_profile"
        else
          RC_FILE="$HOME/.bashrc"
        fi
        ;;
      fish)
        RC_FILE="$HOME/.config/fish/config.fish"
        mkdir -p "$(dirname "$RC_FILE")"
        ;;
      *)
        RC_FILE="$HOME/.profile"
        ;;
    esac

    echo "" >> "$RC_FILE"
    echo "# Added by Coder Agent installer" >> "$RC_FILE"
    echo "export PATH=\"${NPM_BIN_DIR}:\$PATH\"" >> "$RC_FILE"

    # Also export for current session
    export PATH="${NPM_BIN_DIR}:$PATH"

    echo -e "${GREEN}✅ Added ${NPM_BIN_DIR} to PATH in ${RC_FILE}${NC}"
    echo ""
    echo "Run this to apply immediately:"
    echo "  source ${RC_FILE}"

    # Re-verify after PATH update
    if command -v coder &> /dev/null; then
      CODER_VERSION=$(coder --version 2>/dev/null || echo "unknown")
      echo -e "${GREEN}✅ coder command available (${CODER_VERSION})${NC}"
    fi
  fi
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
# 6. Copy default settings.json template
# ---------------------------------------------------------------------------
SETTINGS_FILE="${CODER_DIR}/settings.json"
DEFAULT_SETTINGS="${SCRIPT_DIR}/configs/default-settings.json"

echo ""
if [ ! -f "$SETTINGS_FILE" ]; then
  if [ -f "$DEFAULT_SETTINGS" ]; then
    cp "$DEFAULT_SETTINGS" "$SETTINGS_FILE"
    echo -e "${GREEN}✅ Created ${SETTINGS_FILE} from default template${NC}"
  else
    echo -e "${YELLOW}Default settings template not found at ${DEFAULT_SETTINGS}${NC}"
  fi
else
  echo -e "${GREEN}Existing ${SETTINGS_FILE} found, skipping${NC}"
fi

# ---------------------------------------------------------------------------
# 7. Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Coder Agent installation complete!              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}Quick Start:${NC}"
echo ""
echo "  # Start an interactive session"
echo "  coder"
echo ""
echo "  # Select or configure a model interactively"
echo "  coder --model"
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
echo "  coder --model           — Interactive model selection"
echo "  CODER.md                — Project-specific instructions"
echo ""
echo -e "${YELLOW}Documentation: https://github.com/AgenticMatrix/Coder-Agent${NC}"
