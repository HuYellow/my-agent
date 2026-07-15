import { CircleAlert, CircleCheck, LoaderCircle, PauseCircle, ShieldAlert } from "lucide-react";
import type { RuntimeRunRecord } from "@my-agent/protocol";
import { useI18n } from "../i18n";

export function RunStatusBar({ run, onRetry }: { run?: RuntimeRunRecord | null; onRetry?: () => void }) {
  const { t } = useI18n();
  if (!run) {
    return null;
  }

  const Icon = run.status === "completed" ? CircleCheck : run.status === "failed" ? CircleAlert : run.status === "awaiting_approval" ? ShieldAlert : run.status === "paused" ? PauseCircle : LoaderCircle;
  return (
    <div className={`run-status-bar run-status-bar--${run.status}`} role="status">
      <Icon size={14} className={run.status === "running" || run.status === "queued" ? "run-status-bar__spin" : undefined} />
      <strong>{t(`run.${run.status}`)}</strong>
      <span>{run.title}</span>
      {run.error && <small title={run.error}>{run.error}</small>}
      {onRetry && <button type="button" className="run-status-bar__retry" onClick={onRetry}>{t("action.retry")}</button>}
    </div>
  );
}
