# Coder Agent 测试策略

> 基于 Hermes Agent 测试实践总结，适用于 Coder Agent monorepo 项目。

---

## 一、Hermes Agent 测试模式分析

### 1.1 测试层次

Hermes Agent（17,000+ 测试）采用四层测试架构：

| 层次 | 范围 | 占比 | 说明 |
|------|------|------|------|
| **单元测试** | 单函数/类 | ~70% | 快速、独立、可并行 |
| **组件测试** | 单个子系统 | ~15% | mock 外部依赖 |
| **集成测试** | 跨模块交互 | ~10% | Docker/真实服务 |
| **E2E 测试** | 完整用户流程 | ~5% | 真实平台交互 |

### 1.2 核心模式

#### 模式 1：Hermetic 环境（`conftest.py`）

每个测试文件运行在彻底的隔离环境中：

```python
# 1. 清除所有凭证环境变量（防止开发者密钥泄露）
# 2. 隔离 HERMES_HOME（每个测试独立 tempdir）
# 3. 确定性运行时（TZ=UTC, LANG=C.UTF-8, PYTHONHASHSEED=0）
# 4. 禁止 HERMES_SESSION_* 继承
```

**Coder Agent 适配**：已实现 `configs/test-setup.ts`，功能完全对齐。

#### 模式 2：Per-File 进程隔离

每个测试文件在独立 Python 子进程中运行，防止跨文件状态泄漏（module-level dicts、ContextVars、caches）。

```
scripts/run_tests_parallel.py → 每个测试文件独立 subprocess
```

**Coder Agent 适配**：
- Vitest 默认在独立 Worker 线程中运行测试文件（`pool: 'threads'`）
- 每个 Worker 有独立的模块缓存
- 配合 `configs/test-setup.ts` 的 `beforeEach`/`afterEach` 确保 per-test 清理

#### 模式 3：工厂函数 + Fixture

大量使用工厂函数（`make_source`, `make_session_entry`, `make_event`, `make_runner`）构建测试数据，而非全局 fixture：

```python
def make_source(platform, chat_id="e2e-chat-1", user_id="e2e-user-1"):
    return SessionSource(platform=platform, chat_id=chat_id, ...)

def make_runner(platform, session_entry=None):
    """跳过 __init__ 避免文件系统/网络副作用"""
    runner = object.__new__(GatewayRunner)
    runner.config = GatewayConfig(...)
    # 手动注入 mock 依赖
    runner.session_store = MagicMock()
    return runner
```

**Coder Agent 适配**：已实现 `configs/test-utils.ts`：
- `createTestContext()` — 构建 Agent 测试上下文
- `mockAgentResponse()` — 模拟 LLM 响应
- `mockAgentToolUse()` — 模拟工具调用响应
- `createUserMessage()` / `createAssistantMessage()` — 消息工厂

#### 模式 4：E2E 无 LLM 测试

E2E 测试不调用真实 LLM API，而是 mock 整个消息流：

```python
# tests/e2e/conftest.py
runner._handle_message_with_agent = AsyncMock(return_value="agent-handled-default")
adapter.send = AsyncMock(return_value=SendResult(success=True, message_id="e2e-resp-1"))
```

完整的消息流测试：adapter.handle_message(event) → background task → GatewayRunner → adapter.send()

**Coder Agent 适配**：
- 单元测试 mock LLM 调用（`mockAgentResponse`）
- 集成测试使用 mock provider
- E2E 测试通过 CLI `--print` 模式 + 脚本化输入验证完整流程

#### 模式 5：参数化跨平台测试

```python
@pytest.fixture(params=[Platform.TELEGRAM, Platform.DISCORD, Platform.SLACK])
def platform(request):
    return request.param
```

**Coder Agent 适配**：
- Provider 测试参数化：`describe.each([['anthropic'], ['openai'], ['deepseek']])`
- 工具测试参数化：不同工具的风险等级、参数组合

### 1.3 关键数据

| 指标 | Hermes Agent | Coder Agent 一期目标 |
|------|-------------|---------------------|
| 总测试数 | ~17,000+ | 200+ |
| 测试文件数 | ~90 | 20+ |
| 行覆盖率 | 未公开 | ≥80% |
| 分支覆盖率 | 未公开 | ≥75% |
| CI 并行度 | 按文件拆分 | 按 package 拆分 |

---

## 二、Coder Agent 测试架构

### 2.1 测试目录结构

```
coder-agent/
├── configs/
│   ├── test-setup.ts           # 全局测试环境（hermetic invariants）
│   ├── test-utils.ts           # 测试辅助函数（工厂、mock、断言）
│   └── TEST_STRATEGY.md        # 本文档
├── vitest.config.ts            # Vitest 配置（含覆盖率阈值）
├── packages/
│   ├── shared/
│   │   └── src/
│   │       ├── utils/
│   │       │   ├── tokenizer.ts
│   │       │   ├── diff.ts
│   │       │   └── messages.ts
│   │       └── __tests__/
│   │           ├── utils/
│   │           │   ├── tokenizer.test.ts
│   │           │   ├── diff.test.ts
│   │           │   └── messages.test.ts
│   │           └── integration.test.ts
│   ├── core/
│   │   └── src/
│   │       ├── query.ts           # Agent Loop
│   │       ├── query-engine.ts
│   │       ├── ...
│   │       └── __tests__/
│   │           ├── query.test.ts
│   │           ├── query-engine.test.ts
│   │           └── ...
│   ├── tools/
│   │   └── src/
│   │       ├── bash.ts
│   │       ├── file-read.ts
│   │       └── __tests__/
│   ├── provider/
│   │   └── src/
│   │       ├── anthropic.ts
│   │       └── __tests__/
│   └── cli/
│       └── src/
│           ├── components/
│           └── __tests__/
```

### 2.2 测试分类策略

| 分类 | 标记方式 | 运行方式 | 超时 |
|------|---------|---------|------|
| **单元测试** | 默认 | `pnpm test` | 5s |
| **集成测试** | 文件名 `*.integration.test.ts` | `pnpm test:integration` | 30s |
| **E2E 测试** | 文件名 `*.e2e.test.ts` | 单独 workflow | 60s |
| **快照测试** | `expect().toMatchSnapshot()` | `pnpm test -- -u` | 5s |
| **性能测试** | `*.bench.ts` | `vitest bench` | N/A |

### 2.3 覆盖率阈值

```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    lines: 80,        // 行覆盖率 ≥ 80%
    branches: 75,     // 分支覆盖率 ≥ 75%
    functions: 80,    // 函数覆盖率 ≥ 80%
    statements: 80,   // 语句覆盖率 ≥ 80%
  },
}
```

豁免规则：
- `index.ts`（barrel 导出文件）
- `types/`（纯类型定义）
- `*.test.ts` / `*.spec.ts`（测试文件自身）

---

## 三、测试编写规范

### 3.1 命名约定

```
describe('ModuleName', () => {
  describe('functionName', () => {
    it('should [expected behavior] when [condition]', () => { ... });
  });
});
```

示例：
```typescript
describe('tokenizer', () => {
  describe('countTokens', () => {
    it('should return 0 for empty string', () => { ... });
    it('should handle unicode characters', () => { ... });
    it('should fallback gracefully for unknown models', () => { ... });
  });
});
```

### 3.2 测试模式清单

每个模块必须覆盖：

- [ ] **正常路径** — 预期输入产生预期输出
- [ ] **边界条件** — 空输入、零值、最大值
- [ ] **错误路径** — 无效输入、异常处理
- [ ] **幂等性** — 重复调用产生一致结果（适用时）
- [ ] **并发安全** — 多线程/异步安全（适用时）

### 3.3 Mock 策略

```
优先级：
1. 优先使用工厂函数（test-utils.ts）构建真实对象
2. 使用 vi.fn() mock 外部服务
3. 使用 vi.mock() mock 整个模块（谨慎使用）
4. 禁止 mock 被测试的模块自身
```

### 3.4 Hermetic 原则

每个测试必须：

1. **不依赖外部状态** — 不读取真实文件系统、环境变量、网络
2. **不影响其他测试** — `afterEach` 清理所有副作用
3. **可重复执行** — 相同输入始终产生相同输出
4. **可在 CI 运行** — 不依赖本地开发环境特定配置

---

## 四、CI 流水线

### 4.1 触发条件

| 事件 | 触发 |
|------|------|
| Push to `main` | 全部 jobs |
| Push to `develop` | 全部 jobs |
| PR to `main` | 全部 jobs |

### 4.2 并行策略

```
lint ────────────────┐
type-check ──────────┤
test (shared) ───────┤
test (core) ─────────┤
test (tools) ────────┼──→ coverage ──→ build ──→ ci-pass
test (provider) ─────┤
test (cli) ──────────┤
security (CodeQL) ───┘
```

### 4.3 缓存策略

- **pnpm store**: 使用 `actions/setup-node@v4` 的 `cache: 'pnpm'`
- **TypeScript**: 使用 `composite: true` + `incremental: true` 增量编译
- **Coverage artifacts**: 保留 7-14 天

---

## 五、渐进式实施计划

### Phase 1（当前）— 测试基础设施

- [x] Vitest 配置 + 覆盖率阈值
- [x] Global test setup（hermetic invariants）
- [x] Test utilities（工厂函数 + mock + 断言）
- [x] Shared 包单元测试（tokenizer, diff, messages）
- [x] CI 流水线配置
- [x] 每个 Package 的示例测试

### Phase 2 — 核心运行时测试

- [ ] `core/query.ts` Agent Loop 测试（mock LLM 响应）
- [ ] `core/system-prompt/` 动态组装测试
- [ ] `core/context/` 上下文压缩测试
- [ ] `core/permission/` 权限引擎测试
- [ ] `core/hooks/` Hooks 生命周期测试

### Phase 3 — 工具系统测试

- [ ] 每个工具的单元测试（bash, read, write, edit, glob, grep, etc.）
- [ ] `tool-registry.ts` 自动发现测试
- [ ] `orchestrator.ts` 工具编排测试
- [ ] 沙箱执行测试（macOS Seatbelt / Linux Landlock）

### Phase 4 — 集成 + E2E

- [ ] Provider 集成测试（mock HTTP 响应）
- [ ] Agent Teams 集成测试（Coordinator + Worker + Mailbox）
- [ ] CLI E2E 测试（`--print` 模式）
- [ ] 技能系统自创建/自改进测试

---

## 六、参考

- **Hermes Agent 测试实践**：`hermes-agent/tests/conftest.py`（hermetic invariants）、`tests/e2e/conftest.py`（E2E 工厂模式）、`tests/test_model_tools.py`（工具单元测试模式）
- **Vitest 文档**：https://vitest.dev/
- **Effect-TS 测试**：https://effect.website/docs/guides/testing
