import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Switch({
  className,
  intent = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  intent?: "default" | "warning";
  size?: "default" | "sm";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex shrink-0 items-center rounded-full border transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45",
        "data-[state=unchecked]:border-border/80 data-[state=unchecked]:bg-input/85 data-[state=unchecked]:shadow-xs",
        className,
        intent === "default" &&
          "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:shadow-sm",
        intent === "warning" &&
          "data-[state=checked]:border-amber-600 data-[state=checked]:bg-amber-600 data-[state=checked]:shadow-sm dark:data-[state=checked]:border-amber-500 dark:data-[state=checked]:bg-amber-500",
        size === "default" ? "h-[1.375rem] w-[2.375rem]" : "h-[1.125rem] w-[1.875rem]",
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full border border-black/10 bg-card shadow-sm transition-transform duration-200 will-change-transform data-[state=unchecked]:translate-x-0.5 dark:data-[state=unchecked]:border-white/10 dark:data-[state=unchecked]:bg-muted-foreground/90",
          size === "default"
            ? "size-[1.125rem] data-[state=checked]:translate-x-[0.875rem]"
            : "size-[0.875rem] data-[state=checked]:translate-x-[0.625rem]",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
