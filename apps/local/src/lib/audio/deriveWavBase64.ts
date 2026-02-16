import { audioBufferToWavArrayBuffer, arrayBufferToBase64 } from "./wav";

export async function deriveWavBase64FromAudioBytes(input: {
  bytes: ArrayBuffer;
  mime?: string;
}): Promise<string> {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    throw new Error("WebAudio API unavailable");
  }
  const ctx = new window.AudioContext();
  try {
    const audioBuffer = await ctx.decodeAudioData(input.bytes.slice(0));
    const wavBuffer = audioBufferToWavArrayBuffer(audioBuffer);
    return arrayBufferToBase64(wavBuffer);
  } catch {
    const suffix = input.mime ? ` (${input.mime})` : "";
    throw new Error(`Unable to decode audio bytes${suffix}.`);
  } finally {
    ctx.close().catch(() => undefined);
  }
}
