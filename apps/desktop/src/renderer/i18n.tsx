import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "zh-CN" | "en-US";

const messages: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    "nav.newThread": "新对话",
    "nav.search": "搜索",
    "nav.skills": "技能",
    "nav.plugins": "插件",
    "nav.automation": "自动化",
    "nav.settings": "设置",
    "workbench.conversation": "对话",
    "workbench.plan": "计划",
    "workbench.review": "评审",
    "workbench.diff": "变更",
    "workbench.runtime": "运行",
    "workbench.terminal": "终端",
    "run.queued": "排队中",
    "run.running": "执行中",
    "run.awaiting_approval": "等待审批",
    "run.paused": "已暂停",
    "run.completed": "已完成",
    "run.failed": "失败",
    "run.cancelled": "已取消",
    "action.retry": "重试",
    "action.switchLanguage": "切换界面语言",
  },
  "en-US": {
    "nav.newThread": "New task",
    "nav.search": "Search",
    "nav.skills": "Skills",
    "nav.plugins": "Plugins",
    "nav.automation": "Automations",
    "nav.settings": "Settings",
    "workbench.conversation": "Chat",
    "workbench.plan": "Plan",
    "workbench.review": "Review",
    "workbench.diff": "Changes",
    "workbench.runtime": "Runtime",
    "workbench.terminal": "Terminal",
    "run.queued": "Queued",
    "run.running": "Running",
    "run.awaiting_approval": "Approval required",
    "run.paused": "Paused",
    "run.completed": "Completed",
    "run.failed": "Failed",
    "run.cancelled": "Cancelled",
    "action.retry": "Retry",
    "action.switchLanguage": "Switch interface language",
  },
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const stored = window.localStorage.getItem("my-agent-locale");
    return stored === "en-US" || stored === "zh-CN" ? stored : "zh-CN";
  });

  useEffect(() => {
    window.localStorage.setItem("my-agent-locale", locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key) => messages[locale][key] ?? key,
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  return value ?? {
    locale: "zh-CN",
    setLocale: () => undefined,
    t: (key: string) => messages["zh-CN"][key] ?? key,
  };
}
