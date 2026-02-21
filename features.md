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
