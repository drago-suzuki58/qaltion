export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "qaltion-theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark";
}

export function getInitialTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (isTheme(stored)) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#18191b" : "#eeede7");
}
