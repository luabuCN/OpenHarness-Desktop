import {
  BarChart3Icon,
  CheckCircleIcon,
  CircleIcon,
  FolderOpenIcon,
  GlobeIcon,
  ListTodoIcon,
  LoaderCircleIcon,
  WrenchIcon,
  XCircleIcon,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listFiles, type FileEntry } from "@/api";
import {
  collectToolCalls,
  collectUsage,
  latestTodos,
  type ChatUIMessage,
  type ToolCallRef,
} from "@/lib/chat-utils";
import { cn } from "@/lib/utils";

export type RightTab = "files" | "todos" | "preview" | "tools" | "usage";

export interface RightPanelProps {
  messages: ChatUIMessage[];
  tab: RightTab;
  onTabChange: (tab: RightTab) => void;
  selectedToolId?: string;
  onToolSelect: (id: string) => void;
}

export function RightPanel({
  messages,
  tab,
  onTabChange,
  selectedToolId,
  onToolSelect,
}: RightPanelProps) {
  return (
    <aside className="hidden w-[400px] shrink-0 flex-col border-l bg-background lg:flex">
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as RightTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="h-auto w-full shrink-0 justify-start gap-1 rounded-none border-b bg-transparent px-2 py-1.5">
          <TabsTrigger value="files" className="gap-1.5 text-xs">
            <FolderOpenIcon className="size-3.5" />
            Files
          </TabsTrigger>
          <TabsTrigger value="todos" className="gap-1.5 text-xs">
            <ListTodoIcon className="size-3.5" />
            Todo List
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-1.5 text-xs">
            <GlobeIcon className="size-3.5" />
            Preview
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-1.5 text-xs">
            <WrenchIcon className="size-3.5" />
            Tool Result
          </TabsTrigger>
          <TabsTrigger value="usage" className="gap-1.5 text-xs">
            <BarChart3Icon className="size-3.5" />
            Usage
          </TabsTrigger>
        </TabsList>

        <TabsContent value="files" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <WorkspaceFiles />
        </TabsContent>
        <TabsContent value="todos" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <TodoList messages={messages} />
        </TabsContent>
        <TabsContent value="preview" className="m-0 min-h-0 flex-1 overflow-y-auto p-3">
          <EmptyNote text="No preview available in this prototype." />
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

function WorkspaceFiles() {
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string>();
  const loadedRef = useRef<Set<string>>(new Set());

  const load = useCallback((path: string) => {
    if (loadedRef.current.has(path)) return;
    loadedRef.current.add(path);
    listFiles(path)
      .then((list) => setEntries((prev) => ({ ...prev, [path]: list })))
      .catch(() => loadedRef.current.delete(path));
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  const handleExpandedChange = useCallback(
    (next: Set<string>) => {
      setExpanded(next);
      for (const path of next) load(path);
    },
    [load],
  );

  const renderDir = (dirPath: string): ReactNode =>
    (entries[dirPath] ?? []).map((entry) => {
      const childPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
      return entry.isDirectory ? (
        <FileTreeFolder key={childPath} path={childPath} name={entry.name}>
          {expanded.has(childPath) ? renderDir(childPath) : null}
        </FileTreeFolder>
      ) : (
        <FileTreeFile key={childPath} path={childPath} name={entry.name} />
      );
    });

  const rootLoaded = "" in entries;

  return (
    <FileTree
      expanded={expanded}
      onExpandedChange={handleExpandedChange}
      selectedPath={selected}
      onSelect={setSelected}
      className="rounded-none border-0"
    >
      {rootLoaded ? renderDir("") : <EmptyNote text="Loading workspace…" />}
      {rootLoaded && (entries[""] ?? []).length === 0 ? (
        <EmptyNote text="Workspace is empty." />
      ) : null}
    </FileTree>
  );
}

const TODO_STATUS_ICONS = {
  pending: <CircleIcon className="size-4 text-muted-foreground" />,
  in_progress: <LoaderCircleIcon className="size-4 animate-spin text-blue-600" />,
  completed: <CheckCircleIcon className="size-4 text-green-600" />,
  cancelled: <XCircleIcon className="size-4 text-muted-foreground" />,
} as const;

function TodoList({ messages }: { messages: ChatUIMessage[] }) {
  const todos = latestTodos(messages);

  if (todos.length === 0) {
    return <EmptyNote text="The agent has not created tasks in this session." />;
  }

  return (
    <ul className="space-y-2">
      {todos.map((todo, index) => (
        <li key={todo.id ?? index} className="flex items-start gap-2 rounded-md border p-2.5">
          <span className="mt-0.5 shrink-0">{TODO_STATUS_ICONS[todo.status]}</span>
          <span
            className={cn(
              "min-w-0 flex-1 text-sm",
              (todo.status === "completed" || todo.status === "cancelled") &&
                "text-muted-foreground line-through",
            )}
          >
            {todo.content}
          </span>
          <Badge
            variant={
              todo.priority === "high"
                ? "destructive"
                : todo.priority === "medium"
                  ? "secondary"
                  : "outline"
            }
            className="shrink-0 text-[10px]"
          >
            {todo.priority}
          </Badge>
        </li>
      ))}
    </ul>
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
    return <EmptyNote text="No tool calls in this session yet." />;
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
    { label: "Agent turns", value: String(stats.turns) },
    { label: "Agent time", value: `${(stats.totalTurnMs / 1000).toFixed(1)}s` },
    { label: "Tool calls", value: String(stats.toolCalls) },
    { label: "Subagents", value: String(stats.subagents) },
    { label: "User messages", value: String(stats.userMessages) },
    { label: "Assistant messages", value: String(stats.assistantMessages) },
    { label: "Compactions", value: String(stats.compactions) },
    { label: "Compacted messages", value: String(stats.messagesRemoved) },
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
