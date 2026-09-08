import type { Theme } from "../theme";

type ThemeToggleProps = {
  theme: Theme;
  onToggle: () => void;
};

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 15.4A8.5 8.5 0 0 1 8.6 4a8.5 8.5 0 1 0 11.4 11.4Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2m15.7-6.5-1.4 1.4M6.3 17.7l-1.4 1.4m0-13.6 1.4 1.4m11.4 11.4 1.4 1.4" />
    </svg>
  );
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const nextTheme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      aria-label={`Switch to ${nextTheme} mode`}
      onClick={onToggle}
    >
      {theme === "light" ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}
