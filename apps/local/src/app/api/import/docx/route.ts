export const runtime = "nodejs";

const UPSTREAM_BASE = "http://127.0.0.1:4000";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(400, { code: "invalid_form", message });
  }

  const file = form.get("file");
  if (!file) {
    return jsonResponse(400, { code: "missing_file", message: "No file uploaded" });
  }
  if (!(file instanceof File)) {
    return jsonResponse(400, { code: "invalid_file", message: "Upload must be a file" });
  }

  const forwardForm = new FormData();
  forwardForm.append("file", file, file.name || "upload.docx");
  const projectId = form.get("projectId");
  if (typeof projectId === "string") {
    forwardForm.append("projectId", projectId);
  }
  const filename = form.get("filename");
  if (typeof filename === "string") {
    forwardForm.append("filename", filename);
  }

  const upstreamUrl = `${UPSTREAM_BASE}/v1/import/docx`;
  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      body: forwardForm
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(502, {
      code: "cloud_unreachable",
      message: "Could not reach preview generator",
      detail: message,
      upstreamUrl
    });
  }

  const text = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return new Response(text, {
      status: upstreamResponse.status,
      headers: { "Content-Type": "application/json" }
    });
  }

  return jsonResponse(upstreamResponse.status, {
    code: "upstream_non_json",
    message: text.slice(0, 2000),
    upstreamUrl
  });
}
