import { useEffect, useState } from "react";
import { App } from "./App";
import { localWorkspacePort } from "../runtime/local/workspace";

type BootState =
  | { status: "initializing" }
  | { status: "ready" }
  | { message: string; status: "failed" };

let workspaceBootPromise: Promise<void> | null = null;

export function BootstrappedApp() {
  const [bootState, setBootState] = useState<BootState>({ status: "initializing" });

  useEffect(() => {
    let cancelled = false;

    async function initializeWorkspace() {
      try {
        await bootWorkspaceOnce();
        if (!cancelled) {
          setBootState({ status: "ready" });
        }
      } catch (error) {
        if (!cancelled) {
          setBootState({
            message: error instanceof Error ? error.message : "工作区初始化失败",
            status: "failed",
          });
        }
      }
    }

    void initializeWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

  if (bootState.status === "ready") {
    return <App />;
  }

  if (bootState.status === "failed") {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-white">
        <section className="w-[min(420px,calc(100vw-48px))] rounded-[8px] border border-red-400/40 bg-red-950/30 p-6">
          <h1 className="text-[18px] font-semibold">初始化失败</h1>
          <p className="mt-3 text-[13px] leading-6 text-red-100">{bootState.message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 text-white">
      <section
        aria-label="应用初始化状态"
        className="flex items-center gap-3 rounded-[8px] border border-white/10 bg-white/8 px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)]"
        role="status"
      >
        <span className="size-2.5 animate-pulse rounded-full bg-sky-300" />
        <div>
          <h1 className="text-[15px] font-semibold">正在初始化工作区</h1>
          <p className="mt-1 text-[12px] text-slate-300">准备本地目录、SQLite 和运行环境</p>
        </div>
      </section>
    </main>
  );
}

function bootWorkspaceOnce() {
  workspaceBootPromise ??= initializeWorkspace();
  return workspaceBootPromise;
}

async function initializeWorkspace() {
  const currentStatus = await localWorkspacePort.getWorkspaceStatus();
  if (currentStatus.initialized) {
    return;
  }

  if (!currentStatus.workspaceDirectory) {
    throw new Error("runtime 未返回默认工作区目录");
  }

  // 这里只做启动门禁：初始化本地 workspace 后进入默认商品页。
  // 目录切换、失败恢复入口等交互需要单独确认后再接。
  await localWorkspacePort.initializeWorkspace({
    workspaceDirectory: currentStatus.workspaceDirectory,
  });
}
