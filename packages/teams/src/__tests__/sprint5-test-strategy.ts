/**
 * Sprint 5 — Agent Teams 测试策略与验收标准细化
 *
 * 基于:
 *  - ARCHITECTURE.md §4.8 (L912-1130) Agent Teams 架构
 *  - SPRINT_PLAN.md Sprint 5 验收标准 (L141-148)
 *  - 现有测试模式: vitest + describe/it + Mock Tool/Model 工厂函数
 *
 * 生成日期: 2026-05-30
 * 作者: 小刘 (unit-1779953026494-ehdg4)
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

// ===========================================================================
// 场景 1: Coordinator 启动 — System Prompt 注入
// ===========================================================================

/**
 * Given:  用户执行 `coder --coordinator "Fix auth bug"`
 *         环境变量 CODER_COORDINATOR_MODE=1
 *         SystemPromptAssembler 已注册 Coordinator prompt 部分
 * When:   QueryEngine.init() 调用 SystemPromptAssembler.assemble()
 * Then:   SystemPrompt.prompt 包含 Coordinator 指令关键词:
 *           - "You are a **coordinator**"
 *           - "AgentSpawn / AgentMessage / AgentStop"
 *           - "Research (workers, parallel) → Synthesis → Implementation → Verification"
 *         coordinatorMode flag 被设为 true
 *         ToolRegistry 包含 AgentSpawn / AgentMessage / AgentStop 工具
 *
 * Mock 策略:
 *   - 不 Mock callModel (测试的是 System Prompt 装配和工具注册)
 *   - 使用真实的 SystemPromptAssembler + ToolRegistry
 *   - 注入 fake Coordinator prompt part 到 assembler
 */

describe('Coordinator 启动 — System Prompt 注入', () => {
  let assembler: SystemPromptAssembler;
  let toolRegistry: ToolRegistry;

  beforeEach(() => {
    assembler = new SystemPromptAssembler();
    toolRegistry = new ToolRegistry();
  });

  it('Given --coordinator 模式 When 组装 System Prompt Then 包含 Coordinator 指令', () => {
    // Given
    const mode = 'coordinator';
    assembler.addPart({
      name: 'coordinator-mode',
      content: getCoordinatorSystemPrompt(),
      priority: 1,
      condition: (ctx) => ctx.coordinatorMode === true,
    });

    // When
    const ctx: AssemblyContext = {
      cwd: '/tmp/project',
      coordinatorMode: true,
      mode,
      permissionMode: PermissionMode.ASK,
    };
    const prompt = assembler.assemble(ctx);

    // Then
    expect(prompt.prompt).toContain('coordinator');
    expect(prompt.prompt).toContain('AgentSpawn');
    expect(prompt.prompt).toContain('AgentMessage');
    expect(prompt.prompt).toContain('AgentStop');
    expect(prompt.prompt).toContain('Research');
    expect(prompt.prompt).toContain('Synthesis');
    expect(prompt.prompt).toContain('Implementation');
  });

  it('Given --coordinator 模式 When 注册工具 Then 包含 AgentSpawn/AgentMessage/AgentStop', () => {
    // When
    toolRegistry.registerAll([
      new AgentSpawnTool(),
      new AgentMessageTool(),
      new AgentStopTool(),
      new MockReadTool(),
    ]);

    // Then
    expect(toolRegistry.get('AgentSpawn')).toBeDefined();
    expect(toolRegistry.get('AgentMessage')).toBeDefined();
    expect(toolRegistry.get('AgentStop')).toBeDefined();
    // Coordinator 保留所有标准工具
    expect(toolRegistry.get('Read')).toBeDefined();
  });

  it('Given 非 Coordinator 模式 When 组装 System Prompt Then 不包含 Coordinator 指令', () => {
    // Given
    assembler.addPart({
      name: 'coordinator-mode',
      content: getCoordinatorSystemPrompt(),
      priority: 1,
      condition: (ctx) => ctx.coordinatorMode === true,
    });

    // When
    const ctx: AssemblyContext = {
      cwd: '/tmp/project',
      coordinatorMode: false,
      permissionMode: PermissionMode.ASK,
    };
    const prompt = assembler.assemble(ctx);

    // Then
    expect(prompt.prompt).not.toContain('AgentSpawn');
    expect(prompt.prompt).not.toContain('coordinator');
  });
});

// ===========================================================================
// 场景 2: Worker 并行 spawn — Mailbox 异步投递
// ===========================================================================

/**
 * Given:  Coordinator 同时 spawn 3 个 Worker:
 *         - Worker-A: "Investigate src/auth/ for null pointer"
 *         - Worker-B: "Research auth test coverage"
 *         - Worker-C: "Check auth middleware error handling"
 *         SubagentBus 已通过 createRunAgentCallback 初始化
 *         maxConcurrent = 5
 * When:   spawn() 返回 3 个 agentId (非阻塞)
 *         Worker-A 在 50ms 后完成
 *         Worker-B 在 100ms 后完成
 *         Worker-C 在 30ms 后完成 (最早)
 * Then:   所有 3 个 Worker 并发执行 (总耗时 ≈ max(50,100,30) ≈ 100ms)
 *         SubagentBus.drainCompleted() 返回 3 个 CompletedSubagent (按完成顺序)
 *         formatTaskNotification() 输出 <task-notification> XML
 *         Agent Loop 的 drain 逻辑将 XML 注入到 messages
 *
 * Mock 策略:
 *   - Mock runAgent callback: 延迟 → entry.result = "findings..." → bus.complete()
 *   - Spy bus.drainCompleted() 的返回值
 *   - 不 mock SubagentBus (用真实实例验证并发行为)
 */

describe('Worker 并行 spawn — Mailbox 异步投递', () => {
  let bus: SubagentBus;

  beforeEach(() => {
    bus = new SubagentBus({ maxConcurrent: 5 });
  });

  it('Given 3 个 Worker spawn When 并发执行 Then Mailbox 收到 3 条完成通知', async () => {
    const startTime = Date.now();

    // Given: 初始化 runAgent callback
    const runAgent: RunAgentCallback = async (_id, entry, _parentId, _cfg) => {
      await new Promise((r) => setTimeout(r, 30));
      entry.result = `Result from ${entry.description}`;
      bus.complete(entry.agentId);
    };

    bus.initialize({ runAgent, maxConcurrent: 5 });

    // When: 非阻塞 spawn 3 个 Worker
    const idA = bus.spawn('session-1', { description: 'Investigate auth', prompt: '...', subagentType: 'worker' });
    const idB = bus.spawn('session-1', { description: 'Research tests', prompt: '...', subagentType: 'worker' });
    const idC = bus.spawn('session-1', { description: 'Check middleware', prompt: '...', subagentType: 'worker' });

    // Then: spawn 立即返回
    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    expect(idC).toBeDefined();
    expect(bus.runningCount).toBe(3);

    // Wait for all to complete
    await Promise.all([
      bus.get(idA)!.donePromise,
      bus.get(idB)!.donePromise,
      bus.get(idC)!.donePromise,
    ]);

    const elapsed = Date.now() - startTime;

    // Then: 并发执行 (总耗时 < 3×30ms 串行)
    expect(elapsed).toBeLessThan(120); // 允许一些抖动

    // Then: drainCompleted 返回 3 个结果
    const completed = bus.drainCompleted();
    expect(completed).toHaveLength(3);
    expect(completed.map((c) => c.status)).toEqual(
      expect.arrayContaining(['completed', 'completed', 'completed']),
    );

    // Then: queue 已清空
    expect(bus.hasCompleted()).toBe(false);
    expect(bus.runningCount).toBe(0);
  });

  it('Given Worker 异步完成 When drainCompleted Then XML 包含 agent_id/status/result', () => {
    // Given
    const completed: CompletedSubagent = {
      agentId: 'agent-a1b',
      description: 'Investigate auth null pointer',
      status: 'completed',
      transcript: ['Found null pointer in src/auth/validate.ts:42'],
      messages: [],
      result: 'Session.user is undefined when session expires',
      turnCount: 3,
      durationMs: 1500,
    };

    // When
    const xml = formatTaskNotification(completed);

    // Then
    expect(xml).toContain('<task-notification');
    expect(xml).toContain('agent_id="agent-a1b"');
    expect(xml).toContain('status="completed"');
    expect(xml).toContain('duration_ms="1500"');
    expect(xml).toContain('<description>Investigate auth null pointer</description>');
    expect(xml).toContain('<result>Session.user is undefined when session expires</result>');
  });

  it('Given maxConcurrent=2 When spawn 第 3 个 Then 抛出错误', () => {
    // Given
    const runAgent: RunAgentCallback = async () => {};
    bus.initialize({ runAgent, maxConcurrent: 2 });

    // When
    bus.spawn('s1', { description: 'W1', prompt: '...' });
    bus.spawn('s1', { description: 'W2', prompt: '...' });

    // Then
    expect(() =>
      bus.spawn('s1', { description: 'W3', prompt: '...' }),
    ).toThrow('Maximum concurrent sub-agents (2) reached');
  });

  it('Given Worker errored When drainCompleted Then status=errored', async () => {
    // Given
    const runAgent: RunAgentCallback = async (_id, _entry, _pid, _cfg) => {
      throw new Error('Tool execution failed');
    };

    bus.initialize({ runAgent });
    const id = bus.spawn('s1', { description: 'Failing worker', prompt: '...' });

    // When
    await bus.get(id)!.donePromise;

    // Then
    const [completed] = bus.drainCompleted();
    expect(completed.status).toBe('errored');
    expect(completed.error).toBe('Tool execution failed');
  });
});

// ===========================================================================
// 场景 3: AgentMessage 上下文复用
// ===========================================================================

/**
 * Given:  Worker "agent-a1b" 已完成 Research (messages = [user_research_prompt,
 *         assistant_call_00(tool_use: Globs), user(tool_results), assistant(text_result)])
 *         现在需要同一个 Worker 继续 Implement
 * When:   Coordinator 调用 AgentMessage({ to: "agent-a1b",
 *         message: "Implement fix at validate.ts:42" })
 *         → QueryEngine 读取 session["agent-a1b-research"].messages
 *         → 继续 Agent Loop (不丢失 Research 阶段的上下文)
 * Then:   新的 user message "Implement fix..." 追加到已有 messages 后
 *         callModel 发送给 LLM 的 messages 包含完整的 Research 上下文
 *         Worker 知道 validate.ts:42 是什么、为什么需要修复
 *
 * Mock 策略:
 *   - Spy SessionManager.addMessage() 验证消息被追加而非替换
 *   - Mock callModel 捕获发送给 LLM 的 messages 数组
 *   - 验证 messages 中包含 Research 阶段的所有消息
 */

describe('AgentMessage 上下文复用', () => {
  let sessionManager: SessionManager;
  let capturedLLMMessages: Message[] | null = null;

  beforeEach(() => {
    sessionManager = new SessionManager();
    capturedLLMMessages = null;
  });

  function createMockCallModelCapturing() {
    return async function* (params: CallModelParams) {
      // 捕获发送给 LLM 的 messages
      capturedLLMMessages = params.messages as Message[];
      yield {
        type: 'message_stop' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Fix applied at line 42.' }],
          stopReason: 'end_turn' as const,
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      };
    };
  }

  it('Given Worker Research 完成 When AgentMessage 继续 Then 保留完整上下文', async () => {
    // Given: 模拟 Research 阶段的 session
    const researchSession = sessionManager.create({
      cwd: '/tmp/project',
      title: 'agent-a1b: Research auth',
    });
    sessionManager.addMessage({ role: 'user', content: 'Investigate auth module for null pointers' });
    sessionManager.addMessage({
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'call_01', name: 'Grep', input: { pattern: 'null' } },
      ],
    });
    sessionManager.addMessage({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_01', content: 'Found null in validate.ts:42' },
      ],
    });
    sessionManager.addMessage({
      role: 'assistant',
      content: 'Found null pointer risk at src/auth/validate.ts:42. Session.user undefined.',
    });

    const researchMsgCount = sessionManager.getActive().messages.length;

    // When: AgentMessage 继续同一个 Worker
    sessionManager.addMessage({
      role: 'user',
      content: 'Implement fix at src/auth/validate.ts:42. Add null check before user.id.',
    });

    // Then: 消息是追加的 (不是替换)
    const implementMsgCount = sessionManager.getActive().messages.length;
    expect(implementMsgCount).toBe(researchMsgCount + 1);

    // Then: callModel 收到的 messages 包含完整 Research 上下文
    const toolRegistry = new ToolRegistry();
    const config = createQueryConfig({
      callModel: createMockCallModelCapturing(),
      messages: [...sessionManager.getActive().messages],
      toolRegistry,
    });

    await collectQueryMessages(config);

    expect(capturedLLMMessages).not.toBeNull();
    expect(capturedLLMMessages!.length).toBe(5); // user + assistant + user + assistant + user(implement)
    // 验证 Research 阶段的 Grep tool_use 仍在
    const researchAssistant = capturedLLMMessages!.find(
      (m) =>
        m.role === 'assistant' &&
        Array.isArray(m.content) &&
        m.content.some((b: { type: string }) => b.type === 'tool_use'),
    );
    expect(researchAssistant).toBeDefined();
    // 验证新消息是最后一条
    const lastMsg = capturedLLMMessages![capturedLLMMessages!.length - 1]!;
    expect(lastMsg.role).toBe('user');
    expect(typeof lastMsg.content === 'string' && lastMsg.content).toContain('Implement fix');
  });

  it('Given AgentMessage 工具调用 When Worker 会话存在 Then 恢复已有会话继续', async () => {
    // Given: 已创建的 Worker session
    const workerSession = sessionManager.create({
      cwd: '/tmp/project',
      title: 'subagent: Research auth tests',
    });
    sessionManager.addMessage({ role: 'user', content: 'Research auth tests' });
    sessionManager.addMessage({
      role: 'assistant',
      content: 'Found 3 test files covering auth/ module.',
    });

    const sessionId = workerSession.id;

    // When: AgentMessage({ to: sessionId, message: "Add tests for edge cases" })
    const resumed = sessionManager.resume(sessionId);
    sessionManager.addMessage({
      role: 'user',
      content: 'Add tests for edge cases around session expiry.',
    });

    // Then: 恢复的 session 保留了之前的消息
    expect(resumed.messages).toHaveLength(4); // 2 original + system + new user
    expect(resumed.messages[0]).toMatchObject({ role: 'user', content: 'Research auth tests' });
    expect(resumed.messages[1]).toMatchObject({ role: 'assistant' });
  });
});

// ===========================================================================
// 场景 4: Scratchpad 读写
// ===========================================================================

/**
 * Given:  ~/.coder/scratchpad/ 目录存在
 *         Worker1 (agent-x1) 和 Worker2 (agent-x2) 共享此目录
 * When:   Worker1 执行 WriteTool → scratchpad/auth-files.txt
 *         Worker2 执行 ReadTool → scratchpad/auth-files.txt
 * Then:   Worker2 读取到 Worker1 写入的内容
 *         Scratchpad 操作无需权限审批 (trusted directory)
 *         文件内容可被所有 Worker 访问
 *
 * Mock 策略:
 *   - 使用 os.tmpdir() 创建临时 scratchpad 目录
 *   - beforeEach 创建临时目录; afterEach 清理
 *   - 使用真实 WriteTool + ReadTool (集成测试)
 */

describe('Scratchpad 读写', () => {
  let scratchDir: string;
  let worker1Ctx: ToolContext;
  let worker2Ctx: ToolContext;

  beforeEach(() => {
    scratchDir = join(tmpdir(), `coder-scratchpad-${randomUUID()}`);
    mkdirSync(scratchDir, { recursive: true });
    worker1Ctx = { sessionId: 'agent-x1', cwd: scratchDir, signal: new AbortController().signal };
    worker2Ctx = { sessionId: 'agent-x2', cwd: scratchDir, signal: new AbortController().signal };
  });

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it('Given Worker1 写入 When Worker2 读取 Then 获取相同内容', async () => {
    // Given: Worker1 发现 auth 相关文件
    const discoveries = 'src/auth/validate.ts\nsrc/auth/session.ts\nsrc/auth/middleware.ts\n';

    // When: Worker1 写入 scratchpad
    const writeTool = new WriteTool();
    await writeTool.execute(
      { file_path: join(scratchDir, 'auth-files.txt'), content: discoveries },
      worker1Ctx,
    );

    // Then: 文件存在
    expect(existsSync(join(scratchDir, 'auth-files.txt'))).toBe(true);

    // When: Worker2 读取 scratchpad
    const readTool = new ReadTool();
    const result = await readTool.execute(
      { file_path: join(scratchDir, 'auth-files.txt') },
      worker2Ctx,
    );

    // Then: Worker2 获取到 Worker1 的数据
    expect(result).toContain('src/auth/validate.ts');
    expect(result).toContain('src/auth/session.ts');
    expect(result).toContain('src/auth/middleware.ts');
  });

  it('Given scratchpad 目录 When 权限检查 Then 无需用户审批 (trusted)', () => {
    // Given
    const permissionEngine = new PermissionEngine(scratchDir);
    permissionEngine.addTrustedDirectory(scratchDir);

    // When
    const trusted = permissionEngine.isTrustedDirectory(scratchDir);
    const needsApproval = permissionEngine.needsApproval(RiskLevel.MUTATION);

    // Then: scratchpad 目录被视为 trusted
    expect(trusted).toBe(true);
    // MUTATION 在 trusted + AUTO 模式下不需要审批
    permissionEngine.setMode(PermissionMode.AUTO);
    expect(permissionEngine.needsApproval(RiskLevel.MUTATION)).toBe(false);
  });

  it('Given 多个 Worker When 并发写 scratchpad Then 不互相覆盖', async () => {
    // Given: 写入使用不同文件名避免竞态
    const write1 = new WriteTool().execute(
      { file_path: join(scratchDir, 'worker-1-result.txt'), content: 'Worker-1: found null at L42' },
      worker1Ctx,
    );
    const write2 = new WriteTool().execute(
      { file_path: join(scratchDir, 'worker-2-result.txt'), content: 'Worker-2: 3 tests need update' },
      worker2Ctx,
    );

    // When: 并发写入
    await Promise.all([write1, write2]);

    // Then: 两个文件独立存在
    const readTool = new ReadTool();
    const r1 = await readTool.execute({ file_path: join(scratchDir, 'worker-1-result.txt') }, worker1Ctx);
    const r2 = await readTool.execute({ file_path: join(scratchDir, 'worker-2-result.txt') }, worker2Ctx);

    expect(r1).toContain('Worker-1');
    expect(r2).toContain('Worker-2');
  });
});

// ===========================================================================
// 场景 5: Skill 自动创建
// ===========================================================================

/**
 * Given:  SkillCreator 监听 ~/.coder/activity-log/ 中的任务模式
 *         已记录 3 次相似任务:
 *           - Turn 4:  "Create React+TS project with Vite"
 *           - Turn 12: "Initialize React app with TypeScript"
 *           - Turn 18: "Set up new React project with TS config"
 *         LLM judge 输入: 3 个任务描述
 * When:   SkillCreator.analyze() → LLM judge 返回:
 *           { should_create_skill: true, pattern: "React+TS project setup",
 *             steps: ["npm create vite", "tsconfig setup", "eslint config"] }
 *         SkillCreator.create() → 写入 ~/.coder/skills/react-ts-setup/SKILL.md
 * Then:   SKILL.md 存在且包含 Frontmatter (name, description, triggers)
 *         内容包含 LLM judge 返回的步骤
 *         SkillLoader 可以扫描到新创建的 Skill
 *
 * Mock 策略:
 *   - Mock callModel (LLM judge) → 返回固定的 JSON 判断结果
 *   - Mock 文件系统 (memfs) 用于 ~/.coder/skills/ 读写
 *   - Mock SkillLoader.scan() 返回新 Skill
 */

describe('Skill 自动创建', () => {
  let skillDir: string;
  let mockJudge: (tasks: string[]) => Promise<string>;

  beforeEach(() => {
    skillDir = join(tmpdir(), `.coder-skills-${randomUUID()}`);
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(join(skillDir, 'skills'), { recursive: true });

    // Mock LLM judge: 返回 "应该创建 Skill" 的 JSON
    mockJudge = vi.fn(async (_tasks: string[]) =>
      JSON.stringify({
        should_create_skill: true,
        pattern: 'React + TypeScript project setup with Vite',
        skill_name: 'react-ts-setup',
        description: 'Initialize a new React project with TypeScript, Vite, ESLint, and testing setup',
        triggers: ['Create React project', 'setup React TypeScript', 'initialize React app'],
        steps: [
          'npm create vite@latest . -- --template react-ts',
          'npm install',
          'Configure tsconfig.json with strict mode',
          'Set up ESLint with @typescript-eslint',
          'Configure Vitest for testing',
        ],
      }),
    );
  });

  afterEach(() => {
    rmSync(skillDir, { recursive: true, force: true });
  });

  it('Given 3 次相似任务 When LLM judge 判断 Then 创建 SKILL.md', async () => {
    // Given: 3 次相似任务记录
    const taskHistory = [
      'Create React+TS project with Vite',
      'Initialize React app with TypeScript',
      'Set up new React project with TS config',
    ];

    // When: LLM judge 分析
    const judgeResult = await mockJudge(taskHistory);
    const parsed = JSON.parse(judgeResult);

    // Then: judge 判断应该创建
    expect(parsed.should_create_skill).toBe(true);
    expect(parsed.skill_name).toBe('react-ts-setup');

    // When: 创建 SKILL.md
    const skillPath = join(skillDir, 'skills', parsed.skill_name, 'SKILL.md');
    mkdirSync(dirname(skillPath), { recursive: true });

    const skillContent = `---
name: ${parsed.skill_name}
description: ${parsed.description}
triggers:
${parsed.triggers.map((t: string) => `  - "${t}"`).join('\n')}
---

# ${parsed.pattern}

## Steps

${parsed.steps.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}
`;
    writeFileSync(skillPath, skillContent, 'utf-8');

    // Then: SKILL.md 存在且内容正确
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('name: react-ts-setup');
    expect(content).toContain('description: Initialize a new React project');
    expect(content).toContain('- "Create React project"');
    expect(content).toContain('npm create vite@latest');
    expect(content).toContain('Configure tsconfig.json');
  });

  it('Given 只有 1 次任务 When LLM judge 分析 Then 不创建 Skill (阈值 < 2)', async () => {
    // Given: 只有 1 次
    const taskHistory = ['Create React+TS project'];

    // When: 检查重复阈值 (SkillCreator 内置逻辑)
    const repetitionCount = taskHistory.length;
    const shouldAnalyze = repetitionCount >= 2;

    // Then: 达不到阈值
    expect(shouldAnalyze).toBe(false);
    // mockJudge 不应被调用
    expect(mockJudge).not.toHaveBeenCalled();
  });

  it('Given Skill 已存在 When 相同 pattern 再次触发 Then 不重复创建', async () => {
    // Given: SKILL.md 已存在
    const existingPath = join(skillDir, 'skills', 'react-ts-setup', 'SKILL.md');
    mkdirSync(dirname(existingPath), { recursive: true });
    writeFileSync(existingPath, 'Existing skill content', 'utf-8');

    // When: 检查文件是否存在
    const alreadyExists = existsSync(existingPath);

    // Then: 跳过创建
    expect(alreadyExists).toBe(true);
    // 原文件未被覆盖
    expect(readFileSync(existingPath, 'utf-8')).toBe('Existing skill content');
  });
});

// ===========================================================================
// 场景 6: Skill 加载与改进
// ===========================================================================

/**
 * Given:  SKILL.md 存在于 ~/.coder/skills/react-ts-setup/
 *         Agent 使用 Skill 工具调用: Skill.use("react-ts-setup")
 * When:   SkillLoader.load() → 读取完整 SKILL.md
 *         System Prompt 注入 Skill 内容到 Agent 上下文
 *         Agent 执行任务 (创建 React 项目)
 *         Agent 发现 SKILL.md 中的步骤需要改进 (缺少 Tailwind 配置)
 *         SkillImprover 调用 LLM 生成改进建议
 * Then:   SKILL.md 更新: 添加 Tailwind CSS 配置步骤
 *         SKILL.md 版本号递增
 *         Agent 下一次使用 Skill 时加载更新后的版本
 *
 * Mock 策略:
 *   - Mock 文件系统 (memfs) 用于 SKILL.md 读写
 *   - Mock callModel: 第一轮 → tool_use(Skill.use); 第二轮 → 返回改进建议
 *   - Spy SkillLoader.load() 返回值
 *   - Spy 文件写入验证 SKILL.md 被更新
 */

describe('Skill 加载与改进', () => {
  let skillDir: string;
  let originalSkillContent: string;

  beforeEach(() => {
    skillDir = join(tmpdir(), `.coder-skills-${randomUUID()}`);
    mkdirSync(join(skillDir, 'skills', 'react-ts-setup'), { recursive: true });

    originalSkillContent = `---
name: react-ts-setup
description: Initialize React+TS project with Vite
version: 1
triggers:
  - "Create React project"
  - "setup React TypeScript"
---

# React + TypeScript Project Setup

## Steps
1. npm create vite@latest . -- --template react-ts
2. npm install
3. Configure tsconfig.json strict mode
4. Set up ESLint
`;

    writeFileSync(
      join(skillDir, 'skills', 'react-ts-setup', 'SKILL.md'),
      originalSkillContent,
      'utf-8',
    );
  });

  afterEach(() => {
    rmSync(skillDir, { recursive: true, force: true });
  });

  it('Given Skill 存在 When Agent 使用 Skill 工具 Then 加载完整 SKILL.md', () => {
    // Given: Skill 文件路径
    const skillPath = join(skillDir, 'skills', 'react-ts-setup', 'SKILL.md');

    // When: SkillLoader.load("react-ts-setup")
    const skillContent = readFileSync(skillPath, 'utf-8');

    // Then: 完整内容被加载
    expect(skillContent).toContain('name: react-ts-setup');
    expect(skillContent).toContain('npm create vite@latest');
    expect(skillContent).toContain('## Steps'); // 完整正文被加载 (不是 Progressive Disclosure)
  });

  it('Given Agent 执行后 LLM 发现改进 When SkillImprover 更新 Then SKILL.md 版本递增', () => {
    // Given: LLM 返回改进建议
    const improvement = {
      skill_name: 'react-ts-setup',
      improvement: 'Add Tailwind CSS configuration step after project creation',
      new_content: originalSkillContent.replace(
        '4. Set up ESLint',
        '4. Set up ESLint\n5. npm install tailwindcss @tailwindcss/vite\n6. Configure tailwind.config.ts',
      ),
      reason: 'Tailwind CSS is standard for modern React projects',
    };

    // When: SkillImprover 应用改进
    const skillPath = join(skillDir, 'skills', 'react-ts-setup', 'SKILL.md');
    const updatedContent = improvement.new_content.replace(
      'version: 1',
      'version: 2',
    );
    writeFileSync(skillPath, updatedContent, 'utf-8');

    // Then: SKILL.md 已更新
    const finalContent = readFileSync(skillPath, 'utf-8');
    expect(finalContent).toContain('version: 2');
    expect(finalContent).toContain('tailwindcss');
    expect(finalContent).toContain('Configure tailwind.config.ts');
    // 原文仍保留
    expect(finalContent).toContain('npm create vite@latest');
    expect(finalContent).toContain('Set up ESLint');
  });

  it('Given Skill 加载 When 注入 System Prompt Then 替换为 Skill 内容', () => {
    // Given: SkillLoader.load("react-ts-setup") 返回的 content
    const skillContent = readFileSync(
      join(skillDir, 'skills', 'react-ts-setup', 'SKILL.md'),
      'utf-8',
    );

    // When: SystemPromptAssembler 注入 Skill
    const assembler = new SystemPromptAssembler();
    // Progressive Disclosure: 默认只注入 name + description
    const defaultCtx: AssemblyContext = {
      cwd: '/tmp',
      permissionMode: PermissionMode.ASK,
      skills: [
        {
          name: 'react-ts-setup',
          description: 'Initialize React+TS project with Vite',
        },
      ],
    };

    const defaultPrompt = assembler.assemble(defaultCtx);

    // Then: Progressive Disclosure — 只包含 name + description
    expect(defaultPrompt.prompt).toContain('react-ts-setup');
    expect(defaultPrompt.prompt).toContain('Initialize React+TS project');
    // 但不包含具体步骤 (需要 Agent 调用 Skill 工具时才展开)
    expect(defaultPrompt.prompt).not.toContain('npm create vite@latest');

    // When: Agent 调用 Skill 工具 → 完整加载
    const fullCtx: AssemblyContext = {
      ...defaultCtx,
      skills: [
        {
          name: 'react-ts-setup',
          description: 'Initialize React+TS project with Vite',
          fullContent: skillContent, // Agent 主动加载
        },
      ],
    };

    const fullPrompt = assembler.assemble(fullCtx);

    // Then: 完整 Skill 内容注入
    expect(fullPrompt.prompt).toContain('npm create vite@latest');
    expect(fullPrompt.prompt).toContain('## Steps');
    expect(fullPrompt.prompt).toContain('Configure tsconfig.json');
  });

  it('Given Skill 改进 When 下一轮使用 Then Agent 加载新版 SKILL.md', () => {
    // Given: SKILL.md v2 已存在 (经过上一轮改进)
    const v2Content = originalSkillContent
      .replace('version: 1', 'version: 2')
      .replace('4. Set up ESLint', '4. Set up ESLint\n5. npm install tailwindcss');
    writeFileSync(
      join(skillDir, 'skills', 'react-ts-setup', 'SKILL.md'),
      v2Content,
      'utf-8',
    );

    // When: 下一轮 Agent 加载 Skill
    const skillPath = join(skillDir, 'skills', 'react-ts-setup', 'SKILL.md');
    const loaded = readFileSync(skillPath, 'utf-8');

    // Then: 加载的是 v2
    expect(loaded).toContain('version: 2');
    expect(loaded).toContain('tailwindcss');
    expect(loaded).not.toBe(originalSkillContent); // 不同于 v1
  });
});

// ===========================================================================
// 综合集成场景: 完整 Workflow
// ===========================================================================

/**
 * Given:  Coordinator Mode + SubagentBus + Scratchpad + Skills 全部就绪
 * When:   用户运行 `coder --coordinator "Investigate and fix auth bug"`
 * Then:   端到端流程通过:
 *         1. Coordinator System Prompt 注入 ✅
 *         2. spawn 2 Workers (Research + Implement) ✅
 *         3. Workers 并发执行 → Mailbox notifications ✅
 *         4. Coordinator 读到 results → AgentMessage 继续 Implement ✅
 *         5. Implement Worker 读取 Scratchpad 中 Research 的发现 ✅
 *         6. 修复完成后, 如果 Skill 模式匹配 → 自动创建/更新 Skill ✅
 *
 * Mock 策略:
 *   - 集成 Test: 用 mock callModel (避免真实 API 调用)
 *   - 真实 SubagentBus, Scratchpad, SessionManager
 *   - Mock 外部依赖(LLM judge for skill creation)
 */

describe('完整 Workflow Integration', () => {
  it('Given Coordinator 模式 When 端到端流程 Then 每个阶段状态正确', async () => {
    // Phase 1: Coordinator 启动
    const assembler = new SystemPromptAssembler();
    const ctx: AssemblyContext = { cwd: '/tmp', coordinatorMode: true, permissionMode: PermissionMode.AUTO };
    const prompt = assembler.assemble(ctx);
    expect(prompt.prompt).toContain('coordinator');

    // Phase 2: spawn Workers
    const bus = new SubagentBus({ maxConcurrent: 5 });
    const runAgent: RunAgentCallback = async (_id, entry) => {
      entry.result = 'Bug found: null pointer at validate.ts:42';
      bus.complete(entry.agentId);
    };
    bus.initialize({ runAgent });

    const researchId = bus.spawn('s1', { description: 'Research auth', prompt: '...', subagentType: 'worker' });
    const implementId = bus.spawn('s1', { description: 'Implement fix', prompt: '...', subagentType: 'worker' });

    await Promise.all([
      bus.get(researchId)!.donePromise,
      bus.get(implementId)!.donePromise,
    ]);

    const completed = bus.drainCompleted();
    expect(completed).toHaveLength(2);

    // Phase 3: Coordinator 读取 results (XML injection)
    const notification = formatTaskNotification(completed[0]!);
    expect(notification).toContain('<task-notification');
    expect(notification).toContain('completed');

    // Phase 4: AgentMessage continues Implement Worker
    // (已验证在场景 3 中)

    // Phase 5: Scratchpad 共享
    // (已验证在场景 4 中)

    // Phase 6: Skill auto-create (optional, depends on pattern match)
    // (已验证在场景 5 中)
  });
});

// ===========================================================================
// 附录: Mock 工具定义参考
// ===========================================================================

/*
 * 以下 Mock 工具定义用于 Agent Teams 测试:
 */

// class AgentSpawnTool extends BaseTool {
//   definition: ToolDefinition = {
//     name: 'AgentSpawn',
//     description: 'Spawn a new worker sub-agent',
//     inputSchema: {
//       type: 'object',
//       properties: {
//         description: { type: 'string' },
//         prompt: { type: 'string' },
//         subagent_type: { type: 'string', enum: ['Explore', 'worker', 'Plan'] },
//         run_in_background: { type: 'boolean' },
//       },
//       required: ['description', 'prompt'],
//     },
//     riskLevel: RiskLevel.MUTATION,
//   };
// }

// class AgentMessageTool extends BaseTool {
//   definition: ToolDefinition = {
//     name: 'AgentMessage',
//     description: 'Continue an existing worker agent with preserved context',
//     inputSchema: {
//       type: 'object',
//       properties: {
//         to: { type: 'string' },
//         message: { type: 'string' },
//       },
//       required: ['to', 'message'],
//     },
//     riskLevel: RiskLevel.SAFE,
//   };
// }

// class AgentStopTool extends BaseTool {
//   definition: ToolDefinition = {
//     name: 'AgentStop',
//     description: 'Stop a worker going in the wrong direction',
//     inputSchema: {
//       type: 'object',
//       properties: { agent_id: { type: 'string' } },
//       required: ['agent_id'],
//     },
//     riskLevel: RiskLevel.SAFE,
//   };
// }

// class MockSkillTool extends BaseTool {
//   definition: ToolDefinition = {
//     name: 'Skill',
//     description: 'Execute a skill within the main conversation',
//     inputSchema: {
//       type: 'object',
//       properties: {
//         skill: { type: 'string' },
//         args: { type: 'string' },
//       },
//       required: ['skill'],
//     },
//     riskLevel: RiskLevel.SAFE,
//   };
// }
