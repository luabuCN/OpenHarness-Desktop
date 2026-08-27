import { useState } from "react";
import { ArrowLeft, Cloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { ProvidersSection } from "./ProvidersSection";

type SettingsSectionKey = "providers";

const NAV_ITEMS: {
  key: SettingsSectionKey;
  label: string;
  icon: typeof Cloud;
}[] = [{ key: "providers", label: "模型供应商", icon: Cloud }];

interface SettingsPageProps {
  onExit: () => void;
  onChanged?: () => void;
}

export function SettingsPage({ onExit, onChanged }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSectionKey>("providers");
  const active = NAV_ITEMS.find((item) => item.key === section) ?? NAV_ITEMS[0];

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Button variant="ghost" size="icon-sm" onClick={onExit} title="返回">
          <ArrowLeft size={16} />
        </Button>
        <Separator orientation="vertical" className="h-4!" />
        <span className="truncate text-sm text-muted-foreground">{active.label}</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="h-full w-48 shrink-0 overflow-y-auto border-r p-4">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  aria-current={section === item.key ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-muted",
                    section === item.key &&
                      "bg-accent text-accent-foreground hover:bg-accent",
                  )}
                  onClick={() => setSection(item.key)}
                >
                  <item.icon size={16} />
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto">
          <ProvidersSection onChanged={onChanged} />
        </div>
      </div>
    </section>
  );
}
