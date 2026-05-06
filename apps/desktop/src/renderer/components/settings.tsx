import type { ReactNode } from "react";

export function SettingsNavItem<TCategory extends string>({
  icon,
  label,
  category,
  activeCategory,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  category: TCategory;
  activeCategory: TCategory;
  onClick: (category: TCategory) => void;
}) {
  return (
    <button
      className={`settings-nav-item ${category === activeCategory ? "settings-nav-item--active" : ""}`}
      onClick={() => onClick(category)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
