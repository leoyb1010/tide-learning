"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * 模式 / 字号 / 主题 Provider。
 * - mode：标准 / 长辈（放大字号降噪）
 * - colorScheme：system(跟随系统,默认) / light / dark —— STUDIO 亮暗切换
 * - theme：light / deep（学习页沉浸深海模式，独立于全站亮暗）
 * 持久化到 localStorage。
 */
type Mode = "standard" | "elder";
type Theme = "light" | "deep";
type ColorScheme = "system" | "light" | "dark";

interface ModeState {
  mode: Mode;
  fontScale: number;
  theme: Theme;
  colorScheme: ColorScheme;
  /** 实际生效的亮暗（system 解析后），供 UI 显示当前是亮还是暗 */
  resolvedDark: boolean;
  setMode: (m: Mode) => void;
  setFontScale: (n: number) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setColorScheme: (c: ColorScheme) => void;
  /** 三态循环：跟随系统 → 浅 → 深 → 跟随系统…（保证「跟随系统」始终可达） */
  cycleColorScheme: () => void;
}

const ModeCtx = createContext<ModeState | null>(null);

/**
 * initialMode/initialFontScale：服务端从登录用户 UserProfile 注入的偏好初值（P1-4）。
 * 未登录/无 profile 时为 standard/1。localStorage 作为「显式本机覆盖」优先于服务端初值；
 * 无 localStorage 时以服务端 profile 为准——银发用户首次登录（无本机记录）即自动生效大字模式。
 */
export function ModeProvider({
  children,
  initialMode = "standard",
  initialFontScale = 1,
}: {
  children: ReactNode;
  initialMode?: Mode;
  initialFontScale?: number;
}) {
  const [mode, setModeState] = useState<Mode>(initialMode);
  const [fontScale, setFontScaleState] = useState(initialFontScale);
  const [theme, setThemeState] = useState<Theme>("light");
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    // localStorage 存在即为本机显式选择，优先；否则回落服务端注入的 profile 初值（不写回 localStorage，
    // 保持服务端为真值源）。字号同理。
    const lsMode = localStorage.getItem("tide_mode") as Mode | null;
    const lsScale = Number(localStorage.getItem("tide_font_scale"));
    const savedMode: Mode = lsMode || initialMode;
    const savedScale = lsScale > 0 ? lsScale : initialFontScale;
    const savedTheme = (localStorage.getItem("tide_theme") as Theme) || "light";
    const savedCS = (localStorage.getItem("studio_color_scheme") as ColorScheme) || "system";
    setModeState(savedMode);
    setFontScaleState(savedScale);
    setThemeState(savedTheme);
    setColorSchemeState(savedCS);
    // 监听系统亮暗
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
    // initialMode/initialFontScale 在会话内稳定；纳入依赖以对齐 lint，实际只在挂载时读一次。
  }, [initialMode, initialFontScale]);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
  }, [mode, fontScale]);

  // 学习页深海模式：优先级最高，覆盖全站亮暗
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "deep") {
      el.dataset.theme = "deep";
      return;
    }
    // 非深海：按 colorScheme 设 data-theme。system → 移除让 CSS @media 接管；显式 → 强制。
    if (colorScheme === "system") delete el.dataset.theme;
    else el.dataset.theme = colorScheme; // "light" | "dark"
  }, [theme, colorScheme]);

  const setMode = (m: Mode) => { setModeState(m); localStorage.setItem("tide_mode", m); };
  const setFontScale = (n: number) => { setFontScaleState(n); localStorage.setItem("tide_font_scale", String(n)); };
  const setTheme = (t: Theme) => { setThemeState(t); localStorage.setItem("tide_theme", t); };
  const toggleTheme = () => setTheme(theme === "deep" ? "light" : "deep");
  const setColorScheme = (c: ColorScheme) => { setColorSchemeState(c); localStorage.setItem("studio_color_scheme", c); };

  const resolvedDark = colorScheme === "dark" || (colorScheme === "system" && systemDark);
  // 三态循环：跟随系统 → 浅 → 深 → 跟随系统。让「跟随系统」始终可回到。
  const cycleColorScheme = () =>
    setColorScheme(colorScheme === "system" ? "light" : colorScheme === "light" ? "dark" : "system");

  return (
    <ModeCtx.Provider value={{ mode, fontScale, theme, colorScheme, resolvedDark, setMode, setFontScale, setTheme, toggleTheme, setColorScheme, cycleColorScheme }}>
      {children}
    </ModeCtx.Provider>
  );
}

export function useMode() {
  const ctx = useContext(ModeCtx);
  if (!ctx) throw new Error("useMode must be inside ModeProvider");
  return ctx;
}
