/**
 * Kith voice service for Kaori.
 *
 * Architecture:
 *   Browser <-- WS --> this server <-- WS --> Python sidecar (Pipecat)
 *   Backend --> HTTP POST /speak/:sessionId --> this server
 *
 * Each browser session gets its own PipecatRuntime (= its own Python
 * subprocess). The Backend fires text into it after generating Kaori's
 * response; the browser receives KithEvents (audio chunks, emotion, etc.)
 * over the WebSocket.
 */

import path from 'node:path';
import type { KithEvent } from '@kithjs/core';
import { consoleExporter, InMemoryObservability } from '@kithjs/observability';
import { PipecatRuntime } from '@kithjs/runtime-pipecat';
import {
  DEFAULT_BOARD_SPORTS_SLANG,
  DEFAULT_ENGLISH_SLANG,
  DEFAULT_GENZ_SLANG,
  DEFAULT_LAUGH_TAGS,
  type VoiceCharacter,
  VoiceRouter,
  voiceCharacterToRuntimeConfig,
} from '@kithjs/voice-router';
import type { ServerWebSocket } from 'bun';

import kaoriProfile from './kaori-character.json' with { type: 'json' };

const character = kaoriProfile as VoiceCharacter;

const PORT = Number(process.env.PORT ?? 3040);
const ROOT = path.dirname(Bun.fileURLToPath(import.meta.url));
const PYTHON_VENV =
  process.env.PIPECAT_PYTHON_PATH ||
  path.resolve(ROOT, '../node_modules/@kithjs/runtime-pipecat/python/.venv/bin/python');
const PYTHON_CWD =
  process.env.PIPECAT_PYTHON_CWD ||
  path.resolve(ROOT, '../node_modules/@kithjs/runtime-pipecat/python');

const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID ?? 'klHOJHbGA89BjwulA7MN';
const modelId = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_v3';

if (!apiKey) {
  console.error('ELEVENLABS_API_KEY must be set. See kith-voice/.env.example');
  process.exit(2);
}

const KAORI_SLANG = {
  ...DEFAULT_ENGLISH_SLANG,
  ...DEFAULT_GENZ_SLANG,
  ...DEFAULT_BOARD_SPORTS_SLANG,
  ...DEFAULT_LAUGH_TAGS,
  ...(character.slang ?? {}),
};

interface Session {
  runtime: PipecatRuntime;
  voice: VoiceRouter;
  obs: InMemoryObservability;
  unsubscribe: () => void;
  ws: ServerWebSocket<WsData>;
}

interface WsData {
  sessionId: string;
}

const sessions = new Map<string, Session>();

async function createSession(sessionId: string, ws: ServerWebSocket<WsData>): Promise<Session> {
  const obs = new InMemoryObservability();
  obs.onRecord(consoleExporter);

  const runtime = new PipecatRuntime({
    pythonPath: PYTHON_VENV,
    cwd: PYTHON_CWD,
    observability: obs,
    config: {
      pipeline: 'elevenlabs',
      apiKey,
      voiceId,
      modelId,
      ...voiceCharacterToRuntimeConfig(character),
      outputFormat: 'mp3_44100_128',
    },
  });

  await runtime.connect({ sessionId });

  /** Clean up AI-generated text for natural TTS output. */
  const cleanForTTS = (text: string): string => {
    let t = text;
    // Strip markdown bold/italic
    t = t.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
    // Strip markdown links [text](url) → text
    t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    // Collapse repeated punctuation (!!!! → !)
    t = t.replace(/([!?.]){2,}/g, '$1');
    // Collapse extended vowels not caught by slang (e.g. "soooooo" → "so")
    t = t.replace(/([a-z])\1{3,}/gi, '$1$1');
    // Strip emoji shortcodes like :sparkles:
    t = t.replace(/:[a-z_]+:/g, '');
    return t;
  };

  const voice = new VoiceRouter({
    runtime,
    character,
    slang: KAORI_SLANG,
    transforms: [cleanForTTS],
  });

  const unsubscribe = voice.on((event: KithEvent) => {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // ws closed
    }
  });

  return { runtime, voice, obs, unsubscribe, ws };
}

async function teardownSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  session.unsubscribe();
  session.voice.destroy();
  try {
    await session.runtime.disconnect();
  } catch (err) {
    console.error(`[kith] disconnect failed session=${sessionId}:`, err);
  }
  console.log(`[kith] session torn down: ${sessionId}`);
}

const server = Bun.serve<WsData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for browser clients
    if (url.pathname === '/ws') {
      const sessionId = crypto.randomUUID();
      const ok = server.upgrade(req, { data: { sessionId } });
      if (ok) return undefined;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // HTTP endpoint for Backend to trigger speech
    if (url.pathname.startsWith('/speak/') && req.method === 'POST') {
      const sessionId = url.pathname.slice('/speak/'.length);
      const session = sessions.get(sessionId);
      if (!session) {
        return Response.json({ error: 'session not found', sessionId }, { status: 404 });
      }

      try {
        const body = (await req.json()) as { text: string };
        if (!body.text || typeof body.text !== 'string') {
          return Response.json({ error: 'text is required' }, { status: 400 });
        }
        // Fire-and-forget: speak runs async, we respond immediately
        session.voice.speak(body.text).catch((err) => {
          console.error(`[kith] speak failed session=${sessionId}:`, err);
        });
        return Response.json({ ok: true, sessionId });
      } catch (err) {
        console.error(`[kith] /speak error:`, err);
        return Response.json({ error: 'internal error' }, { status: 500 });
      }
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        sessions: sessions.size,
        uptime: process.uptime(),
      });
    }

    return new Response('Kith voice service for Kaori', { status: 200 });
  },
  websocket: {
    async open(ws: ServerWebSocket<WsData>) {
      const { sessionId } = ws.data;
      console.log(`[kith] ws open session=${sessionId}`);

      try {
        const session = await createSession(sessionId, ws);
        sessions.set(sessionId, session);
        ws.send(JSON.stringify({ type: '_ready', sessionId }));
      } catch (err) {
        console.error(`[kith] session create failed session=${sessionId}:`, err);
        ws.close(1011, 'runtime connect failed');
      }
    },
    async message(ws: ServerWebSocket<WsData>, raw) {
      const { sessionId } = ws.data;
      const session = sessions.get(sessionId);
      if (!session) return;

      let msg: { type: string; text?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'speak' && typeof msg.text === 'string') {
        try {
          await session.voice.speak(msg.text);
        } catch (err) {
          console.error(`[kith] speak failed session=${sessionId}:`, err);
        }
      } else if (msg.type === 'barge-in') {
        await session.runtime.bargeIn();
      }
    },
    async close(ws: ServerWebSocket<WsData>) {
      const { sessionId } = ws.data;
      console.log(`[kith] ws close session=${sessionId}`);
      await teardownSession(sessionId);
    },
  },
});

console.log(`[kith] Kaori voice service listening on http://localhost:${server.port}`);
