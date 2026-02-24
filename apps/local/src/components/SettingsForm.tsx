"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import {
  GenerationSettings,
  OutputMode,
  AVATAR_PRESETS,
  VOICE_PRESETS,
  STYLE_PRESETS,
  getAvatarPreset,
  getVoicePreset,
  getStylePreset
} from "@evb/shared";
import { setGenerationSettings, ValidationError } from "../lib/storage/projectsStore";
import SaveStatus from "./ui/SaveStatus";

type Props = {
  projectId: string;
  settings: GenerationSettings;
  onChange: (settings: GenerationSettings) => void;
  onSaved: (projectId: string) => void;
  onStorageError: (message: string, details?: string) => void;
};


export default function SettingsForm({
  projectId,
  settings,
  onChange,
  onSaved,
  onStorageError
}: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const avatarPresets = AVATAR_PRESETS ?? [];
  const voicePresets = VOICE_PRESETS ?? [];
  const stylePresets = STYLE_PRESETS ?? [];

  const update = <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => {
    setSaved(false);
    setFieldErrors(null);
    setSaveState("idle");
    onChange({ ...settings, [key]: value });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveState("saving");
    try {
      const avatarPresetId =
        settings.avatarPresetId || (avatarPresets?.[0]?.id ?? "");
      const voicePresetId =
        settings.voicePresetId || (voicePresets?.[0]?.id ?? "");
      const stylePresetId =
        settings.stylePresetId || (stylePresets?.[0]?.id ?? "");

      setGenerationSettings(projectId, {
        outputMode: settings.outputMode,
        avatarPresetId,
        voicePresetId,
        stylePresetId,
        sentencesPerClip: settings.sentencesPerClip,
        variationsPerSection: settings.variationsPerSection
      });
      setSaving(false);
      setSaved(true);
      setFieldErrors(null);
      setSaveState("saved");
      onSaved(projectId);
    } catch (err) {
      if (err instanceof ValidationError) {
        setFieldErrors(err.fieldErrors ?? null);
        setSaving(false);
        setSaved(false);
        setSaveState("error");
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setSaving(false);
      setSaved(false);
      setSaveState("error");
      onStorageError("Unable to save changes locally.", message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-medium text-slate-700">
          Output mode
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="outputMode"
            value="avatar_only"
            checked={settings.outputMode === "avatar_only"}
            onChange={() => update("outputMode", "avatar_only" as OutputMode)}
          />
          Avatar-only
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="outputMode"
            value="avatar_plus_slides"
            checked={settings.outputMode === "avatar_plus_slides"}
            onChange={() => update("outputMode", "avatar_plus_slides" as OutputMode)}
          />
          Avatar + slides
        </label>
        {fieldErrors?.outputMode && (
          <p role="alert" className="text-xs text-red-600">
            {fieldErrors.outputMode}
          </p>
        )}
      </fieldset>

      <div>
        <label htmlFor="avatarPresetId">Avatar backend</label>
        <select
          id="avatarPresetId"
          value={settings.avatarPresetId}
          onChange={(event) => update("avatarPresetId", event.target.value)}
        >
          {!getAvatarPreset(settings.avatarPresetId) && settings.avatarPresetId && (
            <option value={settings.avatarPresetId}>
              Unknown preset ({settings.avatarPresetId})
            </option>
          )}
          {avatarPresets.length === 0 ? (
            <option value="" disabled>
              (loading presets)
            </option>
          ) : (
            avatarPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))
          )}
        </select>
        <p className="helper-text">Choose which avatar engine renders the clips.</p>
        {fieldErrors?.avatarPresetId && (
          <p role="alert" className="text-xs text-red-600">
            {fieldErrors.avatarPresetId}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="voicePresetId">Voice preset</label>
        <select
          id="voicePresetId"
          value={settings.voicePresetId}
          onChange={(event) => update("voicePresetId", event.target.value)}
        >
          {!getVoicePreset(settings.voicePresetId) && settings.voicePresetId && (
            <option value={settings.voicePresetId}>
              Unknown preset ({settings.voicePresetId})
            </option>
          )}
          {voicePresets.length === 0 ? (
            <option value="" disabled>
              (loading presets)
            </option>
          ) : (
            voicePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))
          )}
        </select>
        <p className="helper-text">MVP presets are stubbed; IDs map to providers later.</p>
        {fieldErrors?.voicePresetId && (
          <p role="alert" className="text-xs text-red-600">
            {fieldErrors.voicePresetId}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="stylePresetId">Style preset</label>
        <select
          id="stylePresetId"
          value={settings.stylePresetId}
          onChange={(event) => update("stylePresetId", event.target.value)}
        >
          {!getStylePreset(settings.stylePresetId) && settings.stylePresetId && (
            <option value={settings.stylePresetId}>
              Unknown preset ({settings.stylePresetId})
            </option>
          )}
          {stylePresets.length === 0 ? (
            <option value="" disabled>
              (loading presets)
            </option>
          ) : (
            stylePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))
          )}
        </select>
        <p className="helper-text">MVP presets are stubbed; IDs map to providers later.</p>
        {fieldErrors?.stylePresetId && (
          <p role="alert" className="text-xs text-red-600">
            {fieldErrors.stylePresetId}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="sentencesPerClip">Sentences per clip</label>
        <input
          id="sentencesPerClip"
          type="number"
          min={1}
          max={5}
          value={settings.sentencesPerClip}
          onChange={(event) =>
            update("sentencesPerClip", Number(event.target.value))
          }
        />
        {fieldErrors?.sentencesPerClip && (
          <p role="alert" className="text-xs text-red-600">
            {fieldErrors.sentencesPerClip}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="variationsPerSection">Avatar variations per section</label>
        <input
          id="variationsPerSection"
          type="number"
          min={1}
          max={5}
          value={settings.variationsPerSection}
          onChange={(event) =>
            update("variationsPerSection", Number(event.target.value))
          }
        />
        <p className="helper-text">
          Simulates multiple camera angles / points of view for the same avatar.
        </p>
        {fieldErrors?.variationsPerSection && (
          <p role="alert" className="text-xs text-red-600">
            {fieldErrors.variationsPerSection}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </button>
        <SaveStatus state={saveState} />
      </div>
    </form>
  );
}
