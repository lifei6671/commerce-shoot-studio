import { Bell, Folder, HardDrive, Layers3, Play, RotateCcw, Save, Settings2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../../shared/ui/button";
import { cn } from "../../../shared/lib/cn";
import { SelectPill } from "../../../shared/ui/select-pill";
import { type NotificationSoundId, playNotificationSound } from "../lib/notificationSound";

type SettingsState = {
  autoCreateDateFolders: boolean;
  launchAtLogin: boolean;
  minimizeToTrayOnClose: boolean;
  notificationSound: NotificationSoundId;
  outputDirectory: string;
  restoreWorkspaceOnLaunch: boolean;
  showFailureNotifications: boolean;
  showSystemNotifications: boolean;
  showTaskDoneNotifications: boolean;
  retainGenerationHistory: boolean;
};

const defaultSettings: SettingsState = {
  autoCreateDateFolders: true,
  launchAtLogin: true,
  minimizeToTrayOnClose: true,
  notificationSound: "clear",
  outputDirectory: "/Users/demo/Documents/商拍工坊/outputs",
  restoreWorkspaceOnLaunch: true,
  retainGenerationHistory: true,
  showFailureNotifications: true,
  showSystemNotifications: true,
  showTaskDoneNotifications: true,
};

export function SettingsPage() {
  const [settings, setSettings] = useState(defaultSettings);
  const [saved, setSaved] = useState(true);

  function updateSettings(patch: Partial<SettingsState>) {
    setSettings((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  function restoreDefaults() {
    setSettings(defaultSettings);
    setSaved(false);
  }

  function saveSettings() {
    setSaved(true);
  }

  return (
    <main
      aria-label="设置"
      className="relative min-h-0 overflow-hidden bg-[radial-gradient(circle_at_52%_0%,rgba(255,255,255,0.98),rgba(247,250,255,0.9)_46%,rgba(240,244,250,0.82))]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-7 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.55)_transparent]">
          <header>
            <h1 className="text-[24px] font-semibold tracking-normal text-slate-950">设置</h1>
            <p className="mt-2 text-[13px] text-slate-500">配置应用偏好、存储位置与提醒方式</p>
          </header>

          <div className="mt-6 space-y-3.5 pb-4">
            <SettingsSection
              description="应用启动与运行相关选项"
              icon={<Settings2 className="size-5" />}
              title="通用设置"
            >
              <SettingsRows>
                <SettingsRow>
                  <ToggleSetting
                    checked={settings.launchAtLogin}
                    description="系统登录时自动启动商拍工坊"
                    label="开机自动启动"
                    onChange={(checked) => updateSettings({ launchAtLogin: checked })}
                  />
                  <ToggleSetting
                    checked={settings.minimizeToTrayOnClose}
                    description="避免任务中断，继续在后台运行"
                    label="关闭窗口时最小化到系统托盘"
                    onChange={(checked) => updateSettings({ minimizeToTrayOnClose: checked })}
                  />
                </SettingsRow>
                <SettingsRow data-testid="general-settings-restore-row" columns={1}>
                  <ToggleSetting
                    checked={settings.restoreWorkspaceOnLaunch}
                    description="重新打开应用时恢复上次的任务与设置"
                    label="启动时恢复上次工作内容"
                    onChange={(checked) => updateSettings({ restoreWorkspaceOnLaunch: checked })}
                  />
                </SettingsRow>
              </SettingsRows>
            </SettingsSection>

            <SettingsSection
              description="数据保存位置与输出选项"
              icon={<Folder className="size-5" />}
              title="存储与输出"
            >
              <div className="grid grid-cols-[110px_minmax(0,1fr)_92px_92px] items-center gap-3 border-b border-slate-200/60 px-5 py-3.5">
                <div className="text-[13px] font-semibold text-slate-900">数据保存目录</div>
                <input
                  aria-label="数据保存目录"
                  className="h-9 min-w-0 rounded-[11px] border border-slate-200/90 bg-white/78 px-3 text-[13px] text-slate-700 outline-none shadow-[inset_0_1px_2px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.9)]"
                  onChange={(event) => updateSettings({ outputDirectory: event.target.value })}
                  value={settings.outputDirectory}
                />
                <Button className="justify-center bg-slate-950 text-white hover:bg-slate-900" size="sm">
                  选择目录
                </Button>
                <Button className="justify-center" size="sm" variant="soft">
                  打开文件夹
                </Button>
              </div>
              <SettingsRows>
                <SettingsRow>
                  <ToggleSetting
                    checked={settings.autoCreateDateFolders}
                    description="按年 / 月 / 日自动分类保存输出结果"
                    label="自动按日期创建子目录"
                    onChange={(checked) => updateSettings({ autoCreateDateFolders: checked })}
                  />
                  <ToggleSetting
                    checked={settings.retainGenerationHistory}
                    description="保存历史记录，便于管理和再次使用"
                    label="保留生成历史"
                    onChange={(checked) => updateSettings({ retainGenerationHistory: checked })}
                  />
                </SettingsRow>
              </SettingsRows>
              <div className="grid grid-cols-[170px_1fr] items-center gap-5 border-t border-slate-200/60 px-5 py-3.5 text-[13px] text-slate-500">
                <div className="flex items-center gap-2 font-medium text-slate-700">
                  <HardDrive className="size-4 text-slate-500" />
                  存储空间使用情况
                </div>
                <div className="grid grid-cols-[auto_auto_auto_1fr_auto] items-center gap-3">
                  <span>已使用 45.6 GB</span>
                  <span>·</span>
                  <span>可用 954.4 GB</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full w-[4%] rounded-full bg-app-blue" />
                  </div>
                  <span>4%</span>
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              description="任务完成与系统通知设置"
              icon={<Bell className="size-5" />}
              title="提醒与通知"
            >
              <SettingsRows>
                <SettingsRow>
                  <ToggleSetting
                    checked={settings.showTaskDoneNotifications}
                    description="任务完成后显示通知"
                    label="任务完成时提醒"
                    onChange={(checked) => updateSettings({ showTaskDoneNotifications: checked })}
                  />
                  <SystemNotificationSetting
                    checked={settings.showSystemNotifications}
                    onChange={(checked) => updateSettings({ showSystemNotifications: checked })}
                  />
                </SettingsRow>
                <SettingsRow>
                  <SoundSetting
                    notificationSound={settings.notificationSound}
                    onChange={(notificationSound) => updateSettings({ notificationSound })}
                  />
                  <ToggleSetting
                    checked={settings.showFailureNotifications}
                    description="任务失败时及时提醒"
                    label="失败任务提醒"
                    onChange={(checked) => updateSettings({ showFailureNotifications: checked })}
                  />
                </SettingsRow>
              </SettingsRows>
            </SettingsSection>

            <SettingsSection
              description="管理缓存文件与临时数据"
              icon={<Layers3 className="size-5" />}
              title="缓存与清理"
            >
              <div className="grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)] gap-6 px-5 py-3.5">
                <div className="grid grid-cols-3 overflow-hidden rounded-[14px] bg-slate-100/70 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                  <CacheStat label="缩略图缓存" value="328 MB" />
                  <CacheStat label="临时文件" value="1.2 GB" />
                  <CacheStat label="日志文件" value="42 MB" />
                </div>
                <div className="grid grid-cols-3 items-center gap-3">
                  <Button className="justify-center border-blue-200 text-app-blue" size="sm" variant="soft">
                    清理缓存
                  </Button>
                  <Button className="justify-center border-blue-200 text-app-blue" size="sm" variant="soft">
                    清理临时文件
                  </Button>
                  <Button className="justify-center border-red-200 text-red-500" size="sm" variant="soft">
                    清空全部缓存
                  </Button>
                </div>
              </div>
              <p className="border-t border-slate-200/60 px-5 py-2.5 text-[12px] text-slate-500">
                清理后不会影响已保存的成品图片，但无法恢复已清理的缓存文件。
              </p>
            </SettingsSection>
          </div>
        </div>

        <footer className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t border-slate-200/70 bg-white/76 px-8 py-4 backdrop-blur-2xl">
          <div className="flex items-center gap-4">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[12px] font-medium",
                saved ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
              )}
            >
              {saved ? "已自动保存" : "有未保存更改"}
            </span>
            <span className="text-[12px] text-slate-500">版本 1.2.0</span>
          </div>
          <Button className="justify-center" onClick={restoreDefaults} size="md" variant="soft">
            <RotateCcw className="size-3.5" />
            恢复默认设置
          </Button>
          <Button
            className="min-w-44 justify-center border-slate-950/10 bg-slate-950 text-white hover:bg-slate-900"
            onClick={saveSettings}
            size="md"
          >
            <Save className="size-3.5" />
            保存设置
          </Button>
        </footer>
      </div>
    </main>
  );
}

function SettingsSection({
  children,
  description,
  icon,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section className="grid grid-cols-[270px_minmax(0,1fr)] overflow-hidden rounded-[16px] border border-slate-200/70 bg-white/66 shadow-[0_12px_32px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl">
      <div className="flex gap-4 border-r border-slate-200/60 px-5 py-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-[15px] bg-blue-50/90 text-app-blue shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">{icon}</div>
        <div>
          <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
          <p className="mt-1.5 text-[12px] leading-5 text-slate-500">{description}</p>
        </div>
      </div>
      <div className="min-w-0 divide-y divide-slate-200/70">{children}</div>
    </section>
  );
}

function SettingsRows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-slate-200/60">{children}</div>;
}

function SettingsRow({
  children,
  columns = 2,
  "data-testid": testId,
}: {
  children: ReactNode;
  columns?: 1 | 2;
  "data-testid"?: string;
}) {
  return (
    <div
      className={cn("grid", columns === 1 ? "grid-cols-1" : "grid-cols-2 divide-x divide-slate-200/60")}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

function ToggleSetting({
  checked,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-2.5">
      <div>
        <div className="text-[13px] font-semibold text-slate-900">{label}</div>
        <p className="mt-1 text-[12px] text-slate-500">{description}</p>
      </div>
      <ToggleSwitch checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

function SystemNotificationSetting({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-2.5">
      <div>
        <div className="text-[13px] font-semibold text-slate-900">系统通知</div>
        <p className="mt-1 text-[12px] text-slate-500">通过系统通知中心发送消息</p>
      </div>
      <div className="flex items-center gap-3">
        <ToggleSwitch checked={checked} label="系统通知" onChange={onChange} />
        <span className="rounded-[10px] bg-emerald-50/90 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
          已允许通知权限
        </span>
      </div>
    </div>
  );
}

function SoundSetting({
  notificationSound,
  onChange,
}: {
  notificationSound: NotificationSoundId;
  onChange: (notificationSound: NotificationSoundId) => void;
}) {
  return (
    <div className="grid min-h-[64px] grid-cols-[minmax(0,1fr)_230px] items-center gap-4 px-5 py-2.5">
      <div>
        <div className="text-[13px] font-semibold text-slate-900">提示音</div>
        <p className="mt-1 text-[12px] text-slate-500">任务完成或失败时播放提示音</p>
      </div>
      <div className="grid grid-cols-[1fr_36px] gap-2">
        <SelectPill
          ariaLabel="提示音"
          onChange={(value) => onChange(value as NotificationSoundId)}
          options={[
            { label: "清脆音效", value: "clear" },
            { label: "柔和音效", value: "soft" },
            { label: "完成音效", value: "success" },
          ]}
          value={notificationSound}
        />
        <button
          aria-label="试听提示音"
          className="grid size-9 place-items-center rounded-[11px] border border-slate-200/90 bg-white/82 text-slate-900 shadow-control transition hover:bg-white active:scale-95"
          onClick={() => void playNotificationSound(notificationSound)}
          type="button"
        >
          <Play className="size-4 fill-slate-900" />
        </button>
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className={cn(
        "relative h-[18px] w-[34px] shrink-0 rounded-full border border-transparent transition-colors duration-200 shadow-[inset_0_1px_2px_rgba(15,23,42,0.12),0_1px_2px_rgba(15,23,42,0.08)]",
        checked ? "bg-app-blue" : "bg-slate-300/80",
      )}
      onClick={() => onChange(!checked)}
      type="button"
    >
      <span
        className={cn(
          "absolute left-0.5 top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(15,23,42,0.25)] transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

function CacheStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-slate-200/60 px-4 py-3 last:border-r-0">
      <div className="text-[12px] text-slate-500">{label}</div>
      <div className="mt-1 text-[18px] font-semibold text-slate-950">{value}</div>
    </div>
  );
}
