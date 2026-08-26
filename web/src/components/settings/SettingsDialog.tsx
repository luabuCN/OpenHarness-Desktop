import { Cloud } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ProvidersSection } from "./ProvidersSection";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}

export function SettingsDialog({ open, onOpenChange, onChanged }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b p-4">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <div className="grid h-[62vh] grid-cols-[168px_minmax(0,1fr)]">
          <nav className="space-y-1 border-r p-2">
            <span className="flex w-full items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground">
              <Cloud size={16} />
              模型供应商
            </span>
          </nav>
          <div className="overflow-y-auto p-4">
            <ProvidersSection onChanged={onChanged} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
