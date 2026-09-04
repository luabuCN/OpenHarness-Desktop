# OpenHarness Desktop

Tauri 2 桌面客户端原型：

- `web`: Vite + React，复用 `@openharness/react` 的聊天 UI hooks
- `server`: Hono + Prisma + SQLite 的 Node sidecar，负责 Agent、模型调用和本地数据
- `src-tauri`: Rust 壳，负责窗口管理和 sidecar 生命周期

## 开发

先确保 `E:/study/open-harness` 里的 workspace 包已经构建：

```bash
cd E:/study/open-harness
pnpm --filter @openharness/core --filter @openharness/react build
```

然后安装依赖并初始化数据库：

```bash
cd E:/study/open-harness-desktop
pnpm install
pnpm db:push
```

启动完整桌面开发模式：

```bash
pnpm dev
```

开发模式下会同时启动：

- Hono API: `http://127.0.0.1:8878`
- Vite Web: `http://localhost:5173`
- Tauri window

## 配置

开发环境配置在 `server/.env`：

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=http://192.168.40.113:8088/v1
OPENAI_MODEL=qwen3.8-max
```

打包后的应用会从系统数据目录读取 `.env`：

- Windows: `%APPDATA%/com.openharness.desktop/.env`
- macOS: `~/Library/Application Support/com.openharness.desktop/.env`
- Linux: `~/.config/com.openharness.desktop/.env`

SQLite 数据也放在同一个数据目录，不会写入安装目录。

### 网页搜索

`webSearch` / `webFetch` 工具开箱可用，无需额外配置时按以下顺序选择搜索引擎：

1. 复用设置里已配置的**智谱**模型供应商 key（apiBase 含 `bigmodel.cn`）调用智谱 web_search / reader；
2. `.env` 中的 `OPENHARNESS_WEBSEARCH_API_KEY`（按 key 前缀自动识别引擎：`tvly-` → Tavily、`sk-` → 博查、其余 → Brave）；
3. 免 key 兜底：直接抓取搜狗 / DuckDuckGo 结果页。

可选环境变量：

```dotenv
# 搜索 API key（Tavily / 博查 / Brave / 智谱，任选其一）
OPENHARNESS_WEBSEARCH_API_KEY=tvly-...
# 强制指定引擎：zhipu / bocha / tavily / brave / sogou / duckduckgo / auto（默认 auto）
OPENHARNESS_WEBSEARCH_ENGINE=auto
```

### 技能（Skills）

参考 PI-Desktop 的目录式技能设计（SKILL.md 指令文档）。应用默认扫描本机的三个
Agent CLI 技能目录，外加应用自己的自定义技能目录（可在「设置 → 技能」里增删改、
按来源整体启停）：

| 来源 | 目录 | 说明 |
| --- | --- | --- |
| 自定义 | `<数据目录>/skills/<id>/SKILL.md` | 在设置里创建，可编辑/删除 |
| Claude | `~/.claude/skills/` | Claude Code 技能（支持符号链接） |
| Codex | `~/.codex/skills/` | Codex 技能 |
| cc-switch | `~/.cc-switch/skills/` | cc-switch 技能 |

启用状态存在 SQLite（`SkillRecord` 表），同名技能按 自定义 > Claude > Codex >
cc-switch 的优先级去重。启用后走两条通路：

1. **自动发现**：技能目录注入 Mastra Agent，模型看到 `<available_skills>` 目录，
   可通过内置 `skill` / `skill_read` 工具按需加载正文；
2. **显式调用**：输入框输入 `/` 弹出技能菜单，选中后以 `/技能名 参数` 发送；
   服务端在发给模型的副本里展开技能正文，聊天历史仍保留紧凑的命令文本。

## 安全边界

- API 只监听 `127.0.0.1`
- 文件工具被限制在数据目录下的 `workspace`
- bash 工具默认关闭；确需执行命令时设置 `OPENHARNESS_ENABLE_BASH=true`
- API key 只存在于 sidecar 进程，不进入前端 bundle

## 打包

Windows 打包要求 Rust 1.88+。当前机器的 Cargo 代理配置在 `src-tauri/.cargo/config.toml`，如果换机器或代理变化，需要同步调整。

```bash
pnpm build:desktop
```

这个命令会把 Hono 后端打包成 Node Single Executable Application，复制到 Tauri 的 `externalBin` 目录，再生成 Windows MSI。
