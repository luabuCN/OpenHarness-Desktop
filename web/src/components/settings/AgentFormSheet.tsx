import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  createAgent,
  updateAgent,
  type AgentInfo,
  type ProviderInfo,
  type SubAgentInfo,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
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

const NONE_MODEL = "__none__";

interface AgentFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: AgentInfo | null;
  providers: ProviderInfo[];
  onSaved: () => void;
}

export function AgentFormSheet({
  open,
  onOpenChange,
  initial,
  providers,
  onSaved,
}: AgentFormSheetProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [subAgentsText, setSubAgentsText] = useState("[]");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setInstructions(initial?.instructions ?? "");
    setIsActive(initial?.isActive ?? true);
    setProviderId(initial?.defaultProviderId ?? "");
    setModelId(initial?.defaultModelId ?? "");
    setSubAgentsText(initial ? JSON.stringify(initial.subAgents, null, 2) : "[]");
    setError(undefined);
  }, [initial, open]);

  const activeProviders = providers.filter((provider) => provider.isActive);
  const selectedProvider = activeProviders.find((provider) => provider.id === providerId);

  function selectProvider(next: string) {
    setProviderId(next === NONE_MODEL ? "" : next);
    setModelId("");
  }

  async function save() {
    if (!name.trim() || !description.trim() || !instructions.trim()) {
      setError("名称、描述和指令为必填项");
      return;
    }

    let subAgents: SubAgentInfo[];
    try {
      const parsed = JSON.parse(subAgentsText) as unknown;
      if (!Array.isArray(parsed)) throw new Error("子 Agent 必须是 JSON 数组");
      subAgents = parsed as SubAgentInfo[];
    } catch (cause) {
      setError(cause instanceof Error ? `子 Agent JSON 无效：${cause.message}` : "子 Agent JSON 无效");
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        instructions: instructions.trim(),
        isActive,
        subAgents,
        defaultProviderId: providerId || null,
        defaultModelId: providerId ? modelId || null : null,
      };
      if (initial) await updateAgent(initial.id, payload);
      else await createAgent(payload);
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="min-w-[640px]">
        <SheetHeader>
          <SheetTitle>{initial ? "编辑 Agent" : "创建 Agent"}</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="agent-name">名称</FieldLabel>
              <Input id="agent-name" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="agent-description">描述</FieldLabel>
              <Input
                id="agent-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="agent-instructions">系统指令</FieldLabel>
              <Textarea
                id="agent-instructions"
                className="min-h-40"
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>默认模型</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select value={providerId || NONE_MODEL} onValueChange={selectProvider}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_MODEL}>跟随项目或全局</SelectItem>
                    {activeProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={modelId || NONE_MODEL}
                  onValueChange={(next) => setModelId(next === NONE_MODEL ? "" : next)}
                  disabled={!providerId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE_MODEL}>跟随项目或全局</SelectItem>
                    <SelectGroup>
                      {(selectedProvider?.models ?? [])
                        .filter((model) => model.enabled)
                        .map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="agent-subagents">子 Agent</FieldLabel>
              <Textarea
                id="agent-subagents"
                className="min-h-48 font-mono text-xs"
                value={subAgentsText}
                onChange={(event) => setSubAgentsText(event.target.value)}
              />
              <FieldDescription>
                JSON 数组；每个子 Agent 包含 id、name、description 和 instructions。
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel>启用</FieldLabel>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </Field>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
  );
}
