import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-mint text-mint-text hover:bg-mint-strong border border-transparent",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-sidebar",
  ghost: "bg-transparent text-ink hover:bg-sidebar border border-transparent",
  danger:
    "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100",
  outline:
    "bg-transparent text-ink border border-line-strong hover:bg-sidebar",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-3.5 text-sm",
  icon: "h-8 w-8 p-0",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: Size;
  }
>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-slate font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
