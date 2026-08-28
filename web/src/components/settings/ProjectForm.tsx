import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  createProject,
  listAgents,
  listProviders,
  updateProject,
  type AgentInfo,
  type ProjectInfo,
  type ProviderInfo,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const NONE = "__none__";

export interface ProjectFormProps {
  editing?: ProjectInfo | null;
  onSaved?: (project: ProjectInfo) => void;
  onCancel?: () => void;
}

export function ProjectForm({ editing = null, onSaved, onCancel }: ProjectFormProps) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [name, setName] = useState(editing?.name ?? "");
  const [rootPath, setRootPath] = useState(editing?.rootPath ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [agentId, setAgentId] = useState(editing?.defaultAgentId ?? "");
  const [providerId, setProviderId] = useState(editing?.defaultProviderId ?? "");
  const [modelId, setModelId] = useState(editing?.defaultModelId ?? "");
  const [isActive, setIsActive] = useState(editing?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listAgents(), listProviders()])
      .then(([nextAgents, nextProviders]) => {
        if (cancelled) return;
        setAgents(nextAgents);
        setProviders(nextProviders);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
      const project = editing
        ? await updateProject(editing.id, payload)
        : await createProject(payload);
      onSaved?.(project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const activeAgents = agents.filter((agent) => agent.isActive);
  const activeProviders = providers.filter((provider) => provider.isActive);

  return (
    <div className="flex flex-col gap-4">
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

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
        ) : null}
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          保存
        </Button>
      </div>
    </div>
  );
}
