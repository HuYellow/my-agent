import {
  Cpu,
  FileDiff,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { useI18n } from "../i18n";

export type WorkbenchView = "conversation" | "plan" | "review" | "diff" | "runtime" | "terminal";

export function WorkspaceTabs({
  value,
  onChange,
  planCount,
  findingCount,
  changedFileCount,
  runtimeCount,
  terminalCount,
  diffDisabled,
}: {
  value: WorkbenchView;
  onChange: (value: WorkbenchView) => void;
  planCount?: number;
  findingCount?: number;
  changedFileCount?: number;
  runtimeCount?: number;
  terminalCount?: number;
  diffDisabled?: boolean;
}) {
  const { t } = useI18n();
  const tabs: Array<{
    id: WorkbenchView;
    label: string;
    icon: typeof MessageSquareText;
    count?: number;
    disabled?: boolean;
  }> = [
    { id: "conversation", label: t("workbench.conversation"), icon: MessageSquareText },
    { id: "plan", label: t("workbench.plan"), icon: ListChecks, count: planCount },
    { id: "review", label: t("workbench.review"), icon: ShieldCheck, count: findingCount },
    { id: "diff", label: t("workbench.diff"), icon: FileDiff, count: changedFileCount, disabled: diffDisabled },
    { id: "runtime", label: t("workbench.runtime"), icon: Cpu, count: runtimeCount },
    { id: "terminal", label: t("workbench.terminal"), icon: TerminalSquare, count: terminalCount },
  ];

  return (
    <div className="workspace-toggle" role="tablist" aria-label="Thread workspace">
      {tabs.map(({ id, label, icon: Icon, count, disabled }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          aria-label={label}
          className={`workspace-toggle__button ${value === id ? "workspace-toggle__button--active" : ""}`}
          onClick={() => onChange(id)}
          disabled={disabled}
          title={label}
        >
          <Icon size={14} />
          <span>{label}</span>
          {typeof count === "number" && count > 0 && <span className="workspace-toggle__badge">{count}</span>}
        </button>
      ))}
    </div>
  );
}
