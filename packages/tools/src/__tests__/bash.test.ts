import { describe, expect, it } from 'vitest';
import { BashTool } from '../bash.js';
import { RiskLevel } from '@coder/shared';

describe('BashTool', () => {
  const tool = new BashTool();

  describe('ToolDefinition', () => {
    it('should have name "Bash"', () => {
      expect(tool.definition.name).toBe('Bash');
    });

    it('should require "command" and "description" parameters', () => {
      const { inputSchema } = tool.definition;
      expect(inputSchema.required).toContain('command');
      expect(inputSchema.required).toContain('description');
      expect(inputSchema.properties.command.type).toBe('string');
      expect(inputSchema.properties.description.type).toBe('string');
    });

    it('should accept optional "timeout" parameter', () => {
      const { inputSchema } = tool.definition;
      expect(inputSchema.properties.timeout.type).toBe('number');
      expect(inputSchema.required).not.toContain('timeout');
    });

    it('should accept optional "run_in_background" parameter', () => {
      const { inputSchema } = tool.definition;
      expect(inputSchema.properties.run_in_background.type).toBe('boolean');
      expect(inputSchema.required).not.toContain('run_in_background');
    });

    it('should be classified as DESTRUCTIVE risk level', () => {
      expect(tool.definition.riskLevel).toBe(RiskLevel.DESTRUCTIVE);
    });
  });

  describe('validate', () => {
    it('should reject non-object input', () => {
      const result = tool.validate(null);
      expect(result.valid).toBe(false);
    });

    it('should reject empty command', () => {
      const result = tool.validate({ command: '', description: 'test' });
      expect(result.valid).toBe(false);
    });

    it('should reject missing description', () => {
      const result = tool.validate({ command: 'echo hello', description: '' });
      expect(result.valid).toBe(false);
    });

    it('should accept valid input', () => {
      const result = tool.validate({ command: 'echo hello', description: 'test' });
      expect(result.valid).toBe(true);
    });

    it('should reject dangerous commands', () => {
      const result = tool.validate({ command: 'rm -rf /', description: 'delete root' });
      expect(result.valid).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute a simple command and return output', async () => {
      const result = await tool.execute(
        { command: 'echo hello', description: 'test' },
        { cwd: process.cwd() },
      );
      expect(result.stdout).toContain('hello');
      expect(result.exitCode).toBe(0);
    });

    it('should capture stderr', async () => {
      const result = await tool.execute(
        { command: 'echo error >&2', description: 'test stderr' },
        { cwd: process.cwd() },
      );
      expect(result.stderr).toContain('error');
    });

    it('should report non-zero exit codes', async () => {
      const result = await tool.execute(
        { command: 'exit 42', description: 'test exit code' },
        { cwd: process.cwd() },
      );
      expect(result.exitCode).toBe(42);
    });

    it('should handle command not found', async () => {
      const result = await tool.execute(
        { command: 'nonexistent_command_xyz_123', description: 'test missing' },
        { cwd: process.cwd() },
      );
      expect(result.exitCode).not.toBe(0);
    });

    it('should track execution duration', async () => {
      const result = await tool.execute(
        { command: 'echo quick', description: 'test duration' },
        { cwd: process.cwd() },
      );
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('formatOutput', () => {
    it('should return stdout content', () => {
      const output = tool.formatOutput({
        stdout: 'hello world',
        stderr: '',
        exitCode: 0,
        killed: false,
        timedOut: false,
        truncated: false,
        durationMs: 10,
      });
      expect(output).toContain('hello world');
    });

    it('should include stderr when present', () => {
      const output = tool.formatOutput({
        stdout: '',
        stderr: 'something went wrong',
        exitCode: 1,
        killed: false,
        timedOut: false,
        truncated: false,
        durationMs: 10,
      });
      expect(output).toContain('[stderr]');
      expect(output).toContain('something went wrong');
    });

    it('should show exit code for non-zero', () => {
      const output = tool.formatOutput({
        stdout: '',
        stderr: '',
        exitCode: 127,
        killed: false,
        timedOut: false,
        truncated: false,
        durationMs: 10,
      });
      expect(output).toContain('[exit code: 127]');
    });

    it('should show timed out message', () => {
      const output = tool.formatOutput({
        stdout: '',
        stderr: '',
        exitCode: null,
        killed: true,
        timedOut: true,
        truncated: false,
        durationMs: 120000,
      });
      expect(output).toContain('[timed out]');
    });

    it('should show truncated message', () => {
      const output = tool.formatOutput({
        stdout: 'a'.repeat(5000),
        stderr: '',
        exitCode: 0,
        killed: false,
        timedOut: false,
        truncated: true,
        durationMs: 10,
      });
      expect(output).toContain('[output truncated');
    });

    it('should return placeholder for empty output', () => {
      const output = tool.formatOutput({
        stdout: '',
        stderr: '',
        exitCode: 0,
        killed: false,
        timedOut: false,
        truncated: false,
        durationMs: 10,
      });
      expect(output).toBe('(no output)');
    });
  });
});
