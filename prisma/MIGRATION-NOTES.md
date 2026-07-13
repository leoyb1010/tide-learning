# Prisma 迁移与恢复规则

## 当前基线

`prisma/migrations/20260713000100_baseline` 是项目首个可审计基线，完整对应当前 SQLite schema。
新数据库只允许执行 `npm run db:deploy`；它优先调用标准 `prisma migrate deploy`。若 Prisma 在完全空的 SQLite
文件上触发已知的无细节 schema-engine 失败，脚本才会用已提交的基线 SQL 引导一次、写入标准迁移记录，
然后重新执行 `migrate deploy`。非空数据库绝不会自动兜底。禁止在生产使用 `prisma db push`。

## 已有数据库首次接入基线

1. 用 `scripts/backup-db.sh` 创建一致性备份并通过 quick_check；
2. 用 `prisma migrate diff --from-url <现有库> --to-schema-datamodel prisma/schema.prisma --exit-code` 验证结构无差异；
3. 仅在无差异时执行 `prisma migrate resolve --applied 20260713000100_baseline`；
4. 执行 `prisma migrate status`，再按正常发布流程使用 `migrate deploy`。

不得对有数据的旧库运行 `migrate reset`，也不得跳过备份或结构比对直接标记基线。

## 后续变更

每次 schema 变更必须提交新的迁移目录，并在 CI 同时通过：空库部署、seed、类型检查、测试、构建、依赖审计与备份恢复演练。破坏性变更必须写明前向兼容顺序、备份点和回退方式。
