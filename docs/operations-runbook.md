# 潮汐学习生产运维手册

本文是生产发布闸门，不是愿景文档。任何一项没有负责人、凭据或实测记录时，发布状态都应为阻塞。

## 1. 恢复目标

| 对象 | RPO | RTO | 实现与验收 |
| --- | ---: | ---: | --- |
| SQLite 业务库 + `.data` 私有资产 | 1 小时 | 2 小时 | 每小时一致性热备；每份同时包含 DB 与资产；每月至少一次在隔离目录恢复并核对哈希、`PRAGMA integrity_check`、媒体数量和抽样播放 |
| API 服务 | 15 分钟 | 1 小时 | 保留上一个已验证镜像/制品和环境变量版本；故障时先切回旧制品，数据库只做向前兼容迁移，不执行无备份降级 |

RPO/RTO 从监控首次告警时间计算。超过目标必须形成事故记录，不能在报告中标为“已达标”。

## 2. 加密备份

生产定时任务必须设置：

```bash
REQUIRE_ENCRYPTION=1 \
BACKUP_ENCRYPTION_PASSWORD_FILE=/run/secrets/tide-backup-password \
ASSETS_DIR=/var/lib/tide/.data \
KEEP=48 \
bash scripts/backup-db.sh /var/lib/tide/prod.db /var/backups/tide
```

- 密码文件至少 20 字节，只由密钥管理系统挂载，禁止进入仓库、镜像、日志或普通环境变量。
- 脚本使用 AES-256-CBC + PBKDF2 200000 次派生；成功后只保留 `.enc` 与 `.sha256`，并清理 SQLite 明文 `-wal/-shm` 旁文件。
- `REQUIRE_ENCRYPTION=1` 时缺密钥会直接失败，防止生产静默降级成明文备份。
- 本地 `KEEP` 只负责短期轮转，不等于异地备份。

## 3. 异地复制

部署方必须把每次生成的两个 `.enc` 文件和同时间戳 `.sha256` 原子复制到另一个账号/区域的对象存储，并开启：

1. 服务端加密；
2. 版本控制或 Object Lock；
3. 30 天保留；
4. 生产主机只有写入权限，没有批量删除权限；
5. 上传失败在 5 分钟内告警。

对象存储厂商、bucket、区域、服务账号和告警接收人属于部署环境信息，不得写入仓库。发布记录必须附一次真实上传的对象清单和校验结果。

## 4. 恢复演练

```bash
BACKUP_ENCRYPTION_PASSWORD_FILE=/run/secrets/tide-backup-password \
ASSETS_DIR=/tmp/tide-restore-data \
bash scripts/restore-db.sh \
  /restore/tide-YYYYmmdd-HHMMSS.db.enc \
  /tmp/tide-restored.db \
  /restore/tide-YYYYmmdd-HHMMSS-uploads.tar.gz.enc \
  --force

test "$(sqlite3 /tmp/tide-restored.db 'PRAGMA integrity_check;')" = ok
find /tmp/tide-restore-data/media -type f | wc -l
```

演练必须在隔离目录执行；不得覆盖生产库。记录开始/结束时间、备份时间戳、哈希校验结果、数据库行数、资产文件数、抽样登录/播放结果。只有总耗时不超过 2 小时才算达到 RTO。

## 5. 发布与回退

1. 发布前执行迁移状态、lint、类型、全部测试、生产构建、依赖审计和恢复演练。
2. 先生成并异地复制加密备份，再执行 `prisma migrate deploy`。
3. 迁移只允许向前兼容；应用回退到上一制品时，数据库不做破坏性降级。
4. 若迁移本身不可向前兼容，必须另写补偿迁移并在隔离副本演练，不能手工改生产表。
5. 发布后验证登录、课程访问、支付回调、私有媒体 Range、账号注销和后台需求状态流。

## 6. 监控与值班闸门

最低告警：连续 5xx、登录失败率突增、支付回调失败/积压、备份缺失或上传失败、磁盘空间、恢复校验失败、APNs/邮件发送失败。部署方必须配置监控平台、值班人和升级电话；仓库内日志轮转不能替代外部告警。
