#!/usr/bin/env bash
# Build the Kith Python sidecar virtualenv for THIS machine.
#
# Why vendored: the upstream sidecar lives in node_modules and is wiped by
# `bun install`. We keep a git-tracked copy here (with our patch that
# forwards the ElevenLabs `speed` voice setting the upstream pipeline drops)
# and build the venv alongside it, OUTSIDE node_modules, so voice survives
# reinstalls.
#
# Prereqs (install ONE): `uv` (recommended — auto-fetches CPython 3.11:
#   curl -LsSf https://astral.sh/uv/install.sh | sh) OR a system python3.11.
# The venv is machine-specific and gitignored — run this once per machine
# (local + EC2). Deps are pinned in requirements-lock.txt for reproducibility.
set -euo pipefail
cd "$(dirname "$0")"

LOCK="requirements-lock.txt"

if command -v uv >/dev/null 2>&1; then
  uv venv --python 3.11
  if [ -f "$LOCK" ]; then
    uv pip install -r "$LOCK" --python .venv/bin/python
    uv pip install -e . --no-deps --python .venv/bin/python
  else
    uv pip install -e . --python .venv/bin/python
  fi
elif command -v python3.11 >/dev/null 2>&1; then
  python3.11 -m venv .venv
  if [ -f "$LOCK" ]; then
    ./.venv/bin/pip install -r "$LOCK"
    ./.venv/bin/pip install -e . --no-deps
  else
    ./.venv/bin/pip install -e .
  fi
else
  echo "ERROR: need 'uv' or 'python3.11' on PATH." >&2
  echo "  Install uv (recommended): curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  echo "  uv auto-fetches CPython 3.11 — no system python3.11 required." >&2
  exit 1
fi

echo "Sidecar venv ready: $(pwd)/.venv"
echo "Verifying the speed patch (both halves) is present..."
PIPE="kith_runtime/elevenlabs_pipeline.py"
grep -q 'useSpeakerBoost", "speed"' "$PIPE" \
  && grep -q '"speed": settings.get("speed")' "$PIPE" \
  && echo "  speed forwarding: OK" \
  || { echo "  speed forwarding: MISSING — patch was lost, do not ship"; exit 1; }
