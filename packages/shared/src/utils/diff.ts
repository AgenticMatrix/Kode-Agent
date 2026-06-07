/**
 * Myers diff algorithm implementation.
 * Used for precise file editing (search & replace) and diff display.
 */

export interface DiffEdit {
  type: 'equal' | 'insert' | 'delete';
  oldIndex: number;
  newIndex: number;
  value?: string;
}

export interface DiffResult {
  edits: DiffEdit[];
  changeCount: number;
}

export function diffLines(oldLines: string[], newLines: string[]): DiffResult {
  const edits: DiffEdit[] = [];

  if (oldLines.length === 0) {
    for (let i = 0; i < newLines.length; i++) {
      edits.push({ type: 'insert', oldIndex: 0, newIndex: i, value: newLines[i] });
    }
    return { edits, changeCount: newLines.length };
  }

  if (newLines.length === 0) {
    for (let i = 0; i < oldLines.length; i++) {
      edits.push({ type: 'delete', oldIndex: i, newIndex: 0, value: oldLines[i] });
    }
    return { edits, changeCount: oldLines.length };
  }

  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0);
      }
    }
  }

  const lcsIndices: Array<[number, number]> = [];
  let i = m;
  let j = n;

  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      lcsIndices.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if ((dp[i - 1]![j] ?? 0) >= (dp[i]![j - 1] ?? 0)) {
      i--;
    } else {
      j--;
    }
  }

  let oldIdx = 0;
  let newIdx = 0;
  let changeCount = 0;

  for (const [lcsOld, lcsNew] of lcsIndices) {
    while (oldIdx < lcsOld) {
      edits.push({ type: 'delete', oldIndex: oldIdx, newIndex: newIdx, value: oldLines[oldIdx] });
      oldIdx++;
      changeCount++;
    }
    while (newIdx < lcsNew) {
      edits.push({ type: 'insert', oldIndex: oldIdx, newIndex: newIdx, value: newLines[newIdx] });
      newIdx++;
      changeCount++;
    }
    edits.push({ type: 'equal', oldIndex: oldIdx, newIndex: newIdx, value: oldLines[oldIdx] });
    oldIdx++;
    newIdx++;
  }

  while (oldIdx < m) {
    edits.push({ type: 'delete', oldIndex: oldIdx, newIndex: newIdx, value: oldLines[oldIdx] });
    oldIdx++;
    changeCount++;
  }

  while (newIdx < n) {
    edits.push({ type: 'insert', oldIndex: oldIdx, newIndex: newIdx, value: newLines[newIdx] });
    newIdx++;
    changeCount++;
  }

  return { edits, changeCount };
}

export function diffText(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  return diffLines(oldLines, newLines);
}

export function unifiedDiff(
  oldText: string,
  newText: string,
  oldLabel = '--- a',
  newLabel = '+++ b',
  contextLines = 3,
): string {
  const result = diffText(oldText, newText);
  if (result.changeCount === 0) return '';
  const { edits } = result;

  const lines: string[] = [];
  lines.push(oldLabel);
  lines.push(newLabel);

  let i = 0;
  while (i < edits.length) {
    let hunkStart = i;
    while (hunkStart > 0 && edits[hunkStart - 1]?.type === 'equal') {
      hunkStart--;
    }

    const hunkLines: string[] = [];
    let oldLine = edits[hunkStart]?.oldIndex ?? 0;
    let newLine = edits[hunkStart]?.newIndex ?? 0;
    let contextCount = 0;
    let hasChanges = false;

    let hunkIdx = hunkStart;
    while (hunkIdx < edits.length) {
      const edit = edits[hunkIdx]!;
      if (edit.type === 'equal') {
        contextCount++;
        hunkLines.push(` ${edit.value}`);
        oldLine++;
        newLine++;
        if (contextCount > contextLines * 2 && !hasChanges) break;
      } else {
        hasChanges = true;
        contextCount = 0;
        if (edit.type === 'delete') {
          hunkLines.push(`-${edit.value}`);
          oldLine++;
        } else if (edit.type === 'insert') {
          hunkLines.push(`+${edit.value}`);
          newLine++;
        }
      }
      hunkIdx++;
      i = hunkIdx;
    }

    if (hasChanges && hunkLines.length > 0) {
      const oldStart = edits[hunkStart]?.oldIndex ?? 0;
      const newStart = edits[hunkStart]?.newIndex ?? 0;
      lines.push(`@@ -${oldStart + 1},${oldLine - oldStart} +${newStart + 1},${newLine - newStart} @@`);
      lines.push(...hunkLines);
    }
  }

  return lines.join('\n');
}

export function applySearchReplace(
  text: string,
  search: string,
  replace: string,
): string | null {
  const index = text.indexOf(search);
  if (index === -1) return null;
  return text.slice(0, index) + replace + text.slice(index + search.length);
}
