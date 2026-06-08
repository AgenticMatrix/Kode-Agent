import type { DeferredPermission } from '@coder/shared';

export interface ActiveToolState {
  id: string;
  name: string;
  startTime: number;
  status: 'started' | 'running' | 'completed';
  inputJson: string;
}

export interface BridgeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalCost: number;
}

export interface PendingApproval {
  toolUseId: string;
  toolName: string;
  command: string;
  description: string;
  deferred: DeferredPermission;
}

export interface BridgeState {
  sessionId: string;
  accumulatedText: string;
  activeTools: Map<string, ActiveToolState>;
  totalCost: number;
  usage: BridgeUsage;
  toolResults: Map<string, string>;
  pendingApprovals: PendingApproval[];
  model: string;
  turnCount: number;
  currentTurnToolCount: number;
  inThinkingBlock: boolean;
  thinkingBlockIndex: number | null;
  hasTextStarted: boolean;
  toolBlockIndexToId: Map<number, string>;
}

export function createBridgeState(sessionId: string): BridgeState {
  return {
    sessionId,
    accumulatedText: '',
    activeTools: new Map(),
    totalCost: 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalCost: 0,
    },
    toolResults: new Map(),
    pendingApprovals: [],
    model: '',
    turnCount: 0,
    currentTurnToolCount: 0,
    inThinkingBlock: false,
    thinkingBlockIndex: null,
    hasTextStarted: false,
    toolBlockIndexToId: new Map(),
  };
}

export function resetTurnState(state: BridgeState): void {
  state.accumulatedText = '';
  state.activeTools.clear();
  state.currentTurnToolCount = 0;
  state.pendingApprovals = [];
  state.inThinkingBlock = false;
  state.thinkingBlockIndex = null;
  state.hasTextStarted = false;
  state.toolBlockIndexToId.clear();
  state.usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalCost: 0,
  };
}
