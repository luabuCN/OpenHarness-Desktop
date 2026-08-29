import { useState } from "react";
import { ArrowLeft, Bot, Cloud, FolderOpen, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarPeekTrigger } from "@/components/SidebarPeekTrigger";
import { cn } from "@/lib/utils";
import { ProvidersSection } from "./ProvidersSection";
import { AgentsSection } from "./AgentsSection";
import { ProjectsSection } from "./ProjectsSection";
import { ToolsSection } from "./ToolsSection";

type SettingsSectionKey = "projects" | "agents" | "models" | "tools";

const NAV_ITEMS: {
  key: SettingsSectionKey;
  label: string;
  icon: typeof Cloud;
}[] = [
  { key: "projects", label: "项目", icon: FolderOpen },
  { key: "agents", label: "Agent", icon: Bot },
  { key: "models", label: "模型", icon: Cloud },
  { key: "tools", label: "工具", icon: Wrench },
];

interface SettingsPageProps {
  onExit: () => void;
  onChanged?: () => void;
}

export function SettingsPage({ onExit, onChanged }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSectionKey>("projects");
  const active = NAV_ITEMS.find((item) => item.key === section) ?? NAV_ITEMS[0];

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <SidebarPeekTrigger />
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
          {section === "projects" ? <ProjectsSection onChanged={onChanged} /> : null}
          {section === "agents" ? <AgentsSection onChanged={onChanged} /> : null}
          {section === "models" ? <ProvidersSection onChanged={onChanged} /> : null}
          {section === "tools" ? <ToolsSection /> : null}
        </div>
      </div>
    </section>
  );
}
