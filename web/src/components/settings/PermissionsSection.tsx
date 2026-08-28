import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, ShieldCheck } from "lucide-react";

import {
  listAgents,
  listTools,
  updateAgent,
  type AgentInfo,
  type ToolCatalogInfo,
  type ToolPolicy,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface PermissionsSectionProps {
  onChanged?: () => void;
}

export function PermissionsSection({ onChanged }: PermissionsSectionProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [tools, setTools] = useState<ToolCatalogInfo[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextAgents, nextTools] = await Promise.all([listAgents(), listTools()]);
      setAgents(nextAgents);
      setTools(nextTools);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载权限失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function updatePermission(
    agent: AgentInfo,
    toolName: string,
    patch: Partial<ToolPolicy>,
  ) {
    const previous = agents;
    const policy = agent.toolPermissions[toolName] ?? { enabled: false, requireApproval: false };
    const nextPolicy = { ...policy, ...patch };
    setAgents((current) =>
      current.map((entry) =>
        entry.id === agent.id
          ? {
              ...entry,
              toolPermissions: {
                ...entry.toolPermissions,
                [toolName]: nextPolicy,
              },
            }
          : entry,
      ),
    );

    try {
      await updateAgent(agent.id, {
        toolPermissions: {
          ...agent.toolPermissions,
          [toolName]: nextPolicy,
        },
      });
      onChanged?.();
    } catch (cause) {
      setAgents(previous);
      setError(cause instanceof Error ? cause.message : "更新权限失败");
    }
  }

  const riskLabels: Record<ToolCatalogInfo["risk"], string> = {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
  };

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 p-4 text-base font-semibold">
        <ShieldCheck size={16} />
        权限
      </div>
      {error ? <p className="px-4 text-xs text-destructive">{error}</p> : null}
      {loading ? (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          加载中...
        </p>
      ) : (
        <div className="grid h-full min-h-0 flex-1 items-start gap-4 p-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex flex-col gap-2" role="tablist" aria-label="选择 Agent">
            {agents.map((agent) => {
              const enabledCount = tools.filter(
                (tool) => (agent.toolPermissions[tool.name] ?? tool.defaultPolicy).enabled,
              ).length;
              const selected = agent.id === selectedAgent?.id;

              return (
                <button
                  key={agent.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                    selected
                      ? "border-primary/40 bg-accent text-accent-foreground"
                      : "border-border bg-background",
                  )}
                  onClick={() => setSelectedAgentId(agent.id)}
                >
                  <Bot
                    size={16}
                    className={cn(
                      "mt-0.5 shrink-0",
                      selected ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{agent.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {enabledCount}/{tools.length} 个工具可用
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {selectedAgent ? (
            <section
              role="tabpanel"
              aria-label={`${selectedAgent.name} 的工具权限`}
              className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-background"
            >
              <div className="shrink-0 border-b bg-muted/35 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-medium">{selectedAgent.name}</h3>
                    <p className="truncate text-xs text-muted-foreground">
                      {selectedAgent.description || "配置该 Agent 可以使用哪些工具"}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-primary">可用</span>
                    <span>：暴露给 Agent</span>
                    <span className="mx-1.5 text-border">|</span>
                    <span className="font-medium text-amber-600 dark:text-amber-500">审批</span>
                    <span>：调用前确认</span>
                  </p>
                </div>
              </div>

              <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_repeat(2,3.25rem)] gap-x-3 border-b bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_repeat(2,4rem)]">
                <span>工具</span>
                <span className="text-center">可用</span>
                <span className="text-center">审批</span>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div role="list" className="divide-y divide-border/70">
                  {tools.map((tool) => {
                    const policy =
                      selectedAgent.toolPermissions[tool.name] ?? tool.defaultPolicy;

                    return (
                      <div
                        key={tool.name}
                        role="listitem"
                        className="grid grid-cols-[minmax(0,1fr)_repeat(2,3.25rem)] items-center gap-x-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(2,4rem)]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{tool.label}</span>
                            <Badge
                              variant={
                                tool.risk === "high"
                                  ? "destructive"
                                  : tool.risk === "medium"
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {riskLabels[tool.risk]}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {tool.description}
                          </p>
                        </div>
                        <div className="flex justify-center">
                          <Switch
                            aria-label={`启用 ${selectedAgent.name} 的 ${tool.label}`}
                            checked={policy.enabled}
                            size="sm"
                            onCheckedChange={(checked) =>
                              void updatePermission(selectedAgent, tool.name, {
                                enabled: checked,
                              })
                            }
                          />
                        </div>
                        <div
                          className={cn(
                            "flex justify-center transition-opacity",
                            !policy.enabled && "opacity-55",
                          )}
                        >
                          <Switch
                            aria-label={`${selectedAgent.name} 的 ${tool.label} 需要审批`}
                            checked={policy.requireApproval}
                            disabled={!policy.enabled}
                            intent="warning"
                            size="sm"
                            onCheckedChange={(checked) =>
                              void updatePermission(selectedAgent, tool.name, {
                                requireApproval: checked,
                              })
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </section>
          ) : (
            <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
              暂无 Agent，请先在 Agents 中创建。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
