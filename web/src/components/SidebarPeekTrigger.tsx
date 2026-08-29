import { PanelLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * 侧边栏开关：点击展开/收起。
 */
export function SidebarPeekTrigger({ className }: { className?: string }) {
  const { isMobile, open, setOpen, openMobile, setOpenMobile } = useSidebar();

  return (
    <Button
      data-slot="sidebar-peek-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn("shrink-0", className)}
      title={open ? "收起侧边栏" : "展开侧边栏"}
      aria-label={open ? "收起侧边栏" : "展开侧边栏"}
      onClick={() => {
        if (isMobile) setOpenMobile(!openMobile);
        else setOpen(!open);
      }}
    >
      <PanelLeftIcon className="size-4" />
    </Button>
  );
}
