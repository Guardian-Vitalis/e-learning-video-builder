export type ScriptEditsByNodeId = Record<string, string>;

type EffectiveScriptParams = {
  nodeId: string;
  baseScript: string;
  scriptEditsByNodeId?: ScriptEditsByNodeId;
};

type UpdateScriptEditParams = EffectiveScriptParams & {
  scriptText: string;
};

export function getEffectiveScriptForNode({
  nodeId,
  baseScript,
  scriptEditsByNodeId
}: EffectiveScriptParams): string {
  const edited = scriptEditsByNodeId?.[nodeId];
  return typeof edited === "string" ? edited : baseScript;
}

function normalize(text: string) {
  return text.trim().replace(/\r\n/g, "\n");
}

export function updateScriptEditsForNode({
  nodeId,
  baseScript,
  scriptText,
  scriptEditsByNodeId
}: UpdateScriptEditParams): ScriptEditsByNodeId | undefined {
  const normalizedBase = normalize(baseScript);
  const normalizedText = normalize(scriptText);
  const next = { ...(scriptEditsByNodeId ?? {}) };
  if (normalizedText === normalizedBase) {
    delete next[nodeId];
  } else {
    next[nodeId] = scriptText;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

type ScriptDraftSaveParams = EffectiveScriptParams & {
  scriptText: string;
  currentApprovalStatus?: "draft" | "approved";
  currentApprovedAt?: string;
};

export type ScriptDraftSaveResult = {
  scriptEditsByNodeId?: ScriptEditsByNodeId;
  nextApprovalStatus?: "draft" | "approved";
  nextApprovedAt?: string | undefined;
  resetApproval: boolean;
};

export function applyScriptDraftSave({
  nodeId,
  baseScript,
  scriptText,
  scriptEditsByNodeId,
  currentApprovalStatus,
  currentApprovedAt
}: ScriptDraftSaveParams): ScriptDraftSaveResult {
  const nextScriptEdits = updateScriptEditsForNode({
    nodeId,
    baseScript,
    scriptText,
    scriptEditsByNodeId
  });
  const wasApproved = currentApprovalStatus === "approved";
  return {
    scriptEditsByNodeId: nextScriptEdits,
    nextApprovalStatus: wasApproved ? "draft" : currentApprovalStatus,
    nextApprovedAt: wasApproved ? undefined : currentApprovedAt,
    resetApproval: wasApproved
  };
}
