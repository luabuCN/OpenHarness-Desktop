import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import {
  createProject,
  deleteProject,
  listAgents,
  listProjects,
  listProviders,
  updateProject,
  type AgentInfo,
  type ProjectInfo,
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
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const NONE = "__none__";

interface ProjectsSectionProps {
  onChanged?: () => void;
}

export function ProjectsSection({ onChanged }: ProjectsSectionProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectInfo | null>(null);
  const [deleting, setDeleting] = useState<ProjectInfo | null>(null);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProjects, nextAgents, nextProviders] = await Promise.all([
        listProjects(),
        listAgents(),
        listProviders(),
      ]);
      setProjects(nextProjects);
      setAgents(nextAgents);
      setProviders(nextProviders);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载项目失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openForm(project: ProjectInfo | null) {
    setEditing(project);
    setName(project?.name ?? "");
    setRootPath(project?.rootPath ?? "");
    setDescription(project?.description ?? "");
    setAgentId(project?.defaultAgentId ?? "");
    setProviderId(project?.defaultProviderId ?? "");
    setModelId(project?.defaultModelId ?? "");
    setIsActive(project?.isActive ?? true);
    setError(undefined);
    setFormOpen(true);
  }

  async function save() {
    if (!name.trim() || !rootPath.trim()) {
      setError("项目名称和路径不能为空");
      return;
    }
    setSaving(true);
    setError(undefined);
    const payload = {
      name: name.trim(),
      rootPath: rootPath.trim(),
      description: description.trim() || undefined,
      defaultAgentId: agentId || null,
      defaultProviderId: providerId || null,
      defaultModelId: providerId ? modelId || null : null,
      isActive,
    };
    try {
      if (editing) await updateProject(editing.id, payload);
      else await createProject(payload);
      setFormOpen(false);
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(project: ProjectInfo, nextActive: boolean) {
    setProjects((current) =>
      current.map((entry) => (entry.id === project.id ? { ...entry, isActive: nextActive } : entry)),
    );
    try {
      await updateProject(project.id, { isActive: nextActive });
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
      await deleteProject(target.id);
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败");
    }
  }

  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const activeAgents = agents.filter((agent) => agent.isActive);
  const activeProviders = providers.filter((provider) => provider.isActive);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-4">
        <div className="text-base font-semibold">项目</div>
        <Button onClick={() => openForm(null)}>
          <Plus size={14} />
          添加
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
            {projects.map((project) => {
              const agent = agents.find((entry) => entry.id === project.defaultAgentId);
              const provider = providers.find((entry) => entry.id === project.defaultProviderId);
              const model = provider?.models.find((entry) => entry.id === project.defaultModelId);
              return (
                <Item variant="outline" key={project.id}>
                  <ItemContent>
                    <ItemTitle>
                      <FolderOpen size={16} />
                      <span>{project.name}</span>
                    </ItemTitle>
                    <p className="truncate text-xs text-muted-foreground">{project.rootPath}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent ? `Agent ${agent.name}` : "未设置默认 Agent"}
                      {model ? ` · ${provider?.name} / ${model.name}` : ""}
                    </p>
                  </ItemContent>
                  <ItemActions>
                    <Switch
                      checked={project.isActive}
                      onCheckedChange={(checked) => void toggleActive(project, !!checked)}
                    />
                    <Button variant="outline" size="icon-sm" title="编辑" onClick={() => openForm(project)}>
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      title="删除"
                      onClick={() => setDeleting(project)}
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

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent className="min-w-[600px]">
          <SheetHeader>
            <SheetTitle>{editing ? "编辑项目" : "添加项目"}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="project-name">名称</FieldLabel>
                <Input id="project-name" value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="project-root">本地路径</FieldLabel>
                <Input
                  id="project-root"
                  value={rootPath}
                  onChange={(event) => setRootPath(event.target.value)}
                  placeholder="E:\path\to\project"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="project-description">描述</FieldLabel>
                <Textarea
                  id="project-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>默认 Agent</FieldLabel>
                <Select value={agentId || NONE} onValueChange={(next) => setAgentId(next === NONE ? "" : next)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>全局默认</SelectItem>
                    {activeAgents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>默认模型</FieldLabel>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select
                    value={providerId || NONE}
                    onValueChange={(next) => {
                      setProviderId(next === NONE ? "" : next);
                      setModelId("");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择供应商" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>全局默认</SelectItem>
                      {activeProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={modelId || NONE}
                    onValueChange={(next) => setModelId(next === NONE ? "" : next)}
                    disabled={!providerId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value={NONE}>全局默认</SelectItem>
                      {(selectedProvider?.models ?? [])
                        .filter((model) => model.enabled)
                        .map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </Field>
              <Field orientation="horizontal">
                <FieldLabel>启用</FieldLabel>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </Field>
            </FieldGroup>
          </div>
          <SheetFooter className="mt-0 gap-2 p-4">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              保存
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除项目「{deleting?.name ?? ""}」？会话与运行记录会保留，但项目关联会被清空。
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
