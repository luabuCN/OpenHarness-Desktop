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
