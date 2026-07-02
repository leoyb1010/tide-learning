"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * 模式 / 字号 / 主题 Provider。
 * - mode：标准 / 长辈（§17 设计要求 6，放大字号降噪）
 * - theme：light / deep（B1.3 深海模式，学习页沉浸）
 * 持久化到 localStorage。
 */
type Mode = "standard" | "elder";
type Theme = "light" | "deep";

interface ModeState {
  mode: Mode;
  fontScale: number;
  theme: Theme;
  setMode: (m: Mode) => void;
  setFontScale: (n: number) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ModeCtx = createContext<ModeState | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>("standard");
  const [fontScale, setFontScaleState] = useState(1);
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const savedMode = (localStorage.getItem("tide_mode") as Mode) || "standard";
    const savedScale = Number(localStorage.getItem("tide_font_scale")) || 1;
    const savedTheme = (localStorage.getItem("tide_theme") as Theme) || "light";
    setModeState(savedMode);
    setFontScaleState(savedScale);
    setThemeState(savedTheme);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
  }, [mode, fontScale]);

  useEffect(() => {
    if (theme === "deep") document.documentElement.dataset.theme = "deep";
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  const setMode = (m: Mode) => { setModeState(m); localStorage.setItem("tide_mode", m); };
  const setFontScale = (n: number) => { setFontScaleState(n); localStorage.setItem("tide_font_scale", String(n)); };
  const setTheme = (t: Theme) => { setThemeState(t); localStorage.setItem("tide_theme", t); };
  const toggleTheme = () => setTheme(theme === "deep" ? "light" : "deep");

  return (
    <ModeCtx.Provider value={{ mode, fontScale, theme, setMode, setFontScale, setTheme, toggleTheme }}>
      {children}
    </ModeCtx.Provider>
  );
}

export function useMode() {
  const ctx = useContext(ModeCtx);
  if (!ctx) throw new Error("useMode must be inside ModeProvider");
  return ctx;
}
