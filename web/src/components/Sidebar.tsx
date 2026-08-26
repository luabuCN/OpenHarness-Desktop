import { RefreshCw, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/api";

export interface SidebarProps {
  sessions: SessionSummary[];
  sessionId: string;
  loading: boolean;
  error?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  sessions,
  sessionId,
  loading,
  error,
  onSelect,
  onNew,
  onDelete,
  onRefresh,
  onOpenSettings,
}: SidebarProps) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
      <div className="flex h-14 items-center gap-3 border-b px-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary font-bold text-primary-foreground">
          OH
        </span>
        <div className="min-w-0">
          <strong className="block truncate text-sm">OpenHarness</strong>
          <small className="block truncate text-xs text-muted-foreground">
            Local desktop runtime
          </small>
        </div>
      </div>

      <div className="p-3">
        <Button className="w-full" onClick={onNew} size="sm">
          New chat
        </Button>
      </div>

      <div className="px-4 pb-1 text-xs font-medium text-muted-foreground">Chats</div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No conversations yet.
          </p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "group grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-md",
                session.id === sessionId
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted",
              )}
            >
              <button
                type="button"
                className="min-w-0 px-3 py-2 text-left"
                onClick={() => onSelect(session.id)}
              >
                <span className="block truncate text-sm">{session.title}</span>
                <small className="block truncate text-xs text-muted-foreground">
                  {new Date(session.updatedAt).toLocaleString()}
                </small>
              </button>
              <button
                type="button"
                className="mr-1 hidden size-7 place-items-center rounded text-muted-foreground hover:text-destructive group-hover:grid"
                onClick={() => onDelete(session.id)}
                title="Delete chat"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t p-3 text-xs text-muted-foreground">
        {error ? (
          <span className="truncate text-destructive">{error}</span>
        ) : (
          <span className="truncate">SQLite · Hono sidecar</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh sessions"
        >
          <RefreshCw size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          title="设置"
        >
          <Settings size={14} />
        </Button>
      </div>
    </aside>
  );
}
