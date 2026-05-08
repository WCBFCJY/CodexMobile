# Changelog

All notable changes to CodexMobile are tracked here.

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
