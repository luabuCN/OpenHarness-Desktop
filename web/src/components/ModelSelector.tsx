import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import type { ModelSelection, ProviderInfo } from "@/api";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ProviderIcon } from "@/components/ProviderIcon";

/**
 * The first enabled model of the first active provider — used as the default
 * selection when the user has not picked a model explicitly.
 */
export function defaultModelSelection(providers: ProviderInfo[]): ModelSelection | null {
  for (const provider of providers) {
    if (!provider.isActive) continue;
    const first = provider.models.find((model) => model.enabled);
    if (first) return { providerId: provider.id, modelId: first.id };
  }
  return null;
}

interface ModelSelectorProps {
  providers: ProviderInfo[];
  value: ModelSelection | null;
  onChange: (selection: ModelSelection) => void;
}

export function ModelSelector({ providers, value, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(
    () =>
      providers
        .filter((provider) => provider.isActive)
        .map((provider) => ({
          provider,
          models: provider.models.filter((model) => model.enabled),
        }))
        .filter((group) => group.models.length > 0),
    [providers],
  );

  const fallback = useMemo(() => defaultModelSelection(providers), [providers]);

  const valueStillValid =
    !!value &&
    groups.some(
      (group) =>
        group.provider.id === value.providerId &&
        group.models.some((model) => model.id === value.modelId),
    );
  const effective = valueStillValid ? value : fallback;

  const effectiveProvider = providers.find((provider) => provider.id === effective?.providerId);
  const effectiveModel = effectiveProvider?.models.find((model) => model.id === effective?.modelId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        className="flex h-8 max-w-52 items-center gap-1.5 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
        onClick={() => setOpen(true)}
        title="选择模型"
      >
        {effectiveProvider ? (
          <ProviderIcon type={effectiveProvider.type} size={14} />
        ) : null}
        <span className="truncate">{effectiveModel?.name ?? "选择模型"}</span>
      </button>

      <DialogContent className="max-w-md gap-0 overflow-hidden p-0" showCloseButton>
        <DialogTitle className="sr-only">选择模型</DialogTitle>
        <Command className="**:data-[slot=command-input-wrapper]:h-auto">
          <CommandInput placeholder="搜索模型..." className="py-3.5" />
          <CommandList className="max-h-80">
            <CommandEmpty>无匹配模型</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.provider.id} heading={group.provider.name}>
                {group.models.map((model) => {
                  const selected =
                    effective?.providerId === group.provider.id &&
                    effective?.modelId === model.id;
                  return (
                    <CommandItem
                      key={`${group.provider.id}/${model.id}`}
                      value={`${group.provider.name} ${group.provider.type} ${model.name} ${model.id}`}
                      onSelect={() => {
                        onChange({ providerId: group.provider.id, modelId: model.id });
                        setOpen(false);
                      }}
                    >
                      <ProviderIcon type={group.provider.type} size={16} />
                      <span className="flex-1 truncate">{model.name}</span>
                      {selected ? <Check size={14} /> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
