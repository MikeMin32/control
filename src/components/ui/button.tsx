import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-mint text-mint-text hover:bg-mint-strong border border-transparent shadow-soft",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-sidebar",
  ghost: "bg-transparent text-ink hover:bg-sidebar border border-transparent",
  danger:
    "bg-[#fce8e8] text-[#8a3030] border border-[#f0d0d0] hover:bg-[#f8dede]",
  outline:
    "bg-surface text-ink border border-line-strong hover:bg-sidebar",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-3.5 text-sm",
  icon: "h-9 w-9 p-0",
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
