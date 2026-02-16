function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i += 1, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function interleaveChannels(
  view: DataView,
  offset: number,
  channelData: Float32Array[]
) {
  const sampleCount = channelData[0].length;
  const channelCount = channelData.length;
  for (let i = 0; i < sampleCount; i += 1) {
    for (let channel = 0; channel < channelCount; channel += 1, offset += 2) {
      const s = Math.max(-1, Math.min(1, channelData[channel][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const channelCount = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const sampleCount = buffer.length;
  const dataSize = sampleCount * channelCount * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // Audio format (PCM)
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  const channelData = [];
  for (let channel = 0; channel < channelCount; channel += 1) {
    channelData.push(buffer.getChannelData(channel));
  }
  const dataOffset = 44;
  interleaveChannels(view, dataOffset, channelData);
  return arrayBuffer;
}

function arrayBufferToBase64Internal(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function audioBufferToWavArrayBuffer(buffer: AudioBuffer): ArrayBuffer {
  return audioBufferToWav(buffer);
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return arrayBufferToBase64Internal(buffer);
}

async function decodeToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  if (typeof window === "undefined" || typeof window.AudioContext === "undefined") {
    throw new Error("WebAudio API unavailable");
  }
  const ctx = new window.AudioContext();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close().catch(() => undefined);
  }
}

export async function ensureWavBase64FromBlob(blob: Blob): Promise<{ base64: string; mime: string }> {
  const normalizedType = blob.type.toLowerCase();
  if (
    normalizedType === "audio/wav" ||
    normalizedType === "audio/x-wav" ||
    normalizedType === "audio/vnd.wave"
  ) {
    const base64 = arrayBufferToBase64Internal(await blob.arrayBuffer());
    return { base64, mime: "audio/wav" };
  }
  const audioBuffer = await decodeToAudioBuffer(blob);
  const wavBuffer = audioBufferToWav(audioBuffer);
  return { base64: arrayBufferToBase64Internal(wavBuffer), mime: "audio/wav" };
}
