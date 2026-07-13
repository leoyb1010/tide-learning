/** 只允许站内绝对路径，避免 next 参数形成开放重定向。 */
export function safeInternalPath(value: string | null | undefined, fallback: string): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : fallback;
}
