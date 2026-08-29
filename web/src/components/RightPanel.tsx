import {
  ArrowLeftIcon,
  BarChart3Icon,
  CheckCircleIcon,
  CircleIcon,
  FolderOpenIcon,
  GlobeIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  WrenchIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CodeBlock } from "@/components/ai-elements/code-block";
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import { getStatusBadge, ToolInput } from "@/components/ai-elements/tool";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  listFiles,
  readFileContent,
  type AgentTaskInfo,
  type FileEntry,
  type ProjectInfo,
} from "@/api";
import {
  collectToolCalls,
  collectUsage,
  type ChatUIMessage,
  type ToolCallRef,
} from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

export type RightTab = "files" | "tasks" | "preview" | "tools" | "usage";

export interface RightPanelProps {
  messages: ChatUIMessage[];
  tasks: AgentTaskInfo[];
  tab: RightTab;
  onTabChange: (tab: RightTab) => void;
  selectedToolId?: string;
  onToolSelect: (id: string) => void;
  width: number;
  project?: ProjectInfo | null;
}

export function RightPanel({
  messages,
  tasks,
  tab,
  onTabChange,
  selectedToolId,
  onToolSelect,
  width,
  project,
}: RightPanelProps) {
  return (
    <aside
      className="hidden min-w-0 shrink-0 flex-col bg-background lg:flex"
      style={{ width }}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as RightTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="group-data-[orientation=horizontal]/tabs:h-11 w-full shrink-0 justify-start gap-1 rounded-none border-b bg-transparent px-2">
          <TabsTrigger value="files" className="h-8 gap-1.5 text-xs">
            <FolderOpenIcon className="size-3.5" />
            文件
          </TabsTrigger>
          <TabsTrigger value="tasks" className="h-8 gap-1.5 text-xs">
            <ListTodoIcon className="size-3.5" />
            任务
          </TabsTrigger>
          <TabsTrigger value="preview" className="h-8 gap-1.5 text-xs">
            <GlobeIcon className="size-3.5" />
            预览
          </TabsTrigger>
          <TabsTrigger value="tools" className="h-8 gap-1.5 text-xs">
            <WrenchIcon className="size-3.5" />
            工具结果
          </TabsTrigger>
          <TabsTrigger value="usage" className="h-8 gap-1.5 text-xs">
            <BarChart3Icon className="size-3.5" />
            用量
          </TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="m-0 min-h-0 flex-1 overflow-hidden p-3">
          <FileBrowser key={project?.id ?? "workspace"} project={project} />
        </TabsContent>
        <TabsContent value="tasks" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <TaskList tasks={tasks} />
        </TabsContent>
        <TabsContent value="preview" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <EmptyNote text="该原型暂不支持预览。" />
        </TabsContent>
        <TabsContent value="tools" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <ToolResults
            messages={messages}
            selectedToolId={selectedToolId}
            onToolSelect={onToolSelect}
          />
        </TabsContent>
        <TabsContent value="usage" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <UsageView messages={messages} />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="py-10 text-center text-xs text-muted-foreground">{text}</p>;
}

function FileBrowser({ project }: { project?: ProjectInfo | null }) {
  const rootPath = project?.rootPath ?? "";
  const rootLabel =
    project?.name ??
    rootPath.split(/[\\/]/).filter(Boolean).at(-1) ??
    "工作区";

  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<string>();
  const [reloadToken, setReloadToken] = useState(0);
  const loadedRef = useRef<Set<string>>(new Set());

  const load = useCallback((path: string) => {
    if (loadedRef.current.has(path)) return;
    loadedRef.current.add(path);
    listFiles(path)
      .then((list) => setEntries((prev) => ({ ...prev, [path]: list })))
      .catch(() => loadedRef.current.delete(path));
  }, []);

  useEffect(() => {
    load(rootPath);
  }, [load, rootPath, reloadToken]);

  const refresh = useCallback(() => {
    loadedRef.current = new Set();
    setEntries({});
    setExpanded(new Set());
    setSelected(undefined);
    setSelectedFile(undefined);
    setReloadToken((token) => token + 1);
  }, []);

  const handleExpandedChange = useCallback(
    (next: Set<string>) => {
      setExpanded(next);
      for (const path of next) load(path);
    },
    [load],
  );

  // Workspace mode uses workspace-relative paths ("a/b.txt"); project mode
  // uses absolute paths rooted at the project folder.
  const childPath = (dirPath: string, name: string) => {
    if (!dirPath) return rootPath ? `${rootPath.replaceAll("\\", "/")}/${name}` : name;
    return `${dirPath.replaceAll("\\", "/")}/${name}`;
  };

  const isFilePath = useCallback(
    (path: string) => {
      for (const [dirPath, list] of Object.entries(entries)) {
        if (list.some((entry) => entry.isFile && childPath(dirPath, entry.name) === path)) {
          return true;
        }
      }
      return false;
    },
    [entries, rootPath], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleSelect = useCallback(
    (path: string) => {
      setSelected(path);
      if (isFilePath(path)) setSelectedFile(path);
    },
    [isFilePath],
  );

  const renderDir = (dirPath: string): ReactNode =>
    (entries[dirPath] ?? []).map((entry) => {
      const path = childPath(dirPath, entry.name);
      return entry.isDirectory ? (
        <FileTreeFolder key={path} path={path} name={entry.name}>
          {expanded.has(path) ? renderDir(path) : null}
        </FileTreeFolder>
      ) : (
        <FileTreeFile key={path} path={path} name={entry.name} />
      );
    });

  const rootLoaded = rootPath in entries;

  if (selectedFile) {
    return (
      <FileContentView
        filePath={selectedFile}
        rootPath={rootPath}
        onBack={() => setSelectedFile(undefined)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{rootLabel}</span>
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={refresh}
          title="刷新"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileTree
          expanded={expanded}
          onExpandedChange={handleExpandedChange}
          selectedPath={selected}
          onSelect={handleSelect}
          className="rounded-none border-0"
        >
          {rootLoaded ? (
            renderDir(rootPath)
          ) : (
            <EmptyNote text={project ? "正在加载项目文件…" : "正在加载工作区…"} />
          )}
          {rootLoaded && (entries[rootPath] ?? []).length === 0 ? (
            <EmptyNote text="文件夹为空。" />
          ) : null}
        </FileTree>
      </div>
    </div>
  );
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript",
  cjs: "javascript", json: "json", jsonc: "json", rs: "rust", py: "python",
  go: "go", java: "java", kt: "kotlin", c: "c", h: "c", cpp: "cpp", cc: "cpp",
  hpp: "cpp", cs: "csharp", rb: "ruby", php: "php", swift: "swift",
  sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", sql: "sql",
  html: "html", htm: "html", css: "css", scss: "scss", vue: "vue",
  yml: "yaml", yaml: "yaml", toml: "toml", md: "markdown", mdx: "markdown",
  xml: "xml", dockerfile: "dockerfile", prisma: "prisma", graphql: "graphql",
  gql: "graphql", ini: "ini", lua: "lua", zig: "zig",
};

function languageForFile(filePath: string): string {
  const name = filePath.split("/").at(-1) ?? "";
  if (name.toLowerCase() === "dockerfile") return "dockerfile";
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return EXTENSION_LANGUAGE[extension] ?? "text";
}

function FileContentView({
  filePath,
  rootPath,
  onBack,
}: {
  filePath: string;
  rootPath: string;
  onBack: () => void;
}) {
  const [content, setContent] = useState<string>();
  const [error, setError] = useState<string>();
  const rootPrefix = rootPath ? `${rootPath.replaceAll("\\", "/")}/` : "";
  const relativePath = rootPrefix && filePath.startsWith(rootPrefix)
    ? filePath.slice(rootPrefix.length)
    : filePath;

  useEffect(() => {
    setContent(undefined);
    setError(undefined);
    let cancelled = false;
    readFileContent(filePath)
      .then((file) => {
        if (!cancelled) setContent(file.content);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "读取文件失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={onBack} title="返回文件树">
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={filePath}>
          {relativePath || filePath}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30">
        {error ? (
          <EmptyNote text={error} />
        ) : content === undefined ? (
          <EmptyNote text="正在加载文件…" />
        ) : (
          <CodeBlock
            code={content}
            language={languageForFile(filePath) as never}
            showLineNumbers
            className="rounded-none border-0 bg-transparent"
          />
        )}
      </div>
    </div>
  );
}

const TASK_STATUS_ICONS = {
  pending: <CircleIcon className="size-4 text-muted-foreground" />,
  in_progress: <LoaderCircleIcon className="size-4 animate-spin text-blue-600" />,
  completed: <CheckCircleIcon className="size-4 text-green-600" />,
} as const;

function TaskList({ tasks }: { tasks: AgentTaskInfo[] }) {
  if (tasks.length === 0) {
    return <EmptyNote text="当前会话暂无任务。" />;
  }

  const completedCount = tasks.filter((task) => task.status === "completed").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>共 {tasks.length} 个</span>
        <span>已完成 {completedCount} 个</span>
      </div>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-2.5 rounded-md border p-2.5">
            <span className="mt-0.5 shrink-0">{TASK_STATUS_ICONS[task.status]}</span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <p
                  className={cn(
                    "min-w-0 flex-1 text-sm font-medium",
                    task.status === "completed" && "text-muted-foreground line-through",
                  )}
                >
                  #{task.taskId} {task.subject}
                </p>
                <Badge
                  variant={task.status === "completed" ? "secondary" : "outline"}
                  className="shrink-0 text-[10px]"
                >
                  {task.status === "in_progress"
                    ? "进行中"
                    : task.status === "pending"
                      ? "待处理"
                      : "已完成"}
                </Badge>
              </div>
              {task.status === "in_progress" && task.activeForm ? (
                <p className="text-xs text-blue-600">{task.activeForm}</p>
              ) : null}
              {task.description ? (
                <p className="text-xs text-muted-foreground">{task.description}</p>
              ) : null}
              {task.blockedBy.length > 0 ? <DependencyTags label="阻塞于" ids={task.blockedBy} /> : null}
              {task.blocks.length > 0 ? <DependencyTags label="阻塞" ids={task.blocks} /> : null}
              {task.owner ? (
                <p className="font-mono text-[10px] text-muted-foreground">{task.owner}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DependencyTags({ label, ids }: { label: string; ids: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
      <span>{label}</span>
      {ids.map((id) => (
        <Badge key={`${label}-${id}`} variant="outline" className="px-1.5 py-0 text-[10px]">
          #{id}
        </Badge>
      ))}
    </div>
  );
}

function ToolResults({
  messages,
  selectedToolId,
  onToolSelect,
}: {
  messages: ChatUIMessage[];
  selectedToolId?: string;
  onToolSelect: (id: string) => void;
}) {
  const calls = collectToolCalls(messages);
  const selected = calls.find((call) => call.id === selectedToolId) ?? calls.at(-1);

  if (calls.length === 0) {
    return <EmptyNote text="当前会话暂无工具调用。" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {calls.map((call) => (
          <button
            key={call.id}
            type="button"
            onClick={() => onToolSelect(call.id)}
            className={cn(
              "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors",
              selected?.id === call.id
                ? "border-transparent bg-accent text-accent-foreground"
                : "hover:bg-muted",
            )}
          >
            {call.name}
          </button>
        ))}
      </div>
      {selected ? <ToolDetail call={selected} /> : null}
    </div>
  );
}

function ToolDetail({ call }: { call: ToolCallRef }) {
  const { part } = call;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{call.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{call.id}</p>
        </div>
        {getStatusBadge(part.state)}
      </div>

      {"input" in part && part.input !== undefined ? <ToolInput input={part.input} /> : null}

      {"errorText" in part && part.errorText ? (
        <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          {part.errorText}
        </div>
      ) : null}

      {"output" in part && part.output !== undefined ? (
        <CodeBlock
          code={
            typeof part.output === "string"
              ? part.output
              : JSON.stringify(part.output, null, 2)
          }
          language={call.name === "bash" ? "powershell" : "json"}
        />
      ) : null}
    </div>
  );
}

function UsageView({ messages }: { messages: ChatUIMessage[] }) {
  const stats = collectUsage(messages);

  const cards = [
    { label: "Agent 轮次", value: String(stats.turns) },
    { label: "Agent 耗时", value: `${(stats.totalTurnMs / 1000).toFixed(1)}s` },
    { label: "工具调用", value: String(stats.toolCalls) },
    { label: "子 Agent", value: String(stats.subagents) },
    { label: "用户消息", value: String(stats.userMessages) },
    { label: "助手消息", value: String(stats.assistantMessages) },
    { label: "上下文压缩次数", value: String(stats.compactions) },
    { label: "被压缩的消息", value: String(stats.messagesRemoved) },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border p-3">
          <p className="text-lg font-semibold">{card.value}</p>
          <p className="text-xs text-muted-foreground">{card.label}</p>
        </div>
      ))}
    </div>
  );
}
