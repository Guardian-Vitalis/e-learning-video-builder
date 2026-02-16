"use client";

import { useEffect, useState } from "react";
import { ApprovedManifest, GenerationSettings, JobRecord } from "@evb/shared";
import {
  CloudApiError,
  createGenerationJob,
  getJob,
  retryJob,
  setCloudApiBaseUrl
} from "../../api/cloud";

type Props = {
  baseUrl: string;
};

function buildManifest(title: string): ApprovedManifest {
  const approvedAt = new Date().toISOString();
  return {
    manifestVersion: "0.1",
    courseTitle: title,
    approvedAt,
    draftSignature: `demo_${approvedAt}`,
    sections: [
      {
        id: "intro",
        title: "Introduction",
        script: "Welcome to the course."
      },
      {
        id: "core",
        title: "Core Concepts",
        script: "Let's cover the core concepts."
      },
      {
        id: "wrap",
        title: "Wrap Up",
        script: "Thanks for watching."
      }
    ]
  };
}

export default function JobDemoClient({ baseUrl }: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pollKey, setPollKey] = useState(0);

  useEffect(() => {
    setCloudApiBaseUrl(baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await getJob(jobId);
        if (cancelled) {
          return;
        }
        setStatus(next);
        if (next.status === "succeeded" || next.status === "failed") {
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch (err) {
        if (cancelled) {
          return;
        }
        if (err instanceof CloudApiError) {
          setError(`Request failed (${err.status})`);
          setErrorDetails(err.body || "No response body");
        } else {
          const message = err instanceof Error ? err.message : String(err);
          setError("Cloud API unreachable.");
          setErrorDetails(message);
        }
        timer = setTimeout(poll, 2000);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [baseUrl, jobId, pollKey]);

  const onSubmit = async (title: string) => {
    setIsSubmitting(true);
    setError(null);
    setErrorDetails(null);
    setStatus(null);
    try {
      const settings: GenerationSettings = {
        outputMode: "avatar_only",
        avatarPresetId: "stub_avatar_m1",
        voicePresetId: "stub_voice_en_us_1",
        stylePresetId: "stub_style_clean",
        sentencesPerClip: 2,
        variationsPerSection: 1,
        updatedAt: new Date().toISOString()
      };
      const response = await createGenerationJob({
        projectId: "job-demo",
        manifest: buildManifest(title),
        settings
      });
      setJobId(response.jobId);
      setStatus(response.status);
      setPollKey((value) => value + 1);
    } catch (err) {
      if (err instanceof CloudApiError) {
        setError(`Request failed (${err.status})`);
        setErrorDetails(err.body || "No response body");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError("Cloud API unreachable.");
        setErrorDetails(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const onRetry = async () => {
    if (!jobId) {
      return;
    }
    setError(null);
    setErrorDetails(null);
    try {
      await retryJob(jobId);
      setPollKey((value) => value + 1);
    } catch (err) {
      if (err instanceof CloudApiError) {
        setError(`Request failed (${err.status})`);
        setErrorDetails(err.body || "No response body");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError("Cloud API unreachable.");
        setErrorDetails(message);
      }
    }
  };

  return (
    <main>
      <h1>Job Demo</h1>
      <p>Cloud API: {baseUrl}</p>
      <button
        type="button"
        onClick={() => onSubmit("Demo Lesson")}
        disabled={isSubmitting}
      >
        {isSubmitting ? "Submitting..." : "Start Demo Job"}
      </button>
      <button
        type="button"
        onClick={() => onSubmit("Failing Demo [FAIL]")}
        disabled={isSubmitting}
      >
        Start Failing Job
      </button>

      {error && (
        <>
          <p>{error}</p>
          {errorDetails && <pre>{errorDetails}</pre>}
        </>
      )}

      {status && (
        <>
          <h2>Job Status</h2>
          <p>Job ID: {status.id}</p>
          <p>State: {status.status}</p>
          <p>Progress: {status.progress.pct}</p>
          <p>Phase: {status.progress.phase}</p>
          {status.error && <p>Error: {status.error.message}</p>}
          {status.artifacts && (
            <>
              <h3>Artifacts</h3>
              <ul>
                <li>
                  <a href={`${baseUrl}${status.artifacts.mp4Path}`}>Download MP4</a>
                </li>
                <li>
                  <a href={`${baseUrl}${status.artifacts.vttPath}`}>Download VTT</a>
                </li>
                <li>
                  <a href={`${baseUrl}${status.artifacts.srtPath}`}>Download SRT</a>
                </li>
              </ul>
            </>
          )}
        </>
      )}

      {status?.status === "failed" && (
        <button type="button" onClick={onRetry}>
          Retry Job
        </button>
      )}
    </main>
  );
}
