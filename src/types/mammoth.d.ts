// mammoth 无官方类型声明；仅声明本项目用到的最小面（docx → 纯文本抽取）。
declare module "mammoth" {
  interface ExtractRawTextInput {
    buffer?: Buffer;
    path?: string;
    arrayBuffer?: ArrayBuffer;
  }
  interface ExtractRawTextResult {
    value: string;
    messages: unknown[];
  }
  export function extractRawText(input: ExtractRawTextInput): Promise<ExtractRawTextResult>;
  const _default: { extractRawText: typeof extractRawText };
  export default _default;
}
