import Image from "next/image";

const RATIO = 1179 / 254; // 提取的有道 wordmark 原始比例

/**
 * 网易有道 品牌 wordmark（VIS 规范源文件提取，透明底可着色变体）。
 * variant: red（浅底）/ white（红底或深底）/ ink（正文黑）
 */
export function YoudaoLogo({
  variant = "red",
  height = 20,
  className,
  priority,
}: {
  variant?: "red" | "white" | "ink";
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const src =
    variant === "white" ? "/brand/youdao-white.png" : variant === "ink" ? "/brand/youdao-ink.png" : "/brand/youdao-red.png";
  return (
    <Image
      src={src}
      alt="有道 youdao"
      width={Math.round(height * RATIO)}
      height={height}
      priority={priority}
      className={className}
    />
  );
}
