/**
 * Lazy SDK dependency loading — install and import provider SDKs on demand.
 *
 * Instead of bundling @anthropic-ai/sdk and openai (heavy dependencies),
 * we check if they're available and install them dynamically when needed.
 * This keeps the base package lightweight and avoids version conflicts.
 *
 * Pattern inspired by Hermes' lazy_deps.py — check, install if missing,
 * then dynamic import.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SdkInfo {
  /** npm package name */
  packageName: string;
  /** Minimum version required */
  version: string;
  /** npm install spec (e.g. "@anthropic-ai/sdk@^0.39.0") */
  installSpec: string;
  /** Whether installation requires confirmation */
  requiresConfirmation: boolean;
}

// ---------------------------------------------------------------------------
// SDK Registry
// ---------------------------------------------------------------------------

const SDK_REGISTRY: Record<string, SdkInfo> = {
  anthropic: {
    packageName: '@anthropic-ai/sdk',
    version: '^0.39.0',
    installSpec: '@anthropic-ai/sdk@^0.39.0',
    requiresConfirmation: false,
  },
  openai: {
    packageName: 'openai',
    version: '^4.0.0',
    installSpec: 'openai@^4.0.0',
    requiresConfirmation: false,
  },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Find node_modules root by walking up from the given directory.
 */
function findNodeModulesRoot(startDir: string): string | null {
  let dir = startDir;
  const root = join(dir, '..', '..', '..'); // sanity limit

  while (dir !== root) {
    const nmPath = join(dir, 'node_modules');
    if (existsSync(nmPath)) {
      return dir;
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Check if a package is already installed and importable.
 */
function isPackageInstalled(packageName: string, fromDir: string): boolean {
  const root = findNodeModulesRoot(fromDir);
  if (!root) return false;

  const packagePath = join(root, 'node_modules', packageName);
  return existsSync(packagePath);
}

/**
 * Install an npm package dynamically.
 *
 * Uses --no-save to avoid modifying package.json.
 * Uses --no-audit --no-fund to keep installation fast.
 *
 * @returns true if installation succeeded
 */
function installPackage(installSpec: string, fromDir: string): boolean {
  const root = findNodeModulesRoot(fromDir);
  if (!root) return false;

  try {
    execSync(`npm install ${installSpec} --no-save --no-audit --no-fund --silent`, {
      cwd: root,
      stdio: 'pipe',
      timeout: 60_000, // 60 second timeout for npm install
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' },
    });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a provider's SDK is available, installing it if necessary.
 *
 * Checks if the SDK package is already installed in node_modules.
 * If not, runs `npm install <package> --no-save` to install it.
 * After ensuring the package exists, the caller can `import()` it.
 *
 * @param providerName — Provider key (e.g. "anthropic", "openai")
 * @param fromDir — Directory to search for node_modules (default: process.cwd())
 * @returns The SdkInfo for the installed package
 * @throws If the SDK cannot be installed or the provider is unknown
 *
 * @example
 * ```typescript
 * await ensureProviderSDK('openai');
 * const { default: OpenAI } = await import('openai');
 * const client = new OpenAI({ apiKey: '...' });
 * ```
 */
export async function ensureProviderSDK(
  providerName: string,
  fromDir: string = process.cwd(),
): Promise<SdkInfo> {
  const sdk = SDK_REGISTRY[providerName];
  if (!sdk) {
    throw new Error(
      `Unknown provider "${providerName}". Available: ${Object.keys(SDK_REGISTRY).join(', ')}`,
    );
  }

  // Already installed — nothing to do
  if (isPackageInstalled(sdk.packageName, fromDir)) {
    return sdk;
  }

  // Install if needed
  if (sdk.requiresConfirmation) {
    // Future: prompt user for confirmation
    console.warn(
      `[kode:provider] SDK "${sdk.installSpec}" is required for ${providerName}. ` +
      `Run: npm install ${sdk.installSpec}`,
    );
    throw new Error(
      `SDK "${sdk.installSpec}" is required but not installed. ` +
      `Please install it manually or grant auto-install permission.`,
    );
  }

  // Auto-install
  console.warn(`[kode:provider] Installing ${sdk.installSpec} (required for ${providerName})...`);
  const installed = installPackage(sdk.installSpec, fromDir);

  if (!installed) {
    throw new Error(
      `Failed to install ${sdk.installSpec}. Try running: npm install ${sdk.installSpec}`,
    );
  }

  console.warn(`[kode:provider] ${sdk.installSpec} installed successfully.`);
  return sdk;
}

/**
 * Check if a provider SDK is available without installing.
 *
 * @returns true if the SDK package exists in node_modules
 */
export function isProviderSDKAvailable(
  providerName: string,
  fromDir: string = process.cwd(),
): boolean {
  const sdk = SDK_REGISTRY[providerName];
  if (!sdk) return false;
  return isPackageInstalled(sdk.packageName, fromDir);
}

/**
 * Get the SDK info for a provider (without checking installation).
 */
export function getProviderSdkInfo(providerName: string): SdkInfo | undefined {
  return SDK_REGISTRY[providerName];
}

/**
 * List all known provider SDKs.
 */
export function listProviderSDKs(): string[] {
  return Object.keys(SDK_REGISTRY);
}
