import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import {
  deleteAgent,
  listAgents,
  listProviders,
  updateAgent,
  type AgentInfo,
  type ProviderInfo,
} from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { AgentFormSheet } from "./AgentFormSheet";

interface AgentsSectionProps {
  onChanged?: () => void;
}

export function AgentsSection({ onChanged }: AgentsSectionProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgentInfo | null>(null);
  const [deleting, setDeleting] = useState<AgentInfo | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextAgents, nextProviders] = await Promise.all([listAgents(), listProviders()]);
      setAgents(nextAgents);
      setProviders(nextProviders);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载 Agent 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggleActive(agent: AgentInfo, isActive: boolean) {
    setAgents((current) =>
      current.map((entry) => (entry.id === agent.id ? { ...entry, isActive } : entry)),
    );
    try {
      await updateAgent(agent.id, { isActive });
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新失败");
      void refresh();
    }
  }

  async function remove() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await deleteAgent(target.id);
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4">
        <div className="text-base font-semibold">Agent</div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus size={14} />
          创建
        </Button>
      </div>
      {error ? <p className="px-4 text-xs text-destructive">{error}</p> : null}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            加载中...
          </p>
        ) : (
          <div className="flex flex-col gap-2 p-4">
            {agents.map((agent) => {
              const provider = providers.find((entry) => entry.id === agent.defaultProviderId);
              const model = provider?.models.find((entry) => entry.id === agent.defaultModelId);
              return (
                <Item variant="outline" key={agent.id}>
                  <ItemContent>
                    <ItemTitle>
                      <Bot size={16} />
                      <span>{agent.name}</span>
                      {agent.isBuiltIn ? <Badge variant="secondary">内置</Badge> : null}
                      {!agent.isActive ? <Badge variant="outline">停用</Badge> : null}
                    </ItemTitle>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{agent.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.subAgents.length} 个子 Agent
                      {model ? ` · 默认 ${provider?.name} / ${model.name}` : ""}
                    </p>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      checked={agent.isActive}
                      onCheckedChange={(checked) => void toggleActive(agent, !!checked)}
                    />
                    <Button
                      variant="outline"
                      size="icon-sm"
                      title="编辑"
                      onClick={() => {
                        setEditing(agent);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      title={agent.isBuiltIn ? "内置 Agent 不能删除" : "删除"}
                      disabled={agent.isBuiltIn}
                      onClick={() => setDeleting(agent)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </ItemActions>
                </Item>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <AgentFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        providers={providers}
        onSaved={() => void refresh()}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除 Agent「{deleting?.name ?? ""}」？相关项目默认 Agent 会被清空。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void remove()}
            >
              <Trash2 size={14} />
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
