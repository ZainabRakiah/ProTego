import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        safe: "border-transparent bg-[color-mix(in_oklab,var(--safe)_18%,transparent)] text-[var(--safe)]",
        caution:
          "border-transparent bg-[color-mix(in_oklab,var(--caution)_18%,transparent)] text-[var(--caution)]",
        risk: "border-transparent bg-[color-mix(in_oklab,var(--risk)_18%,transparent)] text-[var(--risk)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
