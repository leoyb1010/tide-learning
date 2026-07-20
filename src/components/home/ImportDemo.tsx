"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  CheckCircle,
  MagicWand,
  Cards,
  Question,
} from "@phosphor-icons/react/dist/ssr";
import { useStudyRoom } from "./StudyRoomContext";

/* ============================================================
   ImportDemo —— 第二幕「导入升维桌」的迷你真实演示
   循环分镜：一份「资料文档」被扫描 → 裂变为三张章节卡逐张入列
   → 每章弹出测验/要点卡徽标 →「已升维成课」落定 → 重启。
   与 DeskDemo 同族（屏内产品演示语言），纯 transform/opacity。
   降级（!motionOk）：定格终态（三章 + 徽标 + 完成句），不循环。
   ============================================================ */

const CHAPTERS = ["为什么要懂现金流", "三张报表怎么读", "给自己做一份预算"];

type Stage = "scan" | "split" | "enrich" | "done";

const STAGE_SEQ: { stage: Stage; ms: number }[] = [
  { stage: "scan", ms: 1500 },
  { stage: "split", ms: 2100 },
  { stage: "enrich", ms: 1900 },
  { stage: "done", ms: 3000 },
];

export function ImportDemo() {
  const { motionOk } = useStudyRoom();
  const [stage, setStage] = useState<Stage>(motionOk ? "scan" : "done");
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (!motionOk) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let acc = 0;
    for (const s of STAGE_SEQ) {
      timers.push(setTimeout(() => setStage(s.stage), acc));
      acc += s.ms;
    }
    timers.push(
      setTimeout(() => {
        setStage("scan");
        setCycle((c) => c + 1);
      }, acc),
    );
    return () => timers.forEach(clearTimeout);
  }, [cycle, motionOk]);

  const splitVisible = stage !== "scan";
  const enriched = stage === "enrich" || stage === "done";

  return (
    <div className="relative w-full" aria-hidden>
      {/* 源文档条：一份资料（PDF/长文）正被读取 */}
      <div
        className={`relative flex items-center gap-2 overflow-hidden rounded-[10px] border px-3 py-2 ${
          stage === "scan" && motionOk ? "ai-scan" : ""
        }`}
        style={{
          borderColor: "var(--scene-hairline)",
          background: "var(--scene-card-2)",
        }}
      >
        <FileText size={16} weight="fill" style={{ color: "var(--info)" }} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--scene-ink-2)" }}>
          我的资料 · 理财入门笔记.pdf
        </span>
        <span
          className="mono shrink-0 text-[10px] font-bold uppercase tracking-[0.1em]"
          style={{ color: stage === "scan" ? "var(--red)" : "var(--scene-ink-3)" }}
        >
          {stage === "scan" ? "读取中" : "已读完"}
        </span>
      </div>

      {/* 裂变的章节卡：从文档下方逐张「长」出 */}
      <div className="mt-2 flex flex-col gap-1.5">
        {CHAPTERS.map((title, i) => (
          <AnimatePresence key={title} initial={false}>
            {splitVisible && (
              <motion.div
                className="flex items-center gap-2 rounded-[10px] border px-3 py-1.5"
                style={{
                  borderColor: "var(--scene-hairline)",
                  background: "var(--scene-card)",
                  boxShadow: "var(--scene-card-shadow-sm)",
                }}
                initial={motionOk ? { opacity: 0, y: -10, scale: 0.97 } : false}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.18 } }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: motionOk ? i * 0.16 : 0 }}
              >
                <span
                  className="mono flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                  style={{ background: "var(--scene-card-2)", color: "var(--scene-ink-3)", border: "1px solid var(--scene-hairline)" }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium" style={{ color: "var(--scene-ink)" }}>
                  {title}
                </span>
                {/* 升维徽标：测验 + 要点卡逐个点亮 */}
                <AnimatePresence>
                  {enriched && (
                    <motion.span
                      className="flex shrink-0 items-center gap-1"
                      initial={motionOk ? { opacity: 0, scale: 0.6 } : false}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1], delay: motionOk ? i * 0.14 : 0 }}
                    >
                      <Question size={11} weight="fill" style={{ color: "var(--warn)" }} />
                      <Cards size={11} weight="fill" style={{ color: "var(--info)" }} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        ))}
      </div>

      {/* 完成句：升维报告一行版 */}
      <div className="mt-2 flex h-[18px] items-center gap-1.5">
        <AnimatePresence mode="wait">
          {stage === "done" ? (
            <motion.span
              key="done"
              className="flex items-center gap-1.5 text-[11px] font-semibold"
              style={{ color: "var(--ok)" }}
              initial={motionOk ? { opacity: 0, y: 4 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <CheckCircle size={12} weight="fill" />
              已升维成课 · 3 章 · 3 测验 · 3 要点卡
            </motion.span>
          ) : (
            <motion.span
              key="working"
              className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em]"
              style={{ color: "var(--scene-ink-3)" }}
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <MagicWand size={11} weight="fill" style={{ color: "var(--red)" }} />
              {stage === "scan" ? "AI 正在通读…" : stage === "split" ? "拆分章节…" : "配测验与复习卡…"}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
