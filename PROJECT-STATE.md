# 项目状态快照

> 用途：供长时间会话压缩后快速恢复上下文。更新日期：2026-08-07。

## 当前状态

- 生产：http://42.194.139.7，PM2 `blowing-machine`，线上 API 测试 66/66 通过
- 技术栈：Node.js + Express + PostgreSQL、Vue 3 + Vite 7、Pinia、ExcelJS、zod、docx-preview、read-excel-file
- GitHub：continue555/my-first-demo，master 分支，CI 七任务全绿
- 部署：`deploy-remote.js` 上传 → 服务器 `deploy/server-deploy.sh` 备份/构建/重启/测试/自动回滚
- 定时任务已装：每日备份、每 5 分钟健康检查、每周恢复演练

## 关键命令

- 单元测试：`npm run test:unit`；覆盖率：`npm run test:coverage`
- API 测试：`npm test`；压力测试：`npm run test:stress`
- 前端构建：`cd frontend && npm run build`
- 部署：`$env:SSH_PASS=...; node deploy-remote.js`（首次/依赖变更加 `$env:DEPLOY_INSTALL='1'`）
- 服务器端：`bash deploy/server-deploy.sh`、`bash deploy/rollback.sh <时间戳>`、`bash scripts/restore-drill.sh`、`bash scripts/health-check.sh`、`bash scripts/log-query.sh <关键字>`

## 近期完成（2026-08-07）

- 安全：全局错误处理不再把 `err.message` 返回给客户端，统一返回“服务器内部错误”，服务端保留完整日志
- 安全：附件预览/下载接口移除 URL query 传 JWT 的兜底，令牌只走 Header/Cookie
- 安全：登录 IP 记录优先 `x-real-ip`/`req.ip`，不再直接信任 `X-Forwarded-For`
- 安全：畸形 Cookie（非法百分号编码）直接丢弃，不再导致请求 500
- 修复：修改密码接口对已删除用户返回 404“用户不存在”，不再 500
- 并发：订单完成判定改为原子 `UPDATE ... WHERE status <> 'completed' AND (SELECT COUNT(*) ...)=0`，避免并发完成时漏判
- 导出：失败时不向客户端暴露内部错误，统一返回“导出失败，请重试”；导出文件名清洗 CR/LF
- 并发：单订单附件上传按订单串行化，避免并发上传同时通过 200MB 配额检查
- 前端：仪表盘加载失败给出错误提示，不再静默吞错
- 通知折叠：同类事件通知按事件 key 聚合，跨非连续通知也合并展示
- 安全：nginx 统一将 `X-Forwarded-For` 覆盖为真实客户端 IP（`$remote_addr`），不再追加客户端传入值；线上配置同步并 reload
- 修复：采购“下单时间”（`order_date`）支持清空（显式传空值时清空，未传则保留原值）
- 金额清理：订单不再存储/返回合同金额，新增 028 迁移删除 `orders.contract_amount` 列；创建/编辑/接口/前端/导出全部移除金额处理
- 字段清理：订单不再存储/返回客户名称、项目名称，新增 029 迁移删除 `orders.customer_name`/`orders.project_name` 列；创建/编辑/接口/前端全部移除
- 字段清理：订单不再存储/返回产品型号、数量、订单备注，新增 030 迁移删除 `orders.product_model`/`orders.quantity`/`orders.notes` 列；创建/编辑/接口/前端/导出订单概要全部移除（节点备注保留）
- 安全：`/api/notifications/check-overdue` 限制为管理员/总经理可调用，普通用户返回 403；补充 API 测试
- 安全：登录 IP 改用 `req.ip`（已配置 trust proxy），不再信任可伪造的 `x-real-ip` 请求头
- 并发：登录失败计数改为数据库原子递增，避免并发少计
- 并发：附件上传按订单队列完成后自动清理，防止 Map 无限增长
- 前端：通知标记已读失败给出错误提示；删除用户弹窗对用户名做 HTML 转义
- 性能：我的待办改为一次批量查询全部节点，消除 N+1
- 性能：订单列表改为一次批量查询当前页节点，消除 N+1
- 导出：导出任务增加归属校验，创建人之外的管理员/总经理不能查看或下载他人任务
- 前端：流程节点“完成”增加二次确认弹窗，防止误操作；E2E 覆盖确认/取消流程
- 流程：模具设计与采购完成前必须设置“下单时间”和“计划到货时间”，前端未设置时禁用完成按钮，后端同步拦截
- 修复：实际完成/实际到货/实际交货日期统一为纯日期写入，新增 031 迁移清理存量带时分数据；超期判断按纯日期比较，同天完成不再误判超期
- 通知：新增业务通知外推，服务器 `.env` 配置 `BIZ_WEBHOOK_URL` 后，节点完成与超期/升级通知同步推送企业微信/钉钉群机器人（未配置自动跳过）
- 流程：采购“计划到货”晚于订单计划交货日期时保存提示并通知销售/总经理（`source_key` 去重）
- 流程：采购跟进完成可填写“实际到货说明”，记录分批/部分到货，节点行与导出保留说明
- 流程：节点完成后可修正实际完成日期；订单未完成时清空实际完成日期 = 撤回完成回到进行中，订单已完成时不允许撤回（留审计）
- 时间：所有时间字段（开始/计划完成/实际完成/下单/交货日期）统一为纯日期，新增 032 迁移清理存量带时分数据
- 订单：移除订单编辑接口与 `updateOrder` 服务，订单状态与实际交货日期只能由流程节点完成自动更新
- 清理：移除误入 `lib/` 的 Python 依赖（203 个跟踪文件）与未使用的 `middleware/async-handler.js`、`canAccessFile`/`buildDepartmentFilter` 死函数
- CI：`JWT_SECRET` 改用 GitHub Actions Secret 引用，仓库不再明文提交测试密钥

## 近期完成（2026-08-06）

- 修复：删除用户时同步清空 `order_files.uploaded_by`（附件保留、上传人置空），并新增 024 迁移清理历史悬空引用；API 测试覆盖“用户上传附件后删除用户”链路
- 功能：订单列表/仪表盘返回“当前节点”聚合（首个未完成节点、负责部门、计划完成日期、超期标记，`progress` 口径不变）；新增“我的待办”（`/api/todos` + `/todos` 页面，按部门树/角色聚合进行中与待开始订单，点击跳详情）
- 时间联动：标准周期配置（`shared/stage-durations.json`）保留未启用；时间变更写审计日志
- 超期升级：节点超期先通知负责部门，连续超期达到阈值（`shared/overdue-escalation.json`，默认 3 天）升级通知上级部门或总经理，`source_key` 去重；发货完成回填实际交货日期；订单仅全节点完成后置为已完成；详情/列表/待办统一显示当前节点超期标识
- 流程调整：下游顺延/提前联动已删除，不再自动调整下游计划日期
- 开始时间：点击“开始”时写入实际点击时间（不再保留倒排建议值）；未开始节点显示“计划开始”，开始后显示实际开始时间
- 通知折叠：历史顺延通知在通知中心按事件折叠展示（可展开、组内一键已读），新增前端分组工具与 Vitest 测试
- 流程调整：自动倒排已按用户要求停用，新订单不再自动生成节点计划日期（人工设置；采购-跟进-进仓联动保留）；`shared/stage-durations.json` 保留未启用
- 流程调整：签订合同人工设置开始+计划完成；后续节点开始时间自动取上一节点实际完成日期（仅填空值），只设计划完成时间
- 流程调整：采购节点新增人工“下单时间”字段（迁移 027），与自动带出的开始时间分离
- 流程调整：模具设计与采购可先开始（设计阶段），下单时间/计划到货可后补
- 修复：新增/编辑用户校验部门必须存在（不存在返回 400“部门不存在”，不再 500）；上传附件到不存在订单返回 404“订单不存在”并清理临时文件
- 修复：提货款到账缺计划日期时后端兜底提示改为“请先设置计划完成日期”，不再误指采购计划到货时间（采购跟进/物料进仓保持原提示）
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
- 数据：迁移 023 将存量阶段时间（开始/计划完成/实际完成）统一截断为纯日期
- 流程：采购-跟进-进仓时间联动（跟进/进仓无开始时间；计划到货自动同步并锁定；实际到货自动回填取最晚）
- 流程：提货款到账无前置条件、无开始时间（仅设置计划完成日期，设置后仅管理员/总经理可修改，迁移 022 清理存量）
- 流程：移除死状态 `cancelled`（超期/统计判断简化为“completed 为唯一终态”，标签与样式清理）
- 流程：阶段完成通知改为“多依赖全部满足后才通知”并按部门/角色聚合；无负责部门节点（总经理签字）按 `recipient_role=management` 通知且可见性受控
- 运维：超期检测改为服务器 cron 每 5 分钟执行（`scripts/check-overdue-cron.js`），前端不再轮询
- 运维：应用日志 logrotate 每日轮转、压缩、保留 14 天（`deploy/logrotate.conf` + `scripts/install-logrotate.sh`）
- 运维：PM2 配置 systemd 开机自启（pm2-ubuntu + pm2 save），重启后自动恢复 blowing-machine
- 部署：新增 CI 硬校验 `check-assets-in-sync`（前端构建后比对资源映射）与 `check-deploy-manifest`（上传清单覆盖检查）；`deploy-remote.js` 上传前本地预检缺失文件与失效映射目标
- 测试：新增 service 层单元测试（登录限流、阶段推进/并发唯一冲突、单订单导出工作簿），E2E 覆盖附件上传/预览、用户管理、批量导出
- 测试：E2E 增加浏览器真实下载导出文件（下载后解析内容）与 Excel/Word 在线预览渲染验证
- 前端：接入 Vitest + @vue/test-utils（组件/工具测试 20 项）；移动端可点击元素改为原生按钮并补 `aria-label` 与键盘焦点；TypeScript 按用户确认维持现状
- 移动端兼容：viewport-fit=cover + safe-area 适配、输入框 16px 防 iOS 自动缩放、100dvh 视口适配；E2E 增加 iPhone 13/iPhone SE/Pixel 7/微信 UA 移动端矩阵
- 架构：auth/附件/导出业务已拆 service（`auth-service`、`files-service`、`export-service`），routes 全部为薄路由
- 依赖：后端 exceljs 依赖的 uuid 已通过 npm overrides 升级至 11.1.1，后端生产依赖审计 0 漏洞（无需破坏性降级 exceljs）
- 依赖：修复新增 brace-expansion 高危（2.1.3 → 2.1.4，GHSA-rgw5-rvv9-x895），后端全量审计 0 漏洞
- 移动端体验：底部导航、订单卡片、筛选保留、预览全屏
- 安全：HttpOnly Cookie + CSRF、限流持久化、角色白名单、附件权限、参数校验、stats 接口按角色限制
- 测试：API 71 项、后端单元 99 项、前端 Vitest 20 项、压力测试（并发建单/阶段推进/50 单导出）、E2E、依赖审计
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

- `services/`：order-service、audit-service、notifications-service、auth-service、files-service、export-service、todo-service
- `routes/`：薄路由，仅保留请求/响应与中间件编排
- `lib/`：overdue、sanitize、stage-permissions、validators(zod)、download-ticket、file-permissions、cookies、dept-filter、current-stage
- `shared/`：stage-defs、stage-durations、overdue-escalation、status-labels、role-labels
- `migrations/`：PostgreSQL 自动迁移（31 个版本：001-024、026、027、028、029、030、031、032；025 已撤销）
- `e2e/`、`tests/`：Playwright E2E、Node 单元测试
- `deploy/`：server-deploy.sh、rollback.sh；`scripts/`：restore-drill、health-check、install-crons、log-query
