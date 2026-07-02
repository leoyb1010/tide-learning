"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * 模式与字号 Provider — 为长辈模式（P2）预留 fontScale / density / mode 参数（§17 设计要求 6）。
 * 标准模式默认；用户可切换 elder 模式，放大字号、降噪。持久化到 localStorage。
 */
type Mode = "standard" | "elder";

interface ModeState {
  mode: Mode;
  fontScale: number;
  setMode: (m: Mode) => void;
  setFontScale: (n: number) => void;
}

const ModeCtx = createContext<ModeState | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>("standard");
  const [fontScale, setFontScaleState] = useState(1);

  useEffect(() => {
    const savedMode = (localStorage.getItem("tide_mode") as Mode) || "standard";
    const savedScale = Number(localStorage.getItem("tide_font_scale")) || 1;
    setModeState(savedMode);
    setFontScaleState(savedScale);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
  }, [mode, fontScale]);

  const setMode = (m: Mode) => {
    setModeState(m);
    localStorage.setItem("tide_mode", m);
  };
  const setFontScale = (n: number) => {
    setFontScaleState(n);
    localStorage.setItem("tide_font_scale", String(n));
  };

  return <ModeCtx.Provider value={{ mode, fontScale, setMode, setFontScale }}>{children}</ModeCtx.Provider>;
}

export function useMode() {
  const ctx = useContext(ModeCtx);
  if (!ctx) throw new Error("useMode must be inside ModeProvider");
  return ctx;
}
