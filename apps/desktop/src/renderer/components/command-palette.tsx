import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { FolderGit2, MessageSquareText, Search, X } from "lucide-react";
import type { ProjectRecord, ThreadRecord } from "@my-agent/protocol";
import type { Locale } from "../i18n";

export function CommandPalette({
  open,
  onOpenChange,
  threads,
  projects,
  locale,
  onSelectThread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threads: ThreadRecord[];
  projects: ProjectRecord[];
  locale: Locale;
  onSelectThread: (threadId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return threads
      .filter((thread) => !normalized || thread.title.toLowerCase().includes(normalized) || projects.find((project) => project.id === thread.projectId)?.name.toLowerCase().includes(normalized))
      .slice(0, 12);
  }, [projects, query, threads]);

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
      onOpenChange(next);
      if (!next) setQuery("");
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay command-palette__overlay" />
        <Dialog.Content className="command-palette">
          <Dialog.Title className="command-palette__title">
            {locale === "zh-CN" ? "搜索对话" : "Search conversations"}
          </Dialog.Title>
          <div className="command-palette__search">
            <Search size={16} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={locale === "zh-CN" ? "输入对话或项目名称" : "Search by conversation or project"}
            />
            <Dialog.Close aria-label="Close"><X size={15} /></Dialog.Close>
          </div>
          <div className="command-palette__results">
            {results.map((thread) => {
              const project = projects.find((entry) => entry.id === thread.projectId);
              return (
                <button key={thread.id} type="button" onClick={() => {
                  onSelectThread(thread.id);
                  onOpenChange(false);
                  setQuery("");
                }}>
                  <MessageSquareText size={15} />
                  <span><strong>{thread.title}</strong><small><FolderGit2 size={12} />{project?.name ?? thread.projectId}</small></span>
                </button>
              );
            })}
            {results.length === 0 && <p>{locale === "zh-CN" ? "没有匹配的对话" : "No matching conversations"}</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
