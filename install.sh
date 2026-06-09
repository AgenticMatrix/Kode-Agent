#!/bin/bash
# install.sh — One-click installer for CoderAgent
#
# Usage:
#   # Remote install (from GitHub)
#   curl -fsSL https://raw.githubusercontent.com/AgenticMatrix/CoderAgent/main/install.sh | bash
#
#   # Local development install (run from repo root)
#   ./install.sh --local
#   ./install.sh --dev
#
# This script:
#   1. Checks Node.js >= 22
#   2. Installs coder (npm registry or local link)
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
echo "║       CoderAgent — One-Click Installer           ║"
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
  echo "CoderAgent requires Node.js >= ${NODE_MIN_VERSION}."
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
  echo -e "${YELLOW}Node.js v${NODE_MAJOR} detected. CoderAgent requires >= ${NODE_MIN_VERSION}.${NC}"
  echo ""

  AUTO_INSTALLED=false

  if ! $AUTO_INSTALLED && command -v fnm &> /dev/null; then
    echo -e "${CYAN}fnm detected. Installing Node.js 22...${NC}"
    fnm install 22 && fnm use 22 && AUTO_INSTALLED=true
  fi

  if ! $AUTO_INSTALLED && [ -s "$HOME/.nvm/nvm.sh" ]; then
    echo -e "${CYAN}nvm detected. Installing Node.js 22...${NC}"
    . "$HOME/.nvm/nvm.sh" && nvm install 22 && nvm use 22 && AUTO_INSTALLED=true
  fi

  if ! $AUTO_INSTALLED; then
    echo -e "${CYAN}No Node.js version manager found. Attempting to install fnm...${NC}"
    if command -v curl &> /dev/null; then
      curl -fsSL https://fnm.vercel.app/install | bash
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
    echo -e "${GREEN}Node.js upgraded to v${NODE_VERSION}${NC}"
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
  fi
fi

# ---------------------------------------------------------------------------
# 2. Auto-detect local dev install
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "${SCRIPT_DIR}/package.json" ] && grep -q '"coder-agent"' "${SCRIPT_DIR}/package.json" 2>/dev/null; then
  LOCAL_INSTALL=true
  REPO_DIR="${SCRIPT_DIR}"
fi

# ---------------------------------------------------------------------------
# 3. Clean up stale coder command from KodeAgent
# ---------------------------------------------------------------------------
echo ""

# Remove stale shell alias for coder (from KodeAgent)
if alias coder &>/dev/null 2>&1; then
  echo -e "${YELLOW}Found stale 'coder' alias (from KodeAgent). Removing...${NC}"
  unalias coder 2>/dev/null || true

  # Clean up the alias from shell rc files
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.config/fish/config.fish"; do
    if [ -f "$rc" ]; then
      # Remove lines containing the KodeAgent coder alias
      if grep -q "alias coder=" "$rc" 2>/dev/null; then
        echo -e "${YELLOW}Removing 'alias coder=' from ${rc}${NC}"

        if [[ "$OSTYPE" == "darwin"* ]]; then
          sed -i '' '/alias coder=/d' "$rc"
        else
          sed -i '/alias coder=/d' "$rc"
        fi
      fi
    fi
  done
fi

# Remove stale global npm coder link from @coder/cli (KodeAgent)
NPM_PREFIX=$(npm config get prefix 2>/dev/null || echo "")
if [ -n "$NPM_PREFIX" ]; then
  STALE_CODER="${NPM_PREFIX}/bin/coder"
  if [ -L "$STALE_CODER" ] && readlink "$STALE_CODER" 2>/dev/null | grep -q "@coder/cli"; then
    echo -e "${YELLOW}Found stale 'coder' link from @coder/cli (KodeAgent). Removing...${NC}"
    rm -f "$STALE_CODER"
    npm uninstall -g @coder/cli 2>/dev/null || true
  fi
fi

# ---------------------------------------------------------------------------
# 4. Install coder
# ---------------------------------------------------------------------------
echo ""

if $LOCAL_INSTALL; then
  echo -e "${CYAN}Local development install detected.${NC}"

  if [ -z "${REPO_DIR:-}" ]; then
    echo -e "${RED}ERROR: --local flag used but not inside coder repo.${NC}"
    echo "Run this script from the repo root:"
    echo "  git clone https://github.com/AgenticMatrix/CoderAgent.git"
    echo "  cd CoderAgent && ./install.sh --local"
    exit 1
  fi

  echo -e "Repo directory: ${GREEN}${REPO_DIR}${NC}"
  echo ""

  echo -e "${CYAN}Installing dependencies with npm...${NC}"
  (cd "${REPO_DIR}" && npm install)

  echo ""
  echo -e "${CYAN}Building coder...${NC}"
  (cd "${REPO_DIR}" && npm run build)

  echo ""
  echo -e "${CYAN}Linking coder command globally...${NC}"
  (cd "${REPO_DIR}" && npm link --force 2>/dev/null || npm link 2>/dev/null || true)

  echo -e "${GREEN}coder built and linked locally${NC}"

else
  echo -e "${CYAN}Installing coder from npm registry...${NC}"
  if npm install -g coder 2>&1; then
    echo -e "${GREEN}coder installed from npm${NC}"
  else
    echo -e "${YELLOW}npm registry install failed (package may not be published yet).${NC}"
    echo ""
    echo "To install from source:"
    echo "  git clone https://github.com/AgenticMatrix/CoderAgent.git"
    echo "  cd CoderAgent && ./install.sh --local"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 5. Verify installation
# ---------------------------------------------------------------------------
echo ""
echo -e "${CYAN}Verifying installation...${NC}"

if command -v coder &> /dev/null; then
  CODER_VERSION=$(coder --version 2>/dev/null || echo "0.1.0")
  echo -e "${GREEN}coder command available (${CODER_VERSION})${NC}"
else
  echo -e "${YELLOW}coder command not on PATH yet. Configuring PATH automatically...${NC}"

  SHELL_NAME=$(basename "$SHELL" 2>/dev/null || echo "bash")

  NPM_BIN_DIR=$(npm bin -g 2>/dev/null || echo "")
  if [ -z "$NPM_BIN_DIR" ]; then
    NPM_PREFIX=$(npm config get prefix 2>/dev/null || echo "")
    if [ -n "$NPM_PREFIX" ]; then
      NPM_BIN_DIR="${NPM_PREFIX}/bin"
    fi
  fi

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
    echo "# Added by CoderAgent installer" >> "$RC_FILE"
    echo "export PATH=\"${NPM_BIN_DIR}:\$PATH\"" >> "$RC_FILE"

    export PATH="${NPM_BIN_DIR}:$PATH"

    echo -e "${GREEN}Added ${NPM_BIN_DIR} to PATH in ${RC_FILE}${NC}"
    echo ""
    echo "Run this to apply immediately:"
    echo "  source ${RC_FILE}"

    if command -v coder &> /dev/null; then
      CODER_VERSION=$(coder --version 2>/dev/null || echo "0.1.0")
      echo -e "${GREEN}coder command available (${CODER_VERSION})${NC}"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 6. Create configuration directory
# ---------------------------------------------------------------------------
CODER_DIR="${HOME}/.coder"

echo ""
echo -e "${CYAN}Setting up configuration...${NC}"

mkdir -p "${CODER_DIR}"
mkdir -p "${CODER_DIR}/sessions"
mkdir -p "${CODER_DIR}/skills"
mkdir -p "${CODER_DIR}/scratchpad"

echo -e "${GREEN}Configuration directory created at ${CODER_DIR}${NC}"

# ---------------------------------------------------------------------------
# 7. Create default settings.json
# ---------------------------------------------------------------------------
SETTINGS_FILE="${CODER_DIR}/settings.json"

echo ""
if [ ! -f "$SETTINGS_FILE" ]; then
  cat > "$SETTINGS_FILE" << 'SETTINGS_EOF'
{
  "model_list": [
    {
      "model": ["deepseek-v4-pro"],
      "provider": "deepseek",
      "base_url": "https://api.deepseek.com/anthropic",
      "auth_token_env": "sk-your-api-key-here",
      "max_tokens": 32768
    }
  ],
  "default_model": "deepseek/deepseek-v4-pro"
}
SETTINGS_EOF
  echo -e "${GREEN}Created ${SETTINGS_FILE} with default template${NC}"
  echo ""
  echo -e "${YELLOW}Edit ${SETTINGS_FILE} to configure your API key and model:${NC}"
  echo -e "  - Replace auth_token_env with your API key"
  echo -e "  - Change base_url to your provider's endpoint"
  echo -e "  - Adjust model list and default_model as needed"
else
  echo -e "${GREEN}Existing ${SETTINGS_FILE} found, skipping${NC}"
fi

# ---------------------------------------------------------------------------
# 8. Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  CoderAgent installation complete!               ║${NC}"
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
echo -e "${CYAN}Configuration:${NC}"
echo "  ~/.coder/               — Configuration directory"
echo "  ~/.coder/settings.json  — Provider & model settings"
echo "  CODERAGENT.md           — Project-specific instructions"
echo ""
echo -e "${YELLOW}Documentation: https://github.com/AgenticMatrix/CoderAgent${NC}"
