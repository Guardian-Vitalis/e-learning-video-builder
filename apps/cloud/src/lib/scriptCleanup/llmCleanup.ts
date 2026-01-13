type LlmCleanupResult = {
  cleanedText: string;
  warnings: string[];
  used: boolean;
};

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function getApiKey() {
  return process.env.EVB_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
}

function getModel() {
  return process.env.EVB_OPENAI_MODEL || "gpt-4o-mini";
}

export async function maybeLlmCleanup(args: {
  text: string;
  sectionId: string;
  variationIndex: number;
}): Promise<LlmCleanupResult> {
  const key = getApiKey();
  if (!key) {
    return { cleanedText: args.text, warnings: ["llm_requested_but_unavailable"], used: false };
  }

  const prompt = [
    "Rewrite the following training narration into spoken-friendly text.",
    "Preserve meaning, do not add facts. Keep short sentences.",
    "Return plain text only.",
    "",
    args.text
  ].join("\n");

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model: getModel(),
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    return {
      cleanedText: args.text,
      warnings: [`llm_error_${response.status}`],
      used: false
    };
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const cleaned = data.choices?.[0]?.message?.content?.trim();
  if (!cleaned) {
    return { cleanedText: args.text, warnings: ["llm_empty_response"], used: false };
  }
  return { cleanedText: cleaned, warnings: [], used: true };
}
