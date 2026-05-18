# Changelog

All notable changes to CodexMobile are tracked here.

## Unreleased

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
