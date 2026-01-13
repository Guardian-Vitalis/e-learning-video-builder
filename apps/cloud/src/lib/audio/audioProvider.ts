import { spawn } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  estimateNarrationDurationMs,
  estimateSentenceDurationMs,
  normalizeCaptionText,
  splitIntoSentences
} from "../captions";

type SynthesizeInput = {
  text: string;
  voice: string;
  style: string;
  rate?: number;
  timing?: { cueStartsMs: number[]; durationMs: number };
};

export type SynthesizeResult = {
  path: string;
  durationMs: number;
  kind: "tts" | "placeholder";
};

type AudioProvider = {
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
};

type FfmpegResolution =
  | { kind: "env"; path: string; reason: string }
  | { kind: "static"; path: string; reason: string }
  | { kind: "none"; reason: string };

let cachedFfmpegPath: string | null | undefined;
let loggedTtsStatus = false;
let loggedAudioFallback = false;
const logFfmpegArgs = process.env.EVB_LOG_HTTP === "1";

function logTtsStatus(message: string) {
  if (loggedTtsStatus) {
    return;
  }
  loggedTtsStatus = true;
  try {
    console.log(message);
  } catch {
    // ignore log failures
  }
}

function logAudioFallback(message: string) {
  if (loggedAudioFallback) {
    return;
  }
  loggedAudioFallback = true;
  try {
    console.log(message);
  } catch {
    // ignore log failures
  }
}

async function resolveFfmpegPath(): Promise<FfmpegResolution> {
  if (cachedFfmpegPath !== undefined) {
    if (cachedFfmpegPath) {
      return { kind: "env", path: cachedFfmpegPath, reason: "cached" };
    }
    return { kind: "none", reason: "cached-none" };
  }

  if (process.env.EVB_DISABLE_FFMPEG === "1") {
    cachedFfmpegPath = null;
    return { kind: "none", reason: "EVB_DISABLE_FFMPEG" };
  }

  const envPath = process.env.EVB_FFMPEG_PATH;
  if (envPath && existsSync(envPath)) {
    cachedFfmpegPath = envPath;
    return { kind: "env", path: envPath, reason: "EVB_FFMPEG_PATH" };
  }

  try {
    const mod = await import("ffmpeg-static");
    const candidate = (mod as { default?: unknown } | unknown) as { default?: unknown } | unknown;
    const resolved =
      typeof candidate === "object" && candidate !== null && "default" in candidate
        ? (candidate as { default?: unknown }).default
        : candidate;
    const ffmpegPath = typeof resolved === "string" ? resolved : undefined;
    if (ffmpegPath && existsSync(ffmpegPath)) {
      cachedFfmpegPath = ffmpegPath;
      return { kind: "static", path: ffmpegPath, reason: "ffmpeg-static" };
    }
  } catch {
    // ignore
  }

  cachedFfmpegPath = null;
  return { kind: "none", reason: "ffmpeg-static-not-available" };
}

function runFfmpeg(args: string[], timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { windowsHide: true });
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("ffmpeg timed out"));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      if (logFfmpegArgs) {
        const idx = args.indexOf("-filter_complex");
        const filterValue = idx >= 0 ? args[idx + 1] : "";
        console.warn("[EVB] ffmpeg failed argv:", args.join(" "));
        if (filterValue) {
          console.warn("[EVB] ffmpeg filter_complex:", filterValue);
        }
      }
      const snippet = stderr.trim().split("\n").slice(-4).join("\n");
      reject(new Error(snippet || `ffmpeg exited with code ${code}`));
    });
  });
}

function escapeFfmpegExpr(expr: string) {
  return expr.replace(/(?<!\\),/g, "\\,").replace(/(?<!\\):/g, "\\:");
}

function countSentences(text: string) {
  return splitIntoSentences(text).length;
}

function derivePlaceholderTiming(text: string, wordsPerMinute = 170) {
  const sentences = splitIntoSentences(text);
  const normalized = sentences.map((sentence) => normalizeCaptionText(sentence));
  const startsMs: number[] = [];
  let cursorMs = 0;
  normalized.forEach((sentence) => {
    startsMs.push(cursorMs);
    const durationMs = estimateSentenceDurationMs(sentence, wordsPerMinute);
    cursorMs += durationMs;
  });
  const durationMs = Math.max(cursorMs, estimateNarrationDurationMs(text, wordsPerMinute));
  return { cueStartsMs: startsMs, durationMs };
}

function buildBeepVolumeExpression(startsMs: number[], beepDurationMs = 80) {
  if (startsMs.length === 0) {
    return "0";
  }
  const parts = startsMs.slice(0, 120).map((startMs) => {
    const startSec = (startMs / 1000).toFixed(3);
    const endSec = ((startMs + beepDurationMs) / 1000).toFixed(3);
    return `between(t,${startSec},${endSec})`;
  });
  return escapeFfmpegExpr(`if(${parts.join("+")},0.6,0)`);
}

function buildWavBuffer({
  durationMs,
  cueStartsMs,
  sampleRate = 48000
}: {
  durationMs: number;
  cueStartsMs: number[];
  sampleRate?: number;
}) {
  const totalSamples = Math.max(1, Math.ceil((durationMs / 1000) * sampleRate));
  const beepDurationSamples = Math.floor((80 / 1000) * sampleRate);
  const beepRanges = cueStartsMs.map((startMs) => {
    const startSample = Math.floor((startMs / 1000) * sampleRate);
    return [startSample, startSample + beepDurationSamples] as const;
  });

  const data = Buffer.alloc(totalSamples * 2);
  let beepIndex = 0;
  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const base = Math.sin(2 * Math.PI * 220 * t) * 0.12;
    let beep = 0;
    const range = beepRanges[beepIndex];
    if (range && i >= range[0] && i <= range[1]) {
      beep = Math.sin(2 * Math.PI * 880 * t) * 0.5;
      if (i >= range[1]) {
        beepIndex += 1;
      }
    } else if (range && i > range[1]) {
      beepIndex += 1;
    }
    const sample = Math.max(-1, Math.min(1, base + beep));
    data.writeInt16LE(Math.floor(sample * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

async function synthesizePlaceholder(input: SynthesizeInput): Promise<SynthesizeResult> {
  const rate = input.rate ?? 170;
  const timing = input.timing ?? derivePlaceholderTiming(input.text, rate);
  const durationMs = timing.durationMs;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-tts-"));
  const ffmpeg = await resolveFfmpegPath();
  const beepExpression = buildBeepVolumeExpression(timing.cueStartsMs);

  if (ffmpeg.kind !== "none") {
    const outPath = path.join(tmpDir, "narration.m4a");
    const durationSec = Math.max(1, Math.ceil(durationMs / 1000));
    const args = [
      ffmpeg.path,
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=220:sample_rate=48000:duration=${durationSec}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=880:sample_rate=48000:duration=${durationSec}`,
      "-filter_complex",
      `[1:a]volume=${beepExpression}[beep];[0:a][beep]amix=inputs=2:weights=1 0.7:normalize=0,atrim=0:${durationSec},asetpts=PTS-STARTPTS[aout]`,
      "-map",
      "[aout]",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outPath
    ];
    await runFfmpeg(args, 12000);
    return { path: outPath, durationMs, kind: "placeholder" };
  }

  const outPath = path.join(tmpDir, "narration.wav");
  const wav = buildWavBuffer({ durationMs, cueStartsMs: timing.cueStartsMs });
  await fs.writeFile(outPath, wav);
  logAudioFallback("[EVB] tts=placeholder ffmpeg=none using wav fallback");
  return { path: outPath, durationMs, kind: "placeholder" };
}

async function synthesizeOpenAi(input: SynthesizeInput): Promise<SynthesizeResult> {
  const apiKey = process.env.EVB_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logTtsStatus("[EVB] tts=openai missing key, falling back to placeholder");
    return synthesizePlaceholder(input);
  }
  const model = process.env.EVB_OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts";
  const voice = process.env.EVB_OPENAI_TTS_VOICE ?? "alloy";
  const speed = input.rate ? Math.max(0.25, Math.min(4, input.rate / 170)) : 1;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-tts-"));
  const outPath = path.join(tmpDir, "narration.mp3");

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      voice,
      input: input.text,
      format: "mp3",
      speed
    })
  });

  if (!res.ok) {
    logTtsStatus(`[EVB] tts=openai error=${res.status}, falling back to placeholder`);
    return synthesizePlaceholder(input);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buffer);
  const estimatedMs = estimateNarrationDurationMs(input.text, input.rate ?? 170);
  return { path: outPath, durationMs: estimatedMs, kind: "tts" };
}

async function synthesizeElevenLabs(input: SynthesizeInput): Promise<SynthesizeResult> {
  const apiKey = process.env.EVB_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.EVB_ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    logTtsStatus("[EVB] tts=elevenlabs missing config, falling back to placeholder");
    return synthesizePlaceholder(input);
  }
  const model = process.env.EVB_ELEVENLABS_MODEL ?? "eleven_monolingual_v1";
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "evb-tts-"));
  const outPath = path.join(tmpDir, "narration.mp3");

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify({
      text: input.text,
      model_id: model,
      voice_settings: {
        stability: 0.45,
        similarity_boost: 0.65
      }
    })
  });

  if (!res.ok) {
    logTtsStatus(`[EVB] tts=elevenlabs error=${res.status}, falling back to placeholder`);
    return synthesizePlaceholder(input);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buffer);
  const estimatedMs = estimateNarrationDurationMs(input.text, input.rate ?? 170);
  return { path: outPath, durationMs: estimatedMs, kind: "tts" };
}

export function getAudioProvider(): AudioProvider {
  const provider = (process.env.EVB_TTS_PROVIDER ?? "stub").toLowerCase();
  if (provider === "openai") {
    return { synthesize: synthesizeOpenAi };
  }
  if (provider === "elevenlabs") {
    return { synthesize: synthesizeElevenLabs };
  }
  if (provider !== "stub") {
    logTtsStatus(`[EVB] tts=${provider} unsupported, using placeholder`);
  }
  return { synthesize: synthesizePlaceholder };
}
