/**
 * Lazy SDK dependency loading — install and import provider SDKs on demand.
 *
 * Checks if SDKs are available and installs them dynamically when needed.
 * This keeps the base package lightweight and avoids version conflicts.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SdkInfo {
  packageName: string;
  version: string;
  installSpec: string;
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

function findNodeModulesRoot(startDir: string): string | null {
  let dir = startDir;
  const root = join(dir, '..', '..', '..');

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

function isPackageInstalled(packageName: string, fromDir: string): boolean {
  const root = findNodeModulesRoot(fromDir);
  if (!root) return false;

  const packagePath = join(root, 'node_modules', packageName);
  return existsSync(packagePath);
}

function installPackage(installSpec: string, fromDir: string): boolean {
  const root = findNodeModulesRoot(fromDir);
  if (!root) return false;

  try {
    execSync(`npm install ${installSpec} --no-save --no-audit --no-fund --silent`, {
      cwd: root,
      stdio: 'pipe',
      timeout: 60_000,
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

  if (isPackageInstalled(sdk.packageName, fromDir)) {
    return sdk;
  }

  if (sdk.requiresConfirmation) {
    console.warn(
      `[provider] SDK "${sdk.installSpec}" is required for ${providerName}. ` +
      `Run: npm install ${sdk.installSpec}`,
    );
    throw new Error(
      `SDK "${sdk.installSpec}" is required but not installed. ` +
      `Please install it manually or grant auto-install permission.`,
    );
  }

  console.warn(`[provider] Installing ${sdk.installSpec} (required for ${providerName})...`);
  const installed = installPackage(sdk.installSpec, fromDir);

  if (!installed) {
    throw new Error(
      `Failed to install ${sdk.installSpec}. Try running: npm install ${sdk.installSpec}`,
    );
  }

  console.warn(`[provider] ${sdk.installSpec} installed successfully.`);
  return sdk;
}

export function isProviderSDKAvailable(
  providerName: string,
  fromDir: string = process.cwd(),
): boolean {
  const sdk = SDK_REGISTRY[providerName];
  if (!sdk) return false;
  return isPackageInstalled(sdk.packageName, fromDir);
}

export function getProviderSdkInfo(providerName: string): SdkInfo | undefined {
  return SDK_REGISTRY[providerName];
}

export function listProviderSDKs(): string[] {
  return Object.keys(SDK_REGISTRY);
}
