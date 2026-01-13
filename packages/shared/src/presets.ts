export type AvatarPreset = {
  id: string;
  name: string;
  provider: "stub" | string;
  notes?: string;
};

export type VoicePreset = {
  id: string;
  name: string;
  provider: "stub" | string;
  locale?: string;
  notes?: string;
};

export type StylePreset = {
  id: string;
  name: string;
  provider: "stub" | string;
  notes?: string;
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "local_musetalk", name: "Local (MuseTalk)", provider: "local_musetalk" },
  { id: "stub_avatar_m1", name: "Mentor", provider: "stub" },
  { id: "stub_avatar_f1", name: "Instructor", provider: "stub" },
  { id: "stub_avatar_n1", name: "Narrator", provider: "stub" }
];

export const VOICE_PRESETS: VoicePreset[] = [
  { id: "stub_voice_en_us_1", name: "English (US) Neutral", provider: "stub", locale: "en-US" },
  { id: "stub_voice_en_ca_1", name: "English (CA) Neutral", provider: "stub", locale: "en-CA" },
  { id: "stub_voice_en_gb_1", name: "English (UK) Neutral", provider: "stub", locale: "en-GB" }
];

export const STYLE_PRESETS: StylePreset[] = [
  { id: "stub_style_clean", name: "Clean", provider: "stub" },
  { id: "stub_style_corporate", name: "Corporate", provider: "stub" },
  { id: "stub_style_modern", name: "Modern", provider: "stub" }
];

export function getAvatarPreset(id: string): AvatarPreset | undefined {
  return AVATAR_PRESETS.find((preset) => preset.id === id);
}

export function getVoicePreset(id: string): VoicePreset | undefined {
  return VOICE_PRESETS.find((preset) => preset.id === id);
}

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((preset) => preset.id === id);
}
