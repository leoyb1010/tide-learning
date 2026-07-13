import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default defineConfig([
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // 多处图片是 data URI、用户私有鉴权 URL 或 Satori 画布，不能交给 next/image。
      "@next/next/no-img-element": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "public/**", "ios/**", "backups/**"]),
]);
