import { describe, expect, it } from 'vitest';
import {
  BaseTool,
  BashTool,
  EditTool,
  GlobTool,
  GrepTool,
  ReadTool,
  RiskLevel,
  WriteTool,
} from '../index.js';

describe('@coder/tools', () => {
  it('should export BashTool', () => {
    expect(BashTool).toBeDefined();
  });

  it('should export ReadTool', () => {
    expect(ReadTool).toBeDefined();
  });

  it('should export WriteTool', () => {
    expect(WriteTool).toBeDefined();
  });

  it('should export EditTool', () => {
    expect(EditTool).toBeDefined();
  });

  it('should export GlobTool', () => {
    expect(GlobTool).toBeDefined();
  });

  it('should export GrepTool', () => {
    expect(GrepTool).toBeDefined();
  });

  it('should export BaseTool', () => {
    expect(BaseTool).toBeDefined();
  });

  it('should export RiskLevel enum', () => {
    expect(RiskLevel).toBeDefined();
    expect(RiskLevel.SAFE).toBe('safe');
    expect(RiskLevel.MUTATION).toBe('mutation');
    expect(RiskLevel.DESTRUCTIVE).toBe('destructive');
  });
});
