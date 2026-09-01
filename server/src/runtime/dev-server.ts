import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** 面板预览的后台开发服务器支持：bash 工具识别出“启动项目”类命令后，
 * 以 detached 方式拉起（不随工具超时被杀），从早期输出中解析监听地址，
 * 等端口可访问后把 URL 交回工具返回值。 */

export interface DevServerStartResult {
  mode: "background";
  url?: string;
  port?: number;
  pid?: number;
  alreadyRunning: boolean;
  stdout: string;
  stderr: string;
  note: string;
}

interface RunningServer {
  pid?: number;
  url?: string;
  port?: number;
  command: string;
  startedAt: number;
}

/** 进程级注册表：同一条命令重复执行时先探测已有实例，活着就复用。 */
const runningServers = new Map<string, RunningServer>();

/** 识别“启动项目/开发服务器”类命令。命中后走后台启动而不是阻塞执行。 */
const SERVER_COMMAND_PATTERNS: RegExp[] = [
  /\bpnpm\s+(?:--dir\s+\S+\s+)?(?:run\s+)?(?:dev|start|preview)\b/,
  /\bnpm\s+(?:run\s+)?(?:dev|start|preview)\b/,
  /\byarn\s+(?:run\s+)?(?:dev|start)\b/,
  /\bbun\s+(?:run\s+)?(?:dev|start)\b/,
  /\bnpx\s+(?:vite|serve|http-server|next|astro|webpack-dev-server)\b/,
  /\b(?:vite|next\s+(?:dev|start)|astro\s+dev|ng\s+serve)\b/,
  /\bpython(?:3)?\s+-m\s+http\.server\b/,
  /\bruby\s+-run\s+-ehttp\.server\b/,
];

export function looksLikeDevServer(command: string): boolean {
  return SERVER_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

/** 命令行里显式给出的端口（--port 3000 / -p 3000 / http.server 8000）。 */
function explicitPort(command: string): number | undefined {
  const patterns = [
    /(?:--port[=\s]+|-p\s+|-l\s+|--listen[=\s]+)(\d{2,5})\b/,
    /\bhttp\.server\s+(\d{2,5})\b/,
    /:(\d{2,5})\/?\s*$/,
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) {
      const port = Number(match[1]);
      if (port >= 1 && port <= 65535) return port;
    }
  }
  return undefined;
}

/** 从进程输出中解析监听地址：“Local: http://localhost:5173/”、
 * “ready on http://127.0.0.1:3000”、“Serving HTTP on 0.0.0.0 port 8000”。
 * vite 等工具会给端口染 ANSI 颜色（http://localhost:\x1b[1m5173\x1b[22m/），
 * 必须先剥掉，否则端口数字被打断、正则退化为默认 80。 */
export function extractPort(text: string): number | undefined {
  const plain = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  const url = plain.match(
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::(\d+))?/,
  );
  if (url) return url[1] ? Number(url[1]) : url[0].startsWith("https") ? 443 : 80;
  // netstat 等工具的裸格式：[::1]:8088 ... LISTENING
  const v6 = plain.match(/\[::1\]:(\d{2,5})/);
  if (v6) return Number(v6[1]);
  const named = plain.match(/\bport\s*[:=]?\s*(\d{2,5})\b/i);
  if (named) return Number(named[1]);
  return undefined;
}

/** 端口探测要同时试 IPv4/IPv6 回环：vite 等工具在 Windows 上可能只绑
 * [::1]，只探 127.0.0.1 会把活着的端口误判为未启动。 */
async function portResponds(port: number): Promise<boolean> {
  for (const target of [`http://127.0.0.1:${port}/`, `http://[::1]:${port}/`]) {
    try {
      await fetch(target, { signal: AbortSignal.timeout(800) });
      return true;
    } catch {
      // 换下一个回环地址
    }
  }
  return false;
}

/** 对外返回的预览地址用 localhost：浏览器会自行在 IPv4/IPv6 回环间选择，
 * 与服务实际绑定的栈无关。 */
function previewUrlForPort(port: number): string {
  return `http://localhost:${port}`;
}

/** 前台命令执行后的兜底检测：输出里报出了 localhost 地址且该端口当前
 * 确实在响应（通过自建脚本/批处理拉起的服务，命令超时被杀后常以孤儿
 * 进程存活），同样可以请求面板预览。 */
export async function detectLiveServerUrl(output: string): Promise<string | undefined> {
  const port = extractPort(output);
  if (!port) return undefined;
  return (await portResponds(port)) ? previewUrlForPort(port) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... (truncated, ${text.length - max} chars omitted)`;
}

/**
 * 后台启动一条开发服务器命令并探测其访问地址。
 *
 * 输出写入临时日志文件（进程 detached 后仍持有句柄），轮询读取直到解析
 * 出端口；再轮询端口直到有 HTTP 响应。两者都有上限，超时也不视为失败——
 * 服务器可能仍在编译，地址留空、进程照常存活。
 */
/** 当前处于 LISTENING 状态的 TCP 本地端口快照。detached 进程的输出在
 * Windows 上无法可靠捕获，用“启动前后的端口差集”归因新起的服务。 */
async function listeningPortSnapshot(): Promise<Set<number>> {
  const ports = new Set<number>();
  const isWindows = process.platform === "win32";
  try {
    const { stdout } = isWindows
      ? await execFileAsync("cmd.exe", ["/c", "netstat -ano -p tcp"], {
          timeout: 5_000,
          windowsHide: true,
        })
      : await execFileAsync("netstat", ["-ltn"], { timeout: 5_000 });
    for (const line of stdout.split(/\r?\n/)) {
      if (!/\bLISTEN(?:ING)?\b/i.test(line)) continue;
      // 行内第一个 host:port 是本地地址（两种平台都是 Local 在 Foreign 前）
      const match = line.match(/(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]*\]):(\d+)/);
      if (match) ports.add(Number(match[1]));
    }
  } catch {
    // netstat 不可用时退化为无快照（差集恒空，只剩显式端口与日志解析）
  }
  return ports;
}

export async function startDevServer(options: {
  command: string;
  cwd: string;
  maxWaitMs?: number;
}): Promise<DevServerStartResult> {
  const { command } = options;
  // 统一成正斜杠:Windows 两类分隔符都合法,但部分受限环境只认正斜杠
  const cwd = options.cwd.replaceAll("\\", "/");
  const maxWaitMs = options.maxWaitMs ?? 20_000;

  const existing = runningServers.get(command);
  if (existing?.port && (await portResponds(existing.port))) {
    return {
      mode: "background",
      url: existing.url ?? previewUrlForPort(existing.port),
      port: existing.port,
      pid: existing.pid,
      alreadyRunning: true,
      stdout: "",
      stderr: "",
      note: `开发服务器已在后台运行：${existing.url ?? previewUrlForPort(existing.port)}`,
    };
  }

  const stamp = `${Date.now()}-${process.pid}`;
  const outLog = path.join(os.tmpdir(), `oh-devserver-${stamp}.out.log`);
  const errLog = path.join(os.tmpdir(), `oh-devserver-${stamp}.err.log`);

  // 通过临时脚本启动并把输出重定向到日志文件：detached 进程在 Windows 上
  // 跨进程继承 fd 句柄不可靠（进程能启动但日志恒为空，端口无从探测），
  // 让 shell 在脚本内部完成重定向就没有句柄传递。脚本文件需保留——
  // cmd 是逐行读取批处理的，删掉会中断还在运行的服务器。
  const isWindows = process.platform === "win32";
  const scriptPath = path.join(os.tmpdir(), `oh-devserver-${stamp}${isWindows ? ".cmd" : ".sh"}`);
  const script = isWindows
    ? ["@echo off", `cd /d "${cwd}"`, `${command} > "${outLog}" 2> "${errLog}"`].join("\r\n")
    : ["#!/bin/sh", `cd "${cwd}" || exit 1`, `${command} > "${outLog}" 2> "${errLog}"`].join("\n");
  await fsp.writeFile(scriptPath, script, "utf8");

  // Windows 上直接 detached 启动 cmd 时，后代控制台程序（npm→node/vite）
  // 找不到可继承的控制台，Windows 会给它们新建一个【可见】控制台窗口，
  // 用户会看到终端弹出。用 wscript（GUI 程序，自身无控制台）以隐藏窗口
  // 样式拉起启动脚本，整棵进程树都附着在这个隐藏控制台上，不再弹窗。
  let invocation: { executable: string; args: string[] };
  if (isWindows) {
    const launcherPath = path.join(os.tmpdir(), `oh-devserver-${stamp}.vbs`);
    const launcher =
      `CreateObject("WScript.Shell").Run """${scriptPath}""", 0, False`;
    await fsp.writeFile(launcherPath, launcher, "utf8");
    invocation = { executable: "wscript.exe", args: [launcherPath] };
  } else {
    invocation = { executable: "bash", args: [scriptPath] };
  }
  const child = spawn(invocation.executable, invocation.args, {
    cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  // spawn 失败（可执行不存在、cwd 无效等）以 error 事件异步到达；
  // 不监听会变成未处理异常把整个服务进程带崩，这里转成工具错误返回。
  const startup = new Promise<Error | "ok">((resolve) => {
    child.on("error", (error) => resolve(error));
    child.on("spawn", () => resolve("ok"));
  });
  const outcome = await Promise.race([startup, sleep(2_000).then(() => "ok" as const)]);
  if (outcome instanceof Error) {
    runningServers.delete(command);
    return {
      mode: "background",
      alreadyRunning: false,
      stdout: "",
      stderr: outcome.message,
      note: `后台启动失败：${outcome.message}。可改用普通方式运行该命令排查原因。`,
    };
  }

  const entry: RunningServer = { pid: child.pid, command, startedAt: Date.now() };
  runningServers.set(command, entry);

  // 1) 端口探测三路并发：命令行显式端口 > 进程输出解析 > 监听端口差集。
  //    detached 进程的输出在 Windows 上经常捕获不到，差集是可靠兜底。
  const preferred = explicitPort(command);
  const baseline = await listeningPortSnapshot();
  let port = preferred;
  const findDeadline = Date.now() + Math.min(maxWaitMs, 12_000);
  while (!port && Date.now() < findDeadline) {
    await sleep(700);
    const [out, err] = await Promise.all([
      fsp.readFile(outLog, "utf8").catch(() => ""),
      fsp.readFile(errLog, "utf8").catch(() => ""),
    ]);
    port = extractPort(out) ?? extractPort(err);
    if (!port) {
      // 启动后新增的监听端口即本服务；多个候选时选第一个有 HTTP 响应的
      // （vite 等可能同时开 esbuild/HMR 相关端口），而不是放弃猜测。
      const fresh = [...(await listeningPortSnapshot())]
        .filter((candidate) => !baseline.has(candidate) && candidate > 1023)
        .sort((a, b) => a - b);
      for (const candidate of fresh) {
        if (await portResponds(candidate)) {
          port = candidate;
          break;
        }
      }
    }
    if (port) entry.port = port;
  }
  if (port) entry.port = port;

  // 2) 等端口真正可访问（浏览器面板打开时才不会白屏）
  const readyDeadline = Date.now() + Math.min(maxWaitMs, 10_000);
  if (port) {
    while (!(await portResponds(port))) {
      if (Date.now() >= readyDeadline) break;
      await sleep(500);
    }
  }

  const [stdout, stderr] = await Promise.all([
    fsp.readFile(outLog, "utf8").catch(() => ""),
    fsp.readFile(errLog, "utf8").catch(() => ""),
  ]);

  let url: string | undefined;
  if (port && (await portResponds(port))) {
    url = previewUrlForPort(port);
    entry.url = url;
  }

  return {
    mode: "background",
    url,
    port,
    pid: child.pid,
    alreadyRunning: false,
    stdout: truncate(stdout, 8_000),
    stderr: truncate(stderr, 4_000),
    note: url
      ? `开发服务器已在后台启动并验证可访问：${url}。向用户报告访问地址时必须原样使用这个地址，禁止猜测或替换为 5173/3000 等默认端口；进程不会随本次命令结束而退出。`
      : "命令已在后台启动，但尚未从输出中解析出监听地址。如需向用户报告访问地址，必须先用 netstat 等方式确认实际端口，禁止直接使用 5173/3000 等默认端口猜测。",
  };
}
