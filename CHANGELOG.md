# Changelog

All notable changes to CodexMobile are tracked here.

---

## 最新变更

### Docker 部署支持

- **Dockerfile**：多阶段构建 Docker 镜像
  - 构建阶段：使用 `node:24-bookworm-slim` 构建前端
  - 运行阶段：包含完整运行时依赖（git、python3、ffmpeg、sqlite3、fonts-noto-cjk 等）
  - 全局安装 `@openai/codex` CLI
  - 预设数据目录结构：`/app/.codex`、`/app/.codexmobile`、`/workspace`

- **docker-compose.yml**：一键部署配置
  - 使用 GitHub Container Registry 镜像：`ghcr.io/flyyangx/codexmobile:latest`
  - 自动挂载数据卷：codex 配置、codexmobile 状态、工作目录
  - 预设 `CODEXMOBILE_ENABLE_DANGER_FULL_ACCESS=1` 环境变量

- **docker-entrypoint.sh**：容器启动入口脚本
  - 自动创建运行时数据目录
  - 确保工作目录与配置目录分离

- **GitHub Actions 自动发布**（`.github/workflows/docker-publish.yml`）
  - 支持 `linux/amd64` 和 `linux/arm64` 多架构构建
  - 自动推送到 GitHub Container Registry
  - 支持 tag 触发和手动触发

### 文件访问安全限制

- **路径限制**：文件浏览器 API（`/api/files/*`、`/api/local-file`）现在只能访问工作目录
  - 只允许访问 `CODEXMOBILE_WORKDIR` 或默认工作目录
  - 访问其他路径返回 403 错误
  - 防止通过文件 API 访问系统敏感文件

- **根目录 API 变更**：`/api/files/roots` 现在只返回一个工作目录入口

### 权限模式增强

- **新增 `sandboxOff` 权限模式**：
  - `sandboxMode: 'danger-full-access'`（无沙箱限制）
  - `approvalPolicy: 'on-request'`（需要审批）
  - 适合需要完全文件系统访问但仍需用户确认的场景

- **`default` 权限模式变更**：
  - 审批策略从 `never` 改为 `on-request`
  - 每次文件操作都需要用户确认

- **新增环境变量 `CODEXMOBILE_ENABLE_DANGER_FULL_ACCESS`**：
  - 控制是否允许使用 `bypassPermissions` 和 `sandboxOff` 模式
  - 公网部署时自动禁用（默认行为）
  - 私网/Docker 部署时可显式启用

### 移除的功能

- **自更新功能**：移除了 `update-service.js`、`update-routes.js` 和 `scripts/apply-update.mjs`
  - Docker 部署通过 `docker pull` 更新镜像
  - 本地部署通过 `git pull` 更新代码

### 其他变更

- **`defaultProjectlessWorkspaceRoot()`** 支持环境变量：
  - 优先使用 `CODEXMOBILE_WORKDIR` 环境变量
  - Docker 默认工作目录为 `/workspace`


### 新增功能

#### 2.0.x 版本新增
- **文件管理器**：完整的文件浏览、搜索、路径跳转、本地文件预览（Word、HTML、CSV、PPTX、PDF）
- **本地文件删除**：支持从文件管理器删除本地文件，删除前自动备份
- **移动端交互请求**：支持 Codex app-server 提示、命令/文件审批、权限请求、MCP 询问
- **GitHub Release 自更新**：设置页支持检查更新、应用更新标签、依赖安装和重新构建
- **首页和项目选择**：移动端可从项目层进入，而非必须先进入历史线程
- **可信设备管理**：设置页可查看、撤销可信设备，区分当前设备
- **分支工作流**：Composer 和 Git 面板支持分支读取、搜索、切换、创建分支、创建 worktree、生成 PR 草稿
- **归档箱**：侧栏归档箱视图，支持搜索、查看、取消归档
- **额度面板**：Codex 额度状态查看
- **安全控制**：请求来源、可信代理、公网访问模式、权限策略、上传/本地文件访问保护

#### 1.x 版本新增
- **PWA 更新检测**：检测新构建版本，提示用户刷新
- **WebSocket 同步**：移动端/桌面端实时同步，包含同步存储、广播、reducer
- **运行时调试**：检查活跃运行状态和桥接行为
- **文件差异高亮**：activity 中显示 inline add/delete 高亮
- **系统主题**：支持跟随 OS 浅色/深色主题
- **模型速度选择器**：Standard/Fast 选择，Fast 会传递 `service tier` 到后端
- **Memory Citation 卡片**：折叠显示 `<oai-mem-citation>` 块
- **队列面板**：queued drafts 查看、恢复、删除、立即发送
- **Composer 快捷键**：`/` 命令（状态、压缩上下文、代码审查、子代理）
- **`$skill` 自动补全**：基于现有 skills 列表
- **`@file` 搜索**：项目内文件搜索，自动忽略 .git、node_modules 等
- **文件提及**：选中的本地路径作为上下文附加
- **扩展 Git 面板**：status、diff、pull、sync、commit+push
- **Toast 通知**：Git 进度、任务完成、失败、用户输入提示
- **Web Push**：HTTPS PWA 后台完成通知
- **连接恢复卡片**：重连、同步、修复配对、检查状态入口
- **桌面线程状态徽章**：IPC 在线、线程待确认、后台执行中
- **统一侧栏运行指示器**：区分桌面端/移动端发起的发送

### 依赖变化

| 新增依赖 | 用途 |
|---------|------|
| `mermaid` ^11.15.0 | Mermaid 图表渲染 |
| `react-markdown` ^10.1.0 | Markdown 渲染 |
| `remark-breaks` ^4.0.0 | Markdown 换行支持 |
| `remark-gfm` ^4.0.1 | GitHub Flavored Markdown |
| `pdfjs-dist` ^5.7.284 | PDF 预览 |
| `mammoth` ^1.12.0 | Word 文档预览 |
| `xlsx` ^0.18.5 | Excel 文件预览 |
| `jszip` ^3.10.1 | ZIP 文件处理 |
| `web-push` ^3.6.7 | Web Push 通知 |
| `@openai/codex-sdk` ^0.128.0 | 升级 Codex SDK |

### 新增脚本

| 脚本 | 用途 |
|------|------|
| `npm run up` | 构建前端、启动/重启服务、输出配对入口 |
| `npm run pair` | 申请一次性配对码，输出手机链接 |


### 新增配置项

- `CODEXMOBILE_PUSH_SUBJECT`：Web Push VAPID subject
- `CODEXMOBILE_PAIRING_CODE_TTL_MS`：配对码有效期
- `CODEXMOBILE_PAIRING_CODE_LENGTH`：配对码长度
- `CODEXMOBILE_TOKEN_TTL_MS`：可信设备 token 有效期
- `CODEXMOBILE_PUBLIC_ACCESS`：公开访问模式
- `CODEXMOBILE_ALLOWED_ORIGINS`：允许的前端来源
- `CODEXMOBILE_TRUSTED_PROXY_CIDRS`：可信代理网段
- `CODEXMOBILE_DANGER_FULL_ACCESS`：是否允许高风险权限模式
- `CODEXMOBILE_AUTO_TITLE`：自动标题生成开关
- `CODEXMOBILE_TITLE_BASE_URL/API_KEY/MODEL`：自动标题生成配置

### 新增文件清单（部分）

| 目录 | 文件数 | 说明 |
|------|--------|------|
| `server/` | 70+ | 服务端模块化拆分 |
| `server/sync/` | 4 | 同步相关模块 |
| `client/src/app/` | 20 | 应用核心模块 |
| `client/src/chat/` | 11 | 聊天相关组件 |
| `client/src/composer/` | 2 | 输入组件 |
| `client/src/panels/` | 14 | 面板组件 |
| `client/src/sync/` | 2 | 同步相关 |
| `client/src/utils/` | 1 | 工具函数 |
| `shared/` | 4 | 客户端/服务端共享代码 |
| `scripts/` | 9 | 运维脚本 |
| `marketing/` | 2 个子目录 | 营销素材和截图生成工具 |
| `docs/superpowers/plans/` | 1 | 开发计划文档 |
| `.github/workflows/` | 1 | GitHub Actions 工作流 |

### Docker 容器化部署（新增）

- **Dockerfile**：多阶段构建 Docker 镜像
  - 构建阶段：使用 `node:24-bookworm-slim` 构建前端
  - 运行阶段：包含完整运行时依赖（git、python3、ffmpeg、sqlite3、fonts-noto-cjk 等）
  - 全局安装 `@openai/codex` CLI
  - 预设数据目录结构：`/app/.codex`、`/app/.codexmobile`、`/workspace`

- **docker-compose.yml**：一键部署配置
  - 使用 GitHub Container Registry 镜像：`ghcr.io/flyyangx/codexmobile:latest`
  - 自动挂载数据卷：codex 配置、codexmobile 状态、工作目录

- **docker-entrypoint.sh**：容器启动入口脚本
  - 自动创建运行时数据目录
  - 确保工作目录与配置目录分离

- **GitHub Actions 自动发布**（`.github/workflows/docker-publish.yml`）
  - 支持 `linux/amd64` 和 `linux/arm64` 多架构构建
  - 自动推送到 GitHub Container Registry
  - 支持 tag 触发和手动触发

### 测试覆盖

BranchA 包含大量测试文件（`*.test.mjs`、`*.test.js`），覆盖：
- Activity 合并、去重、折叠
- Composer `/`、`@file`、`$skill` token 解析
- Queue add/list/delete/restore/steer
- Desktop IPC 能力判断和发送路径
- Git status/diff/pull/sync/commit-push
- Git 分支读取、切换、worktree、PR 草稿
- Web Push subscription 和通知
- 文件搜索、上传、本地静态资源安全
- 配对、可信设备、权限策略、请求安全
- 自动标题、额度查询、会话列表、归档同步

---

## Unreleased

### Added

- Added Docker containerization support with multi-stage builds, Docker Compose configuration, and GitHub Actions auto-publishing to GitHub Container Registry.
- Added `CODEXMOBILE_WORKDIR` environment variable for Docker workspace directory configuration.

## [2.0.5] - 2026-05-25

### Added

- Added a full file manager workspace with local directory browsing, common locations, path jumping, search, and desktop-side embedded file previews.
- Added local file deletion from the file manager with confirmation and backup copies before removal.
- Added persistence for the file manager open state and current path across refreshes.

### Changed

- Updated file preview embedding so the desktop file manager can use the full right-side preview area without nested headers or duplicated raw-view controls.
- Switched chat delivery to prefer desktop IPC for existing desktop threads, while keeping headless local execution as a fallback when needed.

### Fixed

- Tightened file manager layout tests and styling so navigation controls stay in the left sidebar and preview content occupies the right pane cleanly.
- Updated the package version to `2.0.5`.

## [2.0.4] - 2026-05-19

### Added

- Added richer local file previews for Word, HTML, spreadsheets, CSV, and PPTX files, including server-side preview extraction and front-end preview layouts.

### Fixed

- Added desktop proxy connection fallback handling so CodexMobile can continue through an isolated or headless local transport when the desktop control socket is unavailable.
- Improved selected-session running detection so active turn cards keep the mobile UI in a running state until a visible assistant response arrives.
- Updated the package version to `2.0.4`.

## [2.0.3] - 2026-05-16

### Fixed

- Fixed user-message markdown styling so links, inline code, code blocks, blockquotes, and tables stay readable in both light and dark themes.
- Updated the package version to `2.0.3`.

## [2.0.2] - 2026-05-15

### Added

- Added a GitHub Release self-update flow in settings, including latest-release checks, update status, guarded tag application, dependency install, and rebuild steps.
- Added mobile interaction request cards for Codex app-server prompts, command/file approvals, permission requests, and MCP elicitation so mobile can respond while a turn is running.

### Changed

- Improved permission-mode labels and fallback normalization for safer mobile composer settings.
- Updated the package version to `2.0.2`.

### Fixed

- Hardened session path handling and static-file serving so mobile routes and local assets stay stable across direct file and browser requests.
- Added sync coverage for interaction-request and interaction-resolved events so pending requests are inserted and removed consistently in chat.

## [2.0.1] - 2026-05-15

### Fixed

- Normalized session paths and timestamps so mobile project/session lists stay consistent after the 2.0 release.
- Simplified drawer project counting by relying on normalized session state instead of duplicate local calculations.
- Tightened security-option defaults and tests for safer local/private-network operation.
- Updated the package version to `2.0.1`.

## [2.0.0] - 2026-05-15

### Added

- Added a mobile home state and project picker so users can start from projects instead of only existing sessions.
- Added terminal-first pairing commands with `npm run up` and `npm run pair`, plus refreshed pairing screen artwork and copy.
- Added trusted device management, including current-device detection, revocation, token TTL handling, and settings-page security controls.
- Added drawer subpages for archived sessions, settings, and Codex quota status.
- Added Composer and Git panel branch workflows: branch listing, search, checkout, branch creation, linked worktree creation, and PR draft generation.
- Added refreshed real UI screenshots and marketing/demo screenshot generation assets for the GitHub README.
- Added request security controls for origins, trusted proxies, public access mode, permission policy, and safer upload/local-file handling.

### Changed

- Reworked the desktop/mobile shell layout, sidebar, chat surface, composer, pairing flow, and theme styling for the current CodexMobile UI.
- Improved activity card headlines, live progress, merge behavior, and turn completion state so execution history is easier to scan on mobile.
- Updated README and GitHub-facing project documentation to describe the current 2.0 product surface.
- Updated the package version to `2.0.0`.

### Fixed

- Fixed outdated documentation around GitHub PR support, recursive tests, pairing flow, and cross-platform positioning.
- Hardened session archive, local file preview, desktop activity parsing, and projectless session handling with additional tests.

## [1.4.0] - 2026-05-14

### Added

- Added PWA update detection and an in-app update prompt so mobile clients can refresh onto newly deployed builds.
- Added desktop handoff state helpers for clearer "back to desktop" UI behavior.
- Added broader sync socket, activity card, and desktop runner status test coverage.

### Changed

- Refined internal codex-web activity/rendering labels without changing the CodexMobile product name.
- Coalesced live and loaded-session activity cards so duplicated execution cards collapse into one clearer thread view.
- Folded noisy tool groups and desktop handoff state into cleaner activity and top-bar presentations.
- Refined mobile workflow handling across composer sends, top-bar status, and desktop/background routing.
- Updated the package version to `1.4.0`.

### Fixed

- Stabilized activity-card reconciliation when live runtime state and loaded session history arrive in different orders.
- Improved service-worker cache handling for built assets during mobile/PWA updates.

## [1.3.0] - 2026-05-13

### Added

- Added WebSocket-backed sync plumbing for mobile/desktop refresh events, including shared sync reducers, server-side sync storage, and desktop cache invalidation broadcasts.
- Added runtime debug helpers for inspecting active run state and bridge behavior from the mobile app.
- Added inline add/delete highlighting for file-diff activity summaries in chat.

### Changed

- Refactored the mobile app into clearer app, chat, composer, panel, and sync flows while preserving the existing local Node bridge shape.
- Improved desktop IPC and background app-server routing so existing desktop threads, background-created mobile threads, and session refreshes stay better aligned.
- Polished activity rendering, top-bar status, drawer behavior, and composer styling after the 1.2 release.
- Updated the package version to `1.3.0`.

### Fixed

- Removed noisy placeholder thinking activity from the visible chat stream.
- Fixed several stale runtime and live-polling cases that could leave mobile UI state behind the desktop thread state.

## [1.2.0] - 2026-05-09

### Added

- Added a system theme option so CodexMobile can follow the OS light/dark preference across the main app and file preview flow.
- Added a model speed selector in the composer model menu, with Standard and Fast choices persisted locally.
- Added end-to-end service tier routing so Fast model speed sends `fast` through chat requests, desktop IPC, and headless Codex runs.
- Added compact memory citation cards for `<oai-mem-citation>` blocks in chat output.

### Changed

- Replaced the README screenshots with redacted dark/light demos that show the sidebar, running state, and desktop-style tool activity flow.
- Synced PWA theme color updates with the resolved light/dark mode when following the system theme.

## [1.0.0] - 2026-05-09

### Added

- Added a queue panel for running conversations: queued drafts can be viewed, restored, deleted, or sent immediately as steer input.
- Added composer shortcuts with `/` commands for status, context compaction, code review, and sub-agent workflows.
- Added `$skill` autocomplete backed by the existing skills list.
- Added `@file` search backed by a project-local file search API that ignores generated and dependency directories.
- Added file mention support for chat sends so selected local paths can be attached as context.
- Added an expanded Git panel with status, diff preview, pull, sync, and commit+push actions.
- Added foreground toast notifications for Git progress, task completion, failures, and user-input prompts.
- Added Web Push support for installed HTTPS PWAs, including service worker handling and server-side subscription storage.
- Added a compact connection recovery card for reconnecting, syncing, repairing pairing, and checking status.
- Added desktop thread status badges so mobile can distinguish IPC online, thread pending confirmation, and background execution before sending.
- Added unified sidebar run indicators for desktop-origin and mobile-origin sends.
- Added clean dark and light mode project screenshots for the 1.0 README.

### Changed

- Kept completed task activity collapsed by default while preserving the full execution text when expanded.
- Improved mobile activity rendering and reduced noisy lifecycle messages.
- Unified desktop IPC and background fallback readback so both paths refresh from the same session stream.
- Simplified transient background startup UI to avoid duplicate middle activity cards.
- Matched mobile activity labels and icons more closely to Codex Desktop for commands, files, and skills.
- Split the large server entrypoint into route and service modules for safer extension.
- Rewrote README to describe CodexMobile as a local Codex mobile workbench rather than a thin upstream UI fork.
- Updated package metadata to describe the current mobile workbench scope.

### Fixed

- Fixed mobile abort so it interrupts desktop-side runs instead of only clearing the mobile state.
- Fixed desktop-origin sends not showing running and completed indicators in the mobile sidebar.
- Fixed mobile-created background threads briefly losing their live session during startup.
- Fixed refresh occasionally jumping to another conversation instead of restoring the selected project and session.
- Fixed duplicate running cards during mobile-to-desktop background handoff.
- Fixed a scroll jump that could move the conversation back to the top after a send.

### Notes

- `1.0.0` is the first stable local mobile Codex workbench release.
- iOS background notifications require an HTTPS Home Screen PWA. Local HTTP access still works for chat, sync, and foreground toast.
- `sync` is defined as `pull --ff-only` followed by `push` when the branch is ahead.
