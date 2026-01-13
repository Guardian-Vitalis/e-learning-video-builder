# Clip Generation Pipeline Map

This map summarizes the current planner → manifest → generator flow in `apps/local` for Loop 0 scoping.  
No behavior changes are made; this is only documentation for future work.

## 1. Clip Planner / Configuration
- **Component:** `apps/local/src/app/projects/[id]/ProjectWorkspaceClient.tsx`
  - *Functions:* `buildVariationDefaults`, `handlePreviewSelect`, `variationSelections` state (# lines 63‑1640)
  - *Data:* reads `manifest` from `projectsStore` and populates `clipManifests`, `previewLinks`, and `selections`.
  - *Role:* exposes planner UI (outline, review, preview card creation) and allows editors to build per-clip selections from the approved/draft manifest exported by the store.
- **Manifest Source:** `apps/local/src/lib/storage/projectsStore.ts`
  - *Functions:* `buildDraftManifest`, `buildApprovedManifest`, `updateDraftSection`, `getEnabledSections`
  - *Data:* drafts stored under `project.draftManifest`, approved manifests under `project.approvedManifest`.
  - *Role:* authoritative builder for `manifestVersion: "0.1"` sections, outlines, clips, and variations.

## 2. Manifest Schema & Build
- **Type definitions & runtime:** inferred from `apps/local/src/lib/storage/projectsStore.ts` (look for `manifestVersion === "0.1"` guards and the structure items the store builds/returns).  
- **Draft generation:** `buildDraftManifest` constructs sections with `outlineNodeId`, `script`, and `clipLengthSeconds` before selecting/approving.
- **Approved manifest usage:** `ProjectWorkspaceClient` uses `approvedManifest` for generating `clipManifests`, while `GeneratePanel` checks `project.approvedManifest` to allow generation.

## 3. Generation Entry Points
- **Dispatch layer:** `apps/local/src/lib/generation/generationDispatch.ts`
  - *Functions:* `checkGenerationGates`, `dispatchGenerationRequest`, `buildGenerationInputFromDraft`, `generateFromManifest`.
  - *Data:* consumes `project.approvedManifest` and outlines along with approval status.
  - *Role:* throws gate errors when manifest missing, builds the input, and issues `POST /v1/jobs` to the backend.
- **Generate Controls:** `apps/local/src/components/GeneratePanel.tsx`
  - *Functions:* `startGeneration`, `handleRetry`, `pollJobStatus`
  - *Data:* uses hooks such as `getJob`, `retryJob`, and monitors `project.status`.
  - *Role:* UI entry point for “Generate/Preview/Export” flows; once `dispatchGenerationRequest` runs it polls `jobId` and surfaces logs/artifacts.
- **Utility:** `apps/local/src/lib/generation/generationFiltering.ts`, `generationGating.test.ts`, `generationInputComposition.test.ts` hold helper logic for filtering sections and composing payloads used by dispatch.

## 4. Local Avatar Engine Integration
- **Client helper:** `apps/local/src/lib/localAvatarEngine.ts`
  - *Functions:* `submitPrepareAvatarJob`, `pollPrepareAvatarJobStatus`, `fetchPrepareAvatarArtifacts`, `resolveClipArtifacts`.
  - *Data:* calls `${NEXT_PUBLIC_EVB_LOCAL_AVATAR_ENGINE_URL ?? "http://127.0.0.1:5600"}` with job/clip payloads and polls statuses/artifacts.
- **Consumptions:**  
  - `apps/local/src/components/PrepareAvatarPanel.tsx` wires UI -> `localAvatarEngine` helpers for preparing avatars (submit, poll, preview).  
  - `apps/local/src/components/LocalAvatarEngineStatusPanel.tsx` fetches `/health/local-avatar` via helper functions and reports readiness.

## Data Flow Summary
1. **Planner** edits manifest drafts stored via `projectsStore`.
2. **Approval** converts draft into an approved manifest, consumed by `ProjectWorkspaceClient` for clip selection.
3. **Generation Panel** triggers `generationDispatch` using the approved manifest; dispatch builds the full payload and creates a cloud job.
4. **Local Avatar Engine** helpers are currently isolated to avatar preparation and health checks (`PrepareAvatarPanel`, status panel) but point toward the same engine URL needed for future clip generation integration.

Refer to the files above when extending the pipeline in future loops.
