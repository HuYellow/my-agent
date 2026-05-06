export function PlaceholderPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="sidebar-secondary__content">
      <div className="sidebar-secondary__header">
        <h2>{title}</h2>
      </div>
      <div className="sidebar-secondary__empty">
        <p>{description}</p>
      </div>
    </div>
  );
}

export function LoadingShell() {
  return (
    <div className="app-shell app-shell--loading">
      <header className="app-toolbar" />
      <div className="app-container app-container--loading">
        <aside className="sidebar sidebar--loading" />
        <main className="main-content main-content--loading" />
      </div>
      <div className="startup-state">
        <div className="startup-state__title">正在启动 my-agent</div>
        <div className="startup-state__body">正在载入桌面工作台并连接本地运行时...</div>
      </div>
    </div>
  );
}

export function StartupErrorShell({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="app-shell app-shell--loading">
      <header className="app-toolbar" />
      <div className="startup-state startup-state--error">
        <div className="startup-state__title">my-agent 启动失败</div>
        <div className="startup-state__body">{message}</div>
        <button type="button" className="button" onClick={onRetry}>
          重试
        </button>
      </div>
    </div>
  );
}
