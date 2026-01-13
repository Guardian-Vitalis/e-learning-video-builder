"use client";

import Link from "next/link";
import {
  GenerationSettings,
  getAvatarPreset,
  getVoicePreset,
  getStylePreset
} from "@evb/shared";

type Props = {
  settings: GenerationSettings | undefined;
  projectId?: string;
};

export default function SettingsSummaryCard({ settings, projectId }: Props) {
  if (!settings) {
    return (
      <section className="card space-y-2">
        <h2>Settings</h2>
        <p>No settings yet.</p>
        {projectId && (
          <Link
            href={`/projects/${projectId}/settings`}
            className="btn-secondary inline-flex w-fit"
          >
            Configure settings
          </Link>
        )}
      </section>
    );
  }

  return (
    <section className="card space-y-2">
      <h2>Settings</h2>
      <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <p>Output mode: {settings.outputMode}</p>
        <p>
          Avatar: {getAvatarPreset(settings.avatarPresetId)?.name ?? "Unknown preset"}
        </p>
        <p>
          Voice: {getVoicePreset(settings.voicePresetId)?.name ?? "Unknown preset"}
        </p>
        <p>
          Style: {getStylePreset(settings.stylePresetId)?.name ?? "Unknown preset"}
        </p>
        <p>Sentences per clip: {settings.sentencesPerClip}</p>
        <p>Variations: {settings.variationsPerSection} per section</p>
      </div>
      <p className="text-xs text-slate-500">
        Updated: {new Date(settings.updatedAt).toLocaleString()}
      </p>
      {projectId && (
        <Link
          href={`/projects/${projectId}/settings`}
          className="btn-secondary inline-flex w-fit"
        >
          Edit settings
        </Link>
      )}
    </section>
  );
}
