const baseUrl = process.env.CLOUD_API_BASE_URL ?? "http://localhost:4000";

type CreateJobResponse = { jobId: string; status: { status: string } };

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createJob() {
  const res = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: "smoke",
      manifest: {
        manifestVersion: "0.1",
        courseTitle: "Smoke Job",
        approvedAt: new Date().toISOString(),
        draftSignature: "smoke",
        sections: [
          { id: "intro", title: "Intro", script: "Hello" },
          { id: "core", title: "Core", script: "Core" },
          { id: "wrap", title: "Wrap", script: "Bye" }
        ]
      },
      settings: {
        outputMode: "avatar_only",
        avatarPresetId: "avatar_a",
        voicePresetId: "voice_1",
        stylePresetId: "style_clean",
        sentencesPerClip: 2,
        variationsPerSection: 1,
        updatedAt: new Date().toISOString()
      }
    })
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`create failed ${res.status}: ${text}`);
  }
  return JSON.parse(text) as CreateJobResponse;
}

async function getJob(jobId: string) {
  const res = await fetch(`${baseUrl}/v1/jobs/${jobId}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`get failed ${res.status}: ${text}`);
  }
  return JSON.parse(text) as { status: string; progress: { phase: string; pct: number } };
}

async function run() {
  const { jobId } = await createJob();
  console.log(`jobId: ${jobId}`);

  while (true) {
    const job = await getJob(jobId);
    console.log(`${job.status} ${job.progress.phase} ${job.progress.pct}`);
    if (job.status === "succeeded" || job.status === "failed") {
      break;
    }
    await sleep(2000);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
