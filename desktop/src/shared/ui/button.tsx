import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-control text-[13px] font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-blue/35 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100",
  {
    variants: {
      variant: {
        ghost: "bg-transparent text-app-text hover:bg-white/60 hover:shadow-control",
        soft:
          "border border-white/70 bg-white/80 text-app-text shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_1px_2px_rgba(15,23,42,0.08)] hover:bg-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_5px_14px_rgba(15,23,42,0.08)]",
        softBlue:
          "border border-blue-100/80 bg-blue-50/80 text-app-blue shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] hover:border-blue-200 hover:bg-blue-100/70",
      },
      size: {
        xs: "h-7 px-2",
        sm: "h-8 px-3",
        md: "h-9 px-4",
      },
    },
    defaultVariants: {
      variant: "soft",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);

Button.displayName = "Button";
