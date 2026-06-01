import { describe, expect, it } from 'vitest';
import {
  applySearchReplace,
  diffLines,
  diffText,
  unifiedDiff,
} from '../../utils/diff.js';
import type { DiffEdit } from '../../utils/diff.js';

describe('diff', () => {
  describe('diffLines', () => {
    it('should return empty edits for identical arrays', () => {
      const lines = ['a', 'b', 'c'];
      const result = diffLines(lines, lines);
      expect(result.changeCount).toBe(0);
      expect(result.edits.every((e) => e.type === 'equal')).toBe(true);
    });

    it('should detect a single line change', () => {
      const oldLines = ['line1', 'line2', 'line3'];
      const newLines = ['line1', 'line2-modified', 'line3'];
      const result = diffLines(oldLines, newLines);
      expect(result.changeCount).toBe(2); // 1 delete + 1 insert
    });

    it('should handle empty old array (all inserts)', () => {
      const result = diffLines([], ['a', 'b', 'c']);
      expect(result.changeCount).toBe(3);
      expect(result.edits.every((e) => e.type === 'insert')).toBe(true);
    });

    it('should handle empty new array (all deletes)', () => {
      const result = diffLines(['a', 'b', 'c'], []);
      expect(result.changeCount).toBe(3);
      expect(result.edits.every((e) => e.type === 'delete')).toBe(true);
    });

    it('should handle both empty arrays', () => {
      const result = diffLines([], []);
      expect(result.changeCount).toBe(0);
      expect(result.edits).toHaveLength(0);
    });

    it('should detect added lines', () => {
      const oldLines = ['line1', 'line2'];
      const newLines = ['line1', 'inserted', 'line2'];
      const result = diffLines(oldLines, newLines);

      const inserts = result.edits.filter((e: DiffEdit) => e.type === 'insert');
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.value).toBe('inserted');
    });

    it('should detect removed lines', () => {
      const oldLines = ['line1', 'removed', 'line2'];
      const newLines = ['line1', 'line2'];
      const result = diffLines(oldLines, newLines);

      const deletes = result.edits.filter((e: DiffEdit) => e.type === 'delete');
      expect(deletes).toHaveLength(1);
      expect(deletes[0]?.value).toBe('removed');
    });

    it('should handle completely different arrays', () => {
      const oldLines = ['a', 'b', 'c'];
      const newLines = ['x', 'y', 'z'];
      const result = diffLines(oldLines, newLines);
      expect(result.changeCount).toBeGreaterThan(0);
    });

    it('should produce consistent edit sequence', () => {
      const oldLines = ['keep', 'old', 'keep2'];
      const newLines = ['keep', 'new', 'keep2'];
      const result = diffLines(oldLines, newLines);

      // Should find: equal('keep'), delete('old'), insert('new'), equal('keep2')
      const types = result.edits.map((e: DiffEdit) => e.type);
      expect(types).toContain('equal');
      expect(types).toContain('delete');
      expect(types).toContain('insert');
    });

    it('should handle large arrays', () => {
      const size = 500;
      const oldLines = Array.from({ length: size }, (_, i) => `line${i}`);
      const newLines = [...oldLines];
      newLines[250] = 'modified-line';

      const result = diffLines(oldLines, newLines);
      expect(result.changeCount).toBe(2); // 1 delete + 1 insert
    });

    it('should return correct indices in edits', () => {
      const oldLines = ['a', 'b', 'c'];
      const newLines = ['a', 'c'];
      const result = diffLines(oldLines, newLines);

      // Should be: equal(a), delete(b), equal(c)
      expect(result.edits).toHaveLength(3);
      expect(result.edits[0]?.type).toBe('equal');
      expect(result.edits[1]?.type).toBe('delete');
      expect(result.edits[2]?.type).toBe('equal');
    });
  });

  describe('diffText', () => {
    it('should split text by lines and diff', () => {
      const oldText = 'line1\nline2\nline3';
      const newText = 'line1\nline2-changed\nline3';
      const result = diffText(oldText, newText);
      expect(result.changeCount).toBeGreaterThan(0);
    });

    it('should return no changes for identical text', () => {
      const text = 'a\nb\nc';
      const result = diffText(text, text);
      expect(result.changeCount).toBe(0);
    });
  });

  describe('unifiedDiff', () => {
    it('should return empty string for identical text', () => {
      const text = 'line1\nline2';
      expect(unifiedDiff(text, text)).toBe('');
    });

    it('should produce unified diff format', () => {
      const oldText = 'line1\nline2\nline3';
      const newText = 'line1\nline2-modified\nline3';
      const result = unifiedDiff(oldText, newText);

      expect(result).toContain('--- a');
      expect(result).toContain('+++ b');
      expect(result).toContain('@@');
    });

    it('should mark deletions with minus', () => {
      const oldText = 'line1\nremoved\nline2';
      const newText = 'line1\nline2';
      const result = unifiedDiff(oldText, newText);

      expect(result).toContain('-removed');
    });

    it('should mark additions with plus', () => {
      const oldText = 'line1\nline2';
      const newText = 'line1\nadded\nline2';
      const result = unifiedDiff(oldText, newText);

      expect(result).toContain('+added');
    });

    it('should accept custom labels', () => {
      const oldText = 'line1\nline2';
      const newText = 'line1\nline3';
      const result = unifiedDiff(oldText, newText, '--- old.txt', '+++ new.txt');

      expect(result).toContain('--- old.txt');
      expect(result).toContain('+++ new.txt');
    });
  });

  describe('applySearchReplace', () => {
    it('should replace first occurrence of search string', () => {
      const result = applySearchReplace('hello world', 'world', 'there');
      expect(result).toBe('hello there');
    });

    it('should return null when search string not found', () => {
      const result = applySearchReplace('hello world', 'xyz', 'abc');
      expect(result).toBeNull();
    });

    it('should handle empty replace', () => {
      const result = applySearchReplace('hello world', ' world', '');
      expect(result).toBe('hello');
    });

    it('should replace only first occurrence', () => {
      const result = applySearchReplace('a a a', 'a', 'b');
      expect(result).toBe('b a a');
    });

    it('should handle special regex characters as literals', () => {
      const result = applySearchReplace('hello (world)', '(world)', 'there');
      expect(result).toBe('hello there');
    });

    it('should handle empty search string', () => {
      // indexOf('') returns 0, so it prepends
      const result = applySearchReplace('hello', '', 'prefix');
      expect(result).toBe('prefixhello');
    });

    it('should handle multiline text', () => {
      const text = 'line1\nline2\nline3';
      const result = applySearchReplace(text, 'line2', 'replaced');
      expect(result).toBe('line1\nreplaced\nline3');
    });

    it('should return null for empty input text', () => {
      const result = applySearchReplace('', 'search', 'replace');
      expect(result).toBeNull();
    });
  });
});
