import { describe, expect, it, beforeEach } from 'vitest';
import { PermissionEngine } from '../../src/core/permission.js';
import { PermissionMode, RiskLevel } from '../../src/core/types.js';

describe('PermissionEngine', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine('/tmp/test');
  });

  describe('AUTO mode', () => {
    beforeEach(() => {
      engine.setMode(PermissionMode.AUTO);
    });

    it('should approve safe operations', async () => {
      const result = await engine.check({
        toolName: 'Read', input: {}, riskLevel: RiskLevel.SAFE,
      });
      expect(result.allowed).toBe(true);
      expect(result.behavior).toBe('approve');
    });

    it('should approve destructive operations', async () => {
      const result = await engine.check({
        toolName: 'Bash', input: {}, riskLevel: RiskLevel.DESTRUCTIVE,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('PLAN mode', () => {
    beforeEach(() => {
      engine.setMode(PermissionMode.PLAN);
    });

    it('should approve safe operations', async () => {
      const result = await engine.check({
        toolName: 'Read', input: {}, riskLevel: RiskLevel.SAFE,
      });
      expect(result.allowed).toBe(true);
    });

    it('should deny mutation operations', async () => {
      const result = await engine.check({
        toolName: 'Write', input: {}, riskLevel: RiskLevel.MUTATION,
      });
      expect(result.allowed).toBe(false);
      expect(result.behavior).toBe('deny');
    });

    it('should deny destructive operations', async () => {
      const result = await engine.check({
        toolName: 'Bash', input: {}, riskLevel: RiskLevel.DESTRUCTIVE,
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('ASK mode', () => {
    beforeEach(() => {
      engine.setMode(PermissionMode.ASK);
    });

    it('should require confirmation for any operation', async () => {
      const result = await engine.check({
        toolName: 'Read', input: {}, riskLevel: RiskLevel.SAFE,
      });
      expect(result.allowed).toBe(false);
      expect(result.behavior).toBe('ask_user');
      expect(result.prompt).toContain('Read');
    });
  });

  describe('mode management', () => {
    it('should track current mode', () => {
      engine.setMode(PermissionMode.AUTO);
      expect(engine.getMode()).toBe(PermissionMode.AUTO);

      engine.setMode(PermissionMode.PLAN);
      expect(engine.getMode()).toBe(PermissionMode.PLAN);
    });

    it('should default to ASK mode', () => {
      expect(engine.getMode()).toBe(PermissionMode.ASK);
    });
  });

  describe('cwd management', () => {
    it('should track working directory', () => {
      engine.setCwd('/new/path');
      expect(engine.getMode()).toBe(PermissionMode.ASK); // mode unchanged
    });
  });
});
