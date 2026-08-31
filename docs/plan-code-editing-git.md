# OpenHarness-Desktop 代码编辑与 Git 集成方案

> 目标：在项目对话中实现"类 ZCode / Mastra Code"的编码体验——代码对话、读取代码、修改代码、列举修改内容、展示修改前后 diff、git 提交/拉取。
> 参考实现：https://code.mastra.ai/ 、https://github.com/mastra-ai/mastra-code-ui

## 实施状态（2026-08-30：阶段 1-5 已完成）

| 阶段 | 状态 | 主要文件 |
|---|---|---|
| 1 编辑工具 diff 化 | ✅ | `server/src/runtime/file-changes.ts`（新）、`tools/workspace-provider.ts`、`prisma/schema.prisma` + `db.ts`（FileChange 表） |
| 2 Diff 渲染 | ✅ | `web/src/components/ai-elements/diff-block.tsx`（新，自实现解析+渲染，未引入 @git-diff-view/react）、`MessageView.tsx`、`RightPanel.tsx` ToolDetail |
| 3 变更面板 + 撤销 | ✅ | `server/src/routes/changes.ts`（新）、`web/src/components/ChangesPanel.tsx`（新，替换原"预览"空 tab） |
| 4 Git 后端 | ✅ | `server/src/runtime/git-utils.ts`、`tools/git-provider.ts`（新，8 个工具）、`routes/git.ts`（新）、`policies.ts`（gitPush 审批硬编码） |
| 5 Git 面板 | ✅ | `web/src/components/GitPanel.tsx`（新）、`web/src/api.ts` |
| 6 增强项 | 未实施 | 审批卡片 diff 预览、会话检查点、斜杠命令（按需排期） |

设计落地时的两处调整：diff 数据直接随 `editFile`/`writeFile` 工具输出流转（AI SDK UIMessage 自带持久化），不再需要独立的 `oh:file.changed` data part；`FileChange` 记录带 `existed` 标记区分新建/覆盖，撤销时对"读不出旧内容的既有文件"会安全拒绝而不是误删。

## 一、结论

**可行，且起点很高。** 本项目与 mastra-code-ui 是同一技术路线（Mastra 框架 + 桌面壳 + 工具化 agent），且以下基础设施已经就绪：

| 能力 | 现状 | 位置 |
|---|---|---|
| Agent 多轮循环 / 流式 / 工具调用 | ✅ 已有 | `server/src/runtime/agent-runtime.ts:56`（`@mastra/core` Agent + AI SDK UIMessage 流） |
| 工具注册表 + 权限 + 审批 | ✅ 已有 | `server/src/runtime/tools/registry.ts`（`ToolProvider` 接口、`wrapWithApproval`） |
| 读取类工具（readFile/listFiles/glob/grep） | ✅ 已有 | `server/src/runtime/tools/builtin-provider.ts` |
| 修改类工具（writeFile/editFile/mkdir） | ✅ 已有 | `server/src/runtime/tools/workspace-provider.ts:33-150` |
| 代码高亮渲染（shiki + 行号） | ✅ 已有 | `web/src/components/ai-elements/code-block.tsx` |
| 文件树 / 文件浏览 API | ✅ 已有 | `web/src/components/ai-elements/file-tree.tsx`、`server/src/routes/files.ts` |
| **编辑结果 diff 数据** | ❌ 空白 | editFile 返回值无 before/after |
| **diff 渲染组件** | ❌ 空白 | ai-elements 目录无 diff 组件 |
| **变更留痕（列举修改内容）** | ❌ 空白 | 无 FileChange 类数据模型 |
| **git 集成（库/API/工具/UI）** | ❌ 完全空白 | 全仓无 git 库与 git 代码 |

因此本方案 = 在现有工具体系上补 4 块：**① 编辑工具 diff 化 ② diff 渲染 ③ 变更面板 ④ git 集成（工具 + API + UI）**。

## 二、总体架构

```
┌─ Agent 工具层（server，走现有注册表/审批体系） ────────────────────┐
│  builtin-provider（读）      workspace-provider（写，返回 diff）     │
│  + 新增 git-provider（status/diff/commit/pull/push…）               │
└──────┬──────────────────────────────────────────────────────────────┘
       │ 每次 editFile/writeFile 落 FileChange 表（run 级留痕）
       ▼
┌─ HTTP API 层（server/src/routes） ─────────────────────────────────┐
│  既有 /api/files         新增 /api/git/*（status/diff/log/commit…）  │
│  新增 /api/projects/:id/changes（变更聚合）                          │
└──────┬──────────────────────────────────────────────────────────────┘
       ▼ SSE（UIMessage 流，tool-* parts / oh:* data parts）
┌─ 前端（web/src/components） ────────────────────────────────────────┐
│  聊天内：Tool 卡片中渲染 DiffBlock（修改前后差异）                    │
│  RightPanel：新增「变更」tab（会话修改列表）+「Git」tab（提交/拉取）   │
│  审批卡片：展示 diff 预览后再批准                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键设计决策

1. **diff 计算放在 server 端**：引入 `diff`（jsdiff）包。`editFile`/`writeFile` 执行成功后，由后端计算统一 diff，连同 before/after 摘要、增删行数一起写进工具输出。前端只负责渲染，不在浏览器算 diff。
2. **变更留痕用独立表，不强依赖 git**：新表 `FileChange`（按 runId 记录每次文件修改的 before/after/diff）。这样"列举修改内容 / 撤销"在非 git 目录也能用；有 git 时再与 `git status` 对账合并展示。
3. **git 操作双通道**：
   - **Agent 工具通道**：`git-provider.ts` 实现 `ToolProvider`，让模型在对话中自主 status/diff/commit/pull/push，自动进入现有审批体系（push 定为 high risk 强制审批）。
   - **HTTP API 通道**：`routes/git.ts` 供 GitPanel 面板人工操作（人肉勾选文件、写 commit message、点提交/拉取），不经过 LLM。
4. **git 库选型：`simple-git`**。底层仍调用系统 git 二进制，因此 **凭据复用系统 Credential Manager / SSH key**，桌面端零额外认证开发（mastra-code-ui 也是系统 git 方案）。备选：直接用现有 `SafeShellProvider.exec` 调 git 命令（无依赖但解析麻烦，不推荐）。
5. **diff 渲染选型：`@git-diff-view/react`**（GitHub 风格、行内/并排切换、可接 shiki 高亮）。若想零新依赖，也可基于现有 shiki CodeBlock 自渲染简版行级 diff，但工作量和效果不如现成组件。
6. **审批即 diff**：`ToolApproval` 增加 `diffPreview` 字段，`wrapWithApproval` 拦截 `editFile`/`writeFile` 时把"将要变成什么样"的 diff 一并入库，前端审批卡片直接展示——这是对标 ZCode 体验最关键的一环。

## 三、分阶段实施

### 阶段 1：编辑工具 diff 化（后端，~1.5 人日）

- `server` 安装 `diff` + `@types/diff`。
- 改 `workspace-provider.ts`：
  - 抽一个 `applyEdit()` 返回 `EditResult = { path, changeKind: 'create'|'edit'|'delete', before, after, unifiedDiff, additions, deletions }`（写前先读旧内容，10MB/512KB 上限沿用现有 `fs-utils.ts` 常量）。
  - `editFile`/`writeFile` 的工具输出从纯文本改为携带上述结构（保持人类可读摘要作为 output 文本，结构化数据放 `data`，兼容现有 Tool 卡片）。
- 新表 `FileChange`（注意**双轨**：`prisma/schema.prisma` 加模型 + `db.ts ensureSchema()` 手写 `CREATE TABLE IF NOT EXISTS`）：

```prisma
model FileChange {
  id          String   @id @default(cuid())
  runId       String   // ThreadRun.id
  conversationId String
  projectId   String?
  path        String   // 相对 workspace 的路径
  changeKind  String   // create | edit | delete
  before      String?  // 修改前全文（截断存储，供撤销）
  after       String?
  unifiedDiff String   // 统一 diff
  additions   Int
  deletions   Int
  createdAt   DateTime @default(now())
}
```

- `run-service.ts` 在工具执行成功后写 `FileChange`，并通过 UIMessage 自定义 data part `oh:file.changed`（沿用 `chat-utils.ts:15-26` 的 `oh:*` 模式）把 diff 推给前端。

**验收**：对话中让 agent 改一个文件，聊天流里 tool 卡片能拿到结构化 diff 数据。

### 阶段 2：Diff 渲染组件（前端，~1.5 人日）

- `web` 安装 `@git-diff-view/react`。
- 新建 `web/src/components/ai-elements/diff-block.tsx`：接收 `unifiedDiff`（或 before/after），行内/并排切换，接 shiki 主题；风格对齐现有 CodeBlock。
- `MessageView.tsx`：tool part 为 `editFile`/`writeFile` 或收到 `oh:file.changed` 时渲染 `DiffBlock`，头部显示 `路径 +12 -3`。
- `RightPanel.tsx` 的 `FileContentView` 支持传入 before/after 进入对比模式。

**验收**：聊天里能看到 GitHub 风格的修改前后差异。

### 阶段 3：变更面板——"列举出修改内容"（~2 人日）

- 新路由 `GET /api/projects/:id/changes`（按会话/时间聚合 `FileChange`；项目是 git 仓库时合并 `git status --porcelain` 的 untracked/modified 对账，标注来源）。
- `RightPanel` 新增「变更」tab（当前"预览" tab 为空占位，可替换或并列）：
  - 文件列表：路径、changeKind 徽章、`+adds -dels` 统计，按 run 分组；
  - 点击展开 DiffBlock；
  - 单文件「撤销」：用 `FileChange.before` 回写（走后端新端点 `POST /api/changes/:id/revert`，同样受沙箱校验）；
  - 「撤销本次会话全部修改」按钮（按 conversationId 反向回滚）。
- `App.tsx` 已有 runs/tasks 轮询机制，可同样低频轮询变更列表刷新。

**验收**：不接触 git，就能完整看到"这轮对话改了哪些文件、各自差异、并可撤销"。

### 阶段 4：Git 后端——工具 + API（~3 人日）

- `server` 安装 `simple-git`。
- 新建 `server/src/runtime/tools/git-provider.ts` 并在 `registry.ts:225-227` 处注册：

| 工具 | risk / mutating | 默认审批 | 说明 |
|---|---|---|---|
| `gitStatus` | low / 否 | 免审 | status --porcelain + 当前分支 |
| `gitDiff` | low / 否 | 免审 | 工作区/staged diff（行数截断） |
| `gitLog` | low / 否 | 免审 | 最近提交 |
| `gitCommit` | medium / 是 | 需审批 | `add` 指定文件 + commit（拒绝 `--all` 乱加） |
| `gitBranch` / `gitCheckout` | medium / 是 | 需审批 | 列分支/建分支/切换 |
| `gitPull` | medium / 是 | 需审批 | pull --ff-only，冲突不自动解决 |
| `gitPush` | **high** / 是 | **强制审批** | push 当前分支 |

  沙箱规则：`simpleGit(basePath)` 的 basePath 必须等于 `run.workspacePath` 或其子目录；工具入参中的路径一律 `path.resolve` 后 `assertInsideWorkspace`（复用 `safe-fs.ts` 现有函数），防止 agent 操作项目外的仓库。
- 新建 `server/src/routes/git.ts`（面板用，入参 `projectId` → 项目 `rootPath`）：
  - `GET /api/git/status?projectId=`（分支、ahead/behind、staged/unstaged/untracked 三组）
  - `GET /api/git/diff?projectId=&path=&staged=`
  - `GET /api/git/log?projectId=&limit=`
  - `POST /api/git/commit`（files[] + message）
  - `POST /api/git/pull` / `POST /api/git/push`
- 降级策略：项目目录不是 git 仓库 → API 返回 `{ available: false, reason }`，面板显示引导文案；系统未安装 git → 工具描述整体下线（同 `bash` 工具的 `OPENHARNESS_ENABLE_BASH` 模式，见 `registry.ts:141`）。

**验收**：对话里说"提交一下"，agent 走审批后完成 commit；curl 面板 API 能拿到 status/diff。

### 阶段 5：Git 面板 UI（~2.5 人日）

- 新建 `web/src/components/GitPanel.tsx`（参考 mastra-code-ui 的 GitPanel / VS Code 源代码管理）：
  - 顶部：当前分支、ahead/behind、拉取/推送按钮（带 loading 与结果 toast）；
  - 中部：三段式变更列表（暂存的更改 / 更改 / 未跟踪），勾选文件 = stage/unstage；
  - 底部：commit message 输入 + 提交按钮；
  - 文件行点击 → DiffBlock 查看。
- 挂到 `RightPanel` 新增「Git」tab；`web/src/api.ts` 补对应封装。
- agent 侧的 `gitCommit` 等工具调用照常出现在聊天 Tool 卡片中（已有渲染），形成"人肉面板 + agent 工具"双入口。

**验收**：不动聊天，纯面板完成 拉取→勾选→写信息→提交→推送 全流程。

### 阶段 6：体验对齐 ZCode 的增强项（可选，按需排期）

1. **审批卡片 diff 预览**（强烈建议，~1 人日）：`ToolApproval` 表加 `diffPreview` 列，`wrapWithApproval` 对编辑类工具生成"预期 diff"入库，`ApprovalPrompt` 组件内嵌 DiffBlock——用户看着差异点批准。
2. **会话检查点 / 一键回滚**（~2 人日）：每个 run 开始时记快照（git 仓库可用 `git stash create`/shadow commit；非 git 目录用 FileChange.before 反推），侧边栏会话右键"回滚到此轮之前"。
3. **斜杠命令**：PromptInput 支持 `/diff`（打开变更面板）、`/commit`（预填面板）、`/review`（让 agent 读 diff 做代码评审）。
4. **auto_edit 权限模式联动**：`policies.ts` 的 `AUTO_EDIT_TOOLS` 已有 `writeFile/editFile/mkdir`，可把 `gitStatus/gitDiff` 设为免审只读、`gitCommit` 维持需审。
5. **bash 工具放开**：`OPENHARNESS_ENABLE_BASH` 目前默认关，编码场景（跑测试/装依赖）建议项目级可开。

## 四、涉及的数据模型与迁移注意

- 所有新表/新列必须**双轨同步**：`prisma/schema.prisma`（类型生成）+ `db.ts ensureSchema()` 的 raw SQL（运行时真正建表）。项目不跑 migration，漏改 `db.ts` 会导致运行时报错。
- 变更清单：新表 `FileChange`；`ToolApproval` 加 `diffPreview TEXT`；（可选）`ThreadRun` 加 `snapshotRef`。

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| Windows 下 git 输出编码（GBK） | simple-git 传 `env: { LANG: 'C.UTF-8' }`；diff 内容统一 UTF-8 解码，异常时 fallback |
| 大文件/大 diff 撑爆上下文与 UI | diff 超 N 行（如 400）只给摘要 + 文件级统计；`FileChange.before/after` 超限截断并在 UI 标注 |
| 二进制文件 | 复用 `fs-utils.ts` 的 `isBinaryPath`，二进制只记 changeKind 与大小，不存内容不算 diff |
| 多会话并发改同一项目 | FileChange 按 runId 隔离；git 面板操作前重新拉 status 防止覆盖别人 staged 内容 |
| pull 冲突 / push 被拒 | 不自动解决：返回冲突文件清单，agent 汇报，由人处理（与 ZCode 行为一致） |
| 打包环境无 git | 启动探测 `git --version`，无则 git 工具与面板整体降级隐藏 |
| push 泄露风险 | push 永远 high risk + 强制审批，不受 `full`/`auto_edit` 模式豁免（在 `policies.ts` 加硬编码豁免黑名单） |

## 六、工作量汇总

| 阶段 | 内容 | 估算 |
|---|---|---|
| 1 | 编辑工具 diff 化 + FileChange 表 | ~1.5 人日 |
| 2 | DiffBlock 渲染组件 | ~1.5 人日 |
| 3 | 变更面板 + 撤销 | ~2 人日 |
| 4 | git 工具 + HTTP API | ~3 人日 |
| 5 | GitPanel UI | ~2.5 人日 |
| 6 | 增强项（审批 diff/检查点/命令） | 按需 |

核心路径（阶段 1-5）约 **10-11 人日**；最小可用版（阶段 1+2+4 的工具部分）约 **4 人日**即可让对话内出现"改代码 + 看 diff + agent 提交"闭环。
