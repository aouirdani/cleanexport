import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A native `<input type="checkbox">` styled to look like a switch, via the
 * `peer` + `peer-checked:` Tailwind pattern - no @base-ui/react Switch
 * needed for something this simple, and a native checkbox input is
 * keyboard-operable (Tab, Space) and screen-reader-announced for free.
 */
function Switch({
  className,
  checked,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "onChange"> & {
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <span className={cn("relative inline-flex h-5 w-9 shrink-0 items-center", className)}>
      <input
        type="checkbox"
        role="switch"
        data-slot="switch"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none rounded-full border border-input bg-input/50 outline-none transition-colors checked:border-primary checked:bg-primary focus-visible:ring-3 focus-visible:ring-ring/50"
        {...props}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-0.5 size-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-4"
      />
    </span>
  )
}

export { Switch }
