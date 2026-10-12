import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "usos-theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#101113" : "#ffffff");
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* Theme still works when storage is unavailable. */
    }
  }, [theme]);
  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY)
        setTheme(event.newValue === "dark" ? "dark" : "light");
    };
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, []);
  return {
    theme,
    toggleTheme: () =>
      setTheme((value) => (value === "dark" ? "light" : "dark")),
  };
}
