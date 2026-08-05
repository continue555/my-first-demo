# 项目状态快照

> 用途：供长时间会话压缩后快速恢复上下文。更新日期：2026-08-03。

## 当前状态

- 生产：http://42.194.139.7，PM2 `blowing-machine`，线上 API 测试 50/50 通过
- 技术栈：Node.js + Express + PostgreSQL、Vue 3 + Vite 7、Pinia、ExcelJS、zod、docx-preview、read-excel-file
- GitHub：continue555/my-first-demo，master 分支，CI 六任务全绿
- 部署：`deploy-remote.js` 上传 → 服务器 `deploy/server-deploy.sh` 备份/构建/重启/测试/自动回滚
- 定时任务已装：每日备份、每 5 分钟健康检查、每周恢复演练

## 关键命令

- 单元测试：`npm run test:unit`；覆盖率：`npm run test:coverage`
- API 测试：`npm test`；压力测试：`npm run test:stress`
- 前端构建：`cd frontend && npm run build`
- 部署：`$env:SSH_PASS=...; node deploy-remote.js`（首次/依赖变更加 `$env:DEPLOY_INSTALL='1'`）
- 服务器端：`bash deploy/server-deploy.sh`、`bash deploy/rollback.sh <时间戳>`、`bash scripts/restore-drill.sh`、`bash scripts/health-check.sh`、`bash scripts/log-query.sh <关键字>`

## 近期完成（2026-08-03）

- 安全加固：关闭 `/uploads` 静态裸访问（附件/导出仅走鉴权与票据接口）、健康检查增加数据库探活、订单编号唯一冲突由 500 改为 400、阶段完成通知 await 化并记录失败、nginx 上传上限与 multer 对齐 20MB
- 安全：JWT 服务端吊销（`users.token_version`），退出登录/修改密码/管理员重置密码后旧令牌立即失效
- 安全：登录限流改为 IP 维度（20 次/30 分钟），防止账号被恶意锁定
- 前端：请求增加超时（默认 30s、下载 60s），超时给出友好提示
- 前端：路由跳转统一走 `navigateTo` 防抖入口（仪表盘、更多菜单、详情返回/删除后跳转）
- 运维：导出任务状态落盘失败降级为记录日志，不中断导出流程
- 依赖：playwright/ssh2 移入 devDependencies，服务器生产安装 `npm ci --omit=dev` 减小安装面
- 数据：明确删除订单为硬删除，审计日志保留但订单号筛选对已删订单不可达（按时间/操作类型追溯）
- 附件：登录响应移除前端未使用的 `csrfToken` 字段；新增单订单附件总量上限 200MB（`files-service` 配额校验 + 单元测试）
- 导出：Excel 导出移除客户名称/项目名称/产品型号/数量/合同金额列（界面与导出口径统一）
- 流程：移除死状态 `delayed`（订单/导出/zod/标签全面清理，历史数据迁移归一化为进行中）
- 流程：调试阶段更名“调试验货”→“调试验收”（流程定义 + 迁移 019 同步存量订单）
- 流程：新增“提货款到账”财务节点（调试验收后、发货前，流程 22→23；迁移 020 同步存量订单；收到提货款才能发货）
- 流程：阶段时间设置/展示/导出统一仅到日期（`YYYY-MM-DD`），不再录入时分秒
- 流程：采购-跟进-进仓时间联动（跟进/进仓无开始时间；计划到货自动同步并锁定；实际到货自动回填取最晚）
- 流程：移除死状态 `cancelled`（超期/统计判断简化为“completed 为唯一终态”，标签与样式清理）
- 流程：阶段完成通知改为“多依赖全部满足后才通知”并按部门/角色聚合；无负责部门节点（总经理签字）按 `recipient_role=management` 通知且可见性受控
- 运维：超期检测改为服务器 cron 每 5 分钟执行（`scripts/check-overdue-cron.js`），前端不再轮询
- 运维：应用日志 logrotate 每日轮转、压缩、保留 14 天（`deploy/logrotate.conf` + `scripts/install-logrotate.sh`）
- 运维：PM2 配置 systemd 开机自启（pm2-ubuntu + pm2 save），重启后自动恢复 blowing-machine
- 部署：新增 CI 硬校验 `check-assets-in-sync`（前端构建后比对资源映射）与 `check-deploy-manifest`（上传清单覆盖检查）；`deploy-remote.js` 上传前本地预检缺失文件与失效映射目标
- 测试：新增 service 层单元测试（登录限流、阶段推进/并发唯一冲突、单订单导出工作簿），E2E 覆盖附件上传/预览、用户管理、批量导出
- 测试：E2E 增加浏览器真实下载导出文件（下载后解析内容）与 Excel/Word 在线预览渲染验证
- 前端：接入 Vitest + @vue/test-utils（组件/工具测试 14 项）；移动端可点击元素改为原生按钮并补 `aria-label` 与键盘焦点；TypeScript 按用户确认维持现状
- 移动端兼容：viewport-fit=cover + safe-area 适配、输入框 16px 防 iOS 自动缩放、100dvh 视口适配；E2E 增加 iPhone 13/iPhone SE/Pixel 7/微信 UA 移动端矩阵
- 架构：auth/附件/导出业务已拆 service（`auth-service`、`files-service`、`export-service`），routes 全部为薄路由
- 依赖：后端 exceljs 依赖的 uuid 已通过 npm overrides 升级至 11.1.1，后端生产依赖审计 0 漏洞（无需破坏性降级 exceljs）
- 依赖：修复新增 brace-expansion 高危（2.1.3 → 2.1.4，GHSA-rgw5-rvv9-x895），后端全量审计 0 漏洞
- 移动端体验：底部导航、订单卡片、筛选保留、预览全屏
- 安全：HttpOnly Cookie + CSRF、限流持久化、角色白名单、附件权限、参数校验、stats 接口按角色限制
- 测试：API 58 项、后端单元 44 项、前端 Vitest 14 项、压力测试（并发建单/阶段推进/50 单导出）、E2E、依赖审计
- 并发修复：阶段完成通知插入改为 `ON CONFLICT DO NOTHING`
- 依赖：xlsx 已替换为 read-excel-file；Vite 升级 7.3.6，前端审计 0 漏洞；zod 接入关键写接口
- 架构：订单/审计/通知/auth/附件/导出业务已拆 service；结构化日志
- 运维：恢复演练、服务器端部署与回滚、健康检查、定时任务、日志查询
- 文档：操作文档已与系统同步

## 待办/注意事项

- 历史一次性脚本（check_db/check_order/migrate_stages/migrate_to_pg）和 Docker 文件：用户明确保留，不删
- `MONITOR_WEBHOOK` 未配置，配置后健康检查失败可推送告警
- 真机（iOS/Android/微信）以 CI 模拟矩阵覆盖；如需实物机型回归，提供机型清单后补充
- 备份“恢复演练”已通过一次，建议每周由定时任务持续验证
- 备份保留在本机（用户已确认不采用异地备份），同机故障时依赖云厂商快照兜底，此项为已接受风险

## 架构速览

- `services/`：order-service、audit-service、notifications-service、auth-service、files-service、export-service
- `routes/`：薄路由，仅保留请求/响应与中间件编排
- `lib/`：overdue、sanitize、stage-permissions、validators(zod)、download-ticket、file-permissions、cookies、dept-filter
- `migrations/`：PostgreSQL 自动迁移（15 个版本）
- `e2e/`、`tests/`：Playwright E2E、Node 单元测试
- `deploy/`：server-deploy.sh、rollback.sh；`scripts/`：restore-drill、health-check、install-crons、log-query
