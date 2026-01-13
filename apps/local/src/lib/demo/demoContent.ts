import type { DraftManifest } from "@evb/shared";

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function buildDemoProjectName(now = new Date()) {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}`;
  return `Demo Project ${stamp}`;
}

export function buildDemoDraftManifest(projectName: string): DraftManifest {
  const now = new Date().toISOString();
  return {
    manifestVersion: "0.1",
    courseTitle: projectName,
    doc: {
      fileName: "demo-docx-placeholder.docx",
      fileSize: 0,
      lastModified: Date.now(),
      storedAt: now
    },
    sections: [
      {
        id: "demo-1",
        title: "Welcome & Objectives",
        level: 1,
        selected: true,
        script:
          "Welcome to the course. In this module we will cover the goals, timeline, and how to navigate the material. By the end, you will know what success looks like and how to track your progress.",
        mediaRefs: []
      },
      {
        id: "demo-2",
        title: "Key Concepts Overview",
        level: 1,
        selected: true,
        script:
          "We introduce the three core concepts and how they connect. Pay attention to the definitions and the examples, because they form the foundation for the rest of the training.",
        mediaRefs: []
      },
      {
        id: "demo-3",
        title: "Process Walkthrough",
        level: 1,
        selected: true,
        script:
          "Follow the step-by-step walkthrough. First, gather inputs. Next, apply the standard checks. Finally, document your output so the team can reuse it.",
        mediaRefs: []
      },
      {
        id: "demo-4",
        title: "Common Mistakes",
        level: 1,
        selected: true,
        script:
          "Here are the top mistakes teams make and how to avoid them. Use the checklist to validate your work before handing it off.",
        mediaRefs: []
      },
      {
        id: "demo-5",
        title: "Scenario Practice",
        level: 1,
        selected: true,
        script:
          "We will run a short scenario so you can practice the workflow. Pause the video if you need extra time, then continue to compare your answer.",
        mediaRefs: []
      },
      {
        id: "demo-6",
        title: "Wrap-up & Next Steps",
        level: 1,
        selected: true,
        script:
          "Great work. Review the summary and download the artifacts for your records. When you are ready, move on to the next module.",
        mediaRefs: []
      }
    ]
  };
}
