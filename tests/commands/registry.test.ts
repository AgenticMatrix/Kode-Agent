import { describe, expect, it } from 'vitest';
import { findSlashCommand, listCommandNames, SLASH_COMMANDS } from '../../src/commands/registry.js';

describe('findSlashCommand', () => {
  it('should find a command by name', () => {
    const cmd = findSlashCommand('help');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('help');
  });

  it('should find a command by alias', () => {
    const cmd = findSlashCommand('h');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('help');
  });

  it('should be case-insensitive', () => {
    const cmd = findSlashCommand('HELP');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('help');
  });

  it('should find /agent by alias subagent', () => {
    const cmd = findSlashCommand('subagent');
    expect(cmd).toBeDefined();
    expect(cmd!.name).toBe('agent');
  });

  it('should return undefined for unknown command', () => {
    expect(findSlashCommand('nonexistent')).toBeUndefined();
  });
});

describe('listCommandNames', () => {
  it('should return unique sorted names', () => {
    const names = listCommandNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual([...names].sort());
    // No duplicates
    expect(new Set(names).size).toBe(names.length);
  });

  it('should include core commands', () => {
    const names = listCommandNames();
    expect(names).toContain('help');
    expect(names).toContain('quit');
    expect(names).toContain('agent');
  });
});

describe('SLASH_COMMANDS', () => {
  it('should have unique names', () => {
    const names = SLASH_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should all have help text', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.help).toBeTruthy();
      expect(typeof cmd.help).toBe('string');
    }
  });

  it('should all have run functions', () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(typeof cmd.run).toBe('function');
    }
  });
});
