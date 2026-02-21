# Forge Features (Current Working Baseline)

Last updated: 2026-02-21

## What is working now

- Spawn works for each configured CLI session type (Claude, Gemini, Codex, Copilot, Qwen, Local LLM).
- Spawns open as interactive sessions (no loop required just to start a tab).
- A goal can be sent at spawn time and is written into the session after startup.
- Synthesis jobs appear in the sidebar with status/progress and final session id.
- Synthesis execution currently works only with Claude.
- When synthesis completes, Forge opens a resumed Claude tab for the synthesized session.

## Claude-specific enablement (why Claude works for synthesis today)

Forge currently has Claude-only synthesis plumbing in the Electron main process:

1. Hidden one-shot run support:
   - Uses `claude -p "<goal>"` for background runs.
   - Uses `--no-session-persistence` for fan-out parallel runs.
2. Session-based synthesis finalization:
   - Generates a session id and runs final synthesis with `--session-id <id>`.
   - Resumes in UI using `claude --resume <sessionId>`.
3. Parallel authenticated isolation:
   - Creates a temporary HOME per hidden run.
   - Copies Claude credentials/settings into that isolated HOME so parallel runs stay authenticated.
4. Config safety guard:
   - Checks for corrupted `~/.claude.json` and restores from a valid backup when available.

## CLI non-interactive command notes

Not all CLIs should use `-p`.

| CLI | Command pattern | Notes |
| --- | --- | --- |
| Claude | `claude -p "<prompt>"` | Used for hidden one-shot synthesis runs. |
| Gemini | `gemini -p "<prompt>"` | Uses `-p`. |
| Codex | `codex exec "<prompt>" --skip-git-repo-check` | Works, but prints extra startup metadata before the answer. |
| Copilot | Unknown (account not configured yet) | Expected to need its own command format. |
| Qwen | `qwen -p "<prompt>"` | Uses `-p`. |
| Ollama (Local LLM) | `ollama run llama3 "<prompt>"` | Does not use `-p`. |

## Known resume commands

- Claude: `claude --resume <session-id>`
- Codex: `codex resume <session-id>`
  - Example: `codex resume 019c7dd6-ef20-7cd0-98dd-eef22663a36f`
- Gemini: `gemini --resume <session-id>`
  - Example: `gemini --resume 23e17de4-f01f-4849-a22e-dc7a221d6412`
- Copilot: `copilot --resume <session-id>`
- Qwen: `qwen --resume <session-id>`

## Requested next adjustments (documentation of current direction)

- Auto selector can be removed if product behavior should always route to Claude.
- In sidebar synthesis rows, add a delete action to remove completed/old synthesis jobs.
- Add double-click on a synthesis row to spawn/resume that synthesized session and optionally start looped continuation.
- Normalize one-shot command handling per CLI instead of assuming `-p` everywhere.
- Add a Forge app icon for the taskbar/window icon so the app no longer shows the default Electron logo.
- Apply the `ENAMETOOLONG` prevention pattern to all CLIs in hidden/non-interactive runs:
  - Avoid passing large synthesized prompts as command-line args.
  - Pipe large prompt payloads via stdin instead.
  - Keep per-CLI session-id flags/args small and model-specific.
- Fix session terminal scrollbar behavior so the scrollbar is fully draggable (not only wheel/track scroll).
- Fix window management behavior for desktop usability:
  - Allow restoring from maximized back to normal/medium window size reliably.
  - Allow manual window resize from edges/corners.
  - Allow dragging the window across the screen and between monitors.

## Future: multi-model synthesis (after each CLI is fully working)

After all CLIs are working reliably, synthesis should support selecting multiple models and per-model iteration counts.

### Example A

- Selection:
  - Claude: 2 iterations
  - Codex: 2 iterations
- Expected behavior:
  - Start 2 synthesis sidebar jobs (one Claude job, one Codex job).
  - Each model runs its own 2 iterations (4 total base outputs across both models).
  - Then produce 2 synthesized finals:
    - Claude synthesizes all 4 outputs (shows 4/4) and opens a resumed Claude tab.
    - Codex synthesizes all 4 outputs (shows 4/4) and opens a resumed Codex tab.
  - Resume commands should be model-specific:
    - Claude: `claude --resume <sessionId>`
    - Codex: `codex resume <sessionId>`

### Example B

- Selection:
  - Claude: 1 iteration
  - Codex: 1 iteration
  - Gemini: 1 iteration
  - Qwen: 1 iteration
- Expected behavior:
  - Start 4 sidebar sessions/jobs (one per model), each at 1/1.
  - Combine all 4 base outputs.
  - Each model synthesizes across the same full set of 4 outputs.
  - Open 4 resumed tabs (one per model), assuming each CLI supports `--resume` or an equivalent resume mechanism.

## Messaging connectivity priority (updated)

Prefer WhatsApp connectivity first as the default external chat path because onboarding/linking is currently easier and already validated.

- Primary plan:
  - Implement WhatsApp channel support before Telegram.
  - Treat WhatsApp as the default control + delivery channel until Telegram is production-ready.
- Auth/linking flow to support:
  - QR flow: `npm run auth`
  - Pairing-code fallback: `npm run auth -- --pairing-code --phone <E164-number>`
  - Persist successful auth state and reuse it across restarts.
- Product behavior expectation:
  - If WhatsApp is connected, Forge can receive prompts and return final answers there.
  - Telegram remains a later-phase channel (kept in this doc as the next expansion after WhatsApp is stable).

## Future: Docker runtime option (optional but recommended)

Add Docker as an optional runtime mode for portability, isolation, and simpler environment setup across machines.

1. Docker health + onboarding
- Detect Docker availability on startup (`docker` on PATH + `docker info`).
- Show clear status in Forge settings:
  - Docker not installed
  - Docker installed but engine not running
  - Docker ready
- Add one-click diagnostics output to help users fix environment issues quickly.

2. Execution modes
- Keep native host mode as default.
- Add per-session runtime selection:
  - `native`
  - `docker`
- In Docker mode, run CLI sessions inside containers with workspace mounts.

3. Containerized messaging bridge (optional)
- Support running WhatsApp/Telegram bridge workers in containers.
- Persist auth/session data in Docker volumes so restarts do not lose linking state.
- Keep bridge logs separate from core Forge app logs.

4. Compose-based local stack
- Add `docker compose` profile(s) for:
  - Forge side services
  - Optional WhatsApp bridge
  - Optional local model stack (e.g., Ollama)
- Keep this optional so local-native workflows still work.

5. Security and secrets
- Mount only required paths.
- Use env files/secret files for tokens, never long command-line args.
- Reuse ENAMETOOLONG protections for any container dispatch path by sending large prompts over stdin or temp-file handoff.

## Future: Telegram connectivity (best implementation plan)

Reference codebases reviewed:

- `C:\Users\Blake\dev\openclaw` (primary implementation reference; production-grade Telegram channel)
- `C:\Users\Blake\dev\pynchy` (plugin-first channel architecture patterns)
- `C:\Users\Blake\dev\nanoclaw` (skill-based Telegram bootstrap patterns, archived examples)
- `C:\Users\Blake\dev\oh-my-opencode` (no equivalent Telegram channel runtime to reuse directly)

### Recommended baseline to copy into Forge

Use the `openclaw` approach as the default blueprint, then keep it modular like `pynchy` so Telegram can be enabled/disabled without touching core orchestration logic.

### Implementation requirements (OpenClaw-first)

1. Channel architecture
- Add a dedicated Telegram channel module with clear boundaries:
  - inbound update intake (polling/webhook)
  - outbound send API
  - access control/policy checks
  - command handling/menu sync
  - topic/thread routing helpers
- Keep Telegram isolated from core synthesis/session engine so failures do not block local app usage.

2. Auth and config
- Support token loading order:
  - `tokenFile` (preferred for secrets)
  - explicit config value
  - env fallback
- Add multi-account-ready config shape from day one (even if only one account used initially).
- Redact bot tokens from logs/errors.

3. Ingress mode (polling + webhook)
- Support both polling and webhook modes.
- In webhook mode, require non-empty `webhookSecret` and reject startup if missing.
- Verify webhook secret on inbound requests.
- Use short webhook callback timeout behavior (ack quickly; process asynchronously) to avoid retry storms.

4. Access control and safety
- Require numeric Telegram sender IDs in allowlists (`allowFrom`); do not authorize via `@username`.
- Separate DM and group policy controls:
  - `open`
  - `allowlist`
  - `disabled`
- Add per-group/per-topic overrides for policy, skills, and allowlists.

5. Outbound reliability
- Centralize Telegram sends through one helper with retry/backoff.
- Handle `429` and network/transient failures with retry and `retry_after` support.
- If formatted send fails (HTML/parse errors), retry as plain text.
- Handle `message_thread_id` failures by retrying without thread id when appropriate.

6. Topics, threads, and routing
- Support explicit topic targets using canonical syntax:
  - `<chatId>:topic:<threadId>`
- Preserve thread context for replies in groups and DM topic threads.
- Store route/session metadata so Telegram conversations map predictably to Forge sessions.

7. Media handling
- Add robust media fetch/send pipeline with retries.
- If inbound media download fails, continue with text and placeholder metadata instead of dropping the whole turn.
- Handle Telegram API size limits gracefully (do not hard-fail the conversation).

8. Commands and UX
- Normalize slash command names to Telegram-safe format (hyphen to underscore, length/pattern-safe).
- Cap menu registration to Telegram limits (100 commands) and warn on overflow.
- Keep plugin/custom commands callable even if some are hidden from Telegram menu.

9. Response delivery behavior
- For external messaging surfaces (Telegram), deliver final answers only by default.
- Keep draft/streaming internals for local UI if needed, but avoid noisy partial output to chat users.

10. Forge-specific integration behavior
- Add a Telegram account in Forge settings (token/tokenFile, mode, allowlists, default destination).
- Allow Telegram message -> start or resume Forge session.
- Allow Forge answer -> send back to Telegram with reply context preserved.
- Add optional "control-only" mode (Telegram can trigger actions but does not receive every outbound result).

### ENAMETOOLONG hardening for Telegram and future CLIs

- Reuse the same fix pattern applied to Claude synthesis:
  - never pass large synthesized prompt payloads as command-line args
  - write prompts via stdin or temp-file handoff
  - keep CLI args short (`--resume`, ids, flags only)
- Apply this to any Telegram-triggered CLI dispatch path so large chat context cannot break spawn.

### Rollout phases

Phase 1 (MVP):
- One Telegram account, polling mode, numeric allowlist, final-text replies, no media.

Phase 2 (stable):
- Webhook mode + secret validation, retry/backoff, topic routing, media reliability, command menu sync.

Phase 3 (advanced):
- Multi-account routing, per-topic policies/skills, control-only mode, outbound action tools (polls/stickers/topic create).

### Test plan required before enabling by default

- Unit tests:
  - allowlist normalization and numeric-id enforcement
  - webhook secret required in webhook mode
  - command normalization and menu cap behavior
  - target parsing for `<chatId>:topic:<threadId>`
  - retry/fallback behavior (429, parse errors, thread-not-found)
- Integration tests:
  - Telegram inbound message starts Forge session
  - Forge final answer returns to same chat/thread
  - resume mapping remains correct across restarts
