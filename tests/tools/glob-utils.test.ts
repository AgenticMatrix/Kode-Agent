import { describe, expect, it } from 'vitest';
import { matchGlob } from '../../src/tools/shared/glob-utils.js';

describe('matchGlob', () => {
  it('should match exact filename', () => {
    expect(matchGlob('file.ts', 'file.ts')).toBe(true);
  });

  it('should not match different filename', () => {
    expect(matchGlob('file.ts', 'other.ts')).toBe(false);
  });

  it('should match * wildcard', () => {
    expect(matchGlob('*.ts', 'hello.ts')).toBe(true);
    expect(matchGlob('*.ts', 'hello.js')).toBe(false);
  });

  it('should match ** for any depth', () => {
    expect(matchGlob('src/**/*.ts', 'src/a/b/c/file.ts')).toBe(true);
    expect(matchGlob('src/**/*.ts', 'other/file.ts')).toBe(false);
  });

  it('should match ? for single character', () => {
    expect(matchGlob('file-?.ts', 'file-a.ts')).toBe(true);
    expect(matchGlob('file-?.ts', 'file-ab.ts')).toBe(false);
  });

  it('should escape regex special characters', () => {
    expect(matchGlob('file[0].ts', 'file[0].ts')).toBe(true);
    expect(matchGlob('file[0].ts', 'file0.ts')).toBe(false);
    expect(matchGlob('file.ts', 'fileXts')).toBe(false);
  });

  it('should match paths with directories', () => {
    expect(matchGlob('src/components/*.tsx', 'src/components/App.tsx')).toBe(true);
    expect(matchGlob('src/components/*.tsx', 'src/other/App.tsx')).toBe(false);
  });
});
