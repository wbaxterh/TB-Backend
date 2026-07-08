# Kith Python sidecar (vendored)

Git-tracked copy of `@kithjs/runtime-pipecat`'s Python sidecar, kept here so
our local patch survives `bun install` wiping `node_modules`.

**Local patch:** `kith_runtime/elevenlabs_pipeline.py` forwards the ElevenLabs
`speed` voice setting (upstream drops it). Without this, `voice.speed` in
`kaori-character.json` is silently ignored.

`../src/server.ts` defaults the sidecar path to this folder
(`PYTHON_VENV`/`PYTHON_CWD`), overridable via `PIPECAT_PYTHON_PATH` /
`PIPECAT_PYTHON_CWD`. The boot log prints the resolved paths.

## Setup (once per machine — local and EC2)

The `.venv/` is machine-specific and gitignored; rebuild it with:

```bash
bash python-sidecar/setup.sh
```

Prereq: **`uv`** (recommended — auto-fetches CPython 3.11) or a system
**python3.11**. Install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`.
Deps are pinned in `requirements-lock.txt`; regenerate with
`uv pip freeze --python .venv/bin/python`.

## EC2 deploy notes

- kith-voice is a **Bun** service (`bun src/server.ts`) — install Bun on the
  box and have **PM2 launch it with bun**, not node
  (`pm2 start bun --interpreter none -- src/server.ts`).
- Run `setup.sh` once after checkout (needs uv or python3.11); the venv is
  not in git.
- Do not enable the `[pipecat]` extra without pinning it (it's a 0.0.x
  pre-release); the ElevenLabs path doesn't need it.
