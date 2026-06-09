/**
 * File-system glob matching utilities used by the glob and grep tools.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Simple glob matching for `**` and `*` wildcards. */
export function matchGlob(pattern: string, filePath: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<DOUBLESTAR>>>/g, '.*')
    .replace(/\?/g, '[^/]');
  const re = new RegExp('^' + escaped + '$');
  return re.test(filePath);
}

export function walkDir(dir: string, pattern: string, baseDir: string, results: string[]) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // Skip inaccessible directories
  }

  for (const name of entries) {
    if (name.startsWith('.')) continue; // Skip hidden

    const fullPath = join(dir, name);
    const relPath = relative(baseDir, fullPath);

    let isDir: boolean;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }

    if (isDir) {
      if (pattern.includes('**') || !relPath.includes('/')) {
        walkDir(fullPath, pattern, baseDir, results);
      }
    } else {
      if (matchGlob(pattern, relPath)) {
        results.push(relPath);
      }
    }
  }
}
