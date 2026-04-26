import type { ReactNode } from "react";

export function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-button ${active ? "nav-button--active" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <span className="nav-button__icon">{icon}</span>
      <span className="nav-button__label">{label}</span>
    </button>
  );
}
