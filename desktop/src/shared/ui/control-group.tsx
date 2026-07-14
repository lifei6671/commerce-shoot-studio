import type { ReactNode } from "react";

type ControlGroupProps = {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
};

export function ControlGroup({ title, hint, action, children }: ControlGroupProps) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h2 className="text-[13px] font-semibold text-slate-950">{title}</h2>
          {hint ? <span className="text-[11px] text-app-muted">{hint}</span> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
