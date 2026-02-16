"use client";

import { useEffect, useRef, useState } from "react";
import {
  adminJobsList,
  adminJobEvents,
  adminRecover,
  type AdminJobItem,
  type AdminJobEvent,
  type AdminRecoverResult,
  setCloudApiBaseUrl
} from "../../api/cloud";

export function OpsClient({ baseUrl, isDev }: { baseUrl: string; isDev: boolean }) {
  const [status, setStatus] = useState("running");
  const [limit, setLimit] = useState(50);
  const [jobs, setJobs] = useState<AdminJobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverResult, setRecoverResult] = useState<AdminRecoverResult | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<AdminJobEvent[] | null>(null);
  const [isTailing, setIsTailing] = useState(true);
  const [pollMs, setPollMs] = useState(2000);
  const [tailError, setTailError] = useState<string | null>(null);
  const [isFetchingEvents, setIsFetchingEvents] = useState(false);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set());
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const lastEventTsRef = useRef<number | null>(null);
  const previousKeysRef = useRef<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    setRecoverResult(null);
    setEvents(null);
    try {
      setCloudApiBaseUrl(baseUrl);
      const data = await adminJobsList({ status, limit });
      setJobs(data.items ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  const triggerRecovery = async () => {
    setLoading(true);
    setError(null);
    try {
      setCloudApiBaseUrl(baseUrl);
      const data = await adminRecover();
      setRecoverResult(data);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isDev) {
      load().catch(() => undefined);
    }
  }, [status, limit, isDev]);

  const eventKey = (event: AdminJobEvent) =>
    `${event.tsMs}:${event.type}:${JSON.stringify(event.data ?? {})}`;

  const loadDetails = async (jobId: string) => {
    setLoading(true);
    setError(null);
    setSelectedJobId(jobId);
    try {
      setCloudApiBaseUrl(baseUrl);
      const detail = await adminJobEvents(jobId);
      const nextEvents = detail.events ?? [];
      setEvents(nextEvents);
      const keys = new Set(nextEvents.map((event) => eventKey(event)));
      previousKeysRef.current = keys;
      lastEventTsRef.current =
        nextEvents.length ? nextEvents[nextEvents.length - 1].tsMs : null;
      setTailError(null);
      setIsTailing(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const pollEventsOnce = async () => {
    if (!selectedJobId || !isTailing) {
      return;
    }
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setIsFetchingEvents(true);
    try {
      setCloudApiBaseUrl(baseUrl);
      const detail = await adminJobEvents(selectedJobId);
      const nextEvents = detail.events ?? [];
      const lastTs = nextEvents.length ? nextEvents[nextEvents.length - 1].tsMs : null;
      const changed = lastTs !== lastEventTsRef.current;
      const nextKeys = new Set(nextEvents.map((event) => eventKey(event)));
      const prevKeys = previousKeysRef.current;
      const newKeys: string[] = [];
      for (const key of nextKeys) {
        if (!prevKeys.has(key)) {
          newKeys.push(key);
        }
      }
      setEvents(nextEvents);
      previousKeysRef.current = nextKeys;
      lastEventTsRef.current = lastTs;
      setTailError(null);
      if (changed && newKeys.length > 0) {
        setFlashKeys(new Set(newKeys));
        setTimeout(() => setFlashKeys(new Set()), 800);
        if (stickToBottom && scrollRef.current) {
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: "smooth"
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTailError(message);
    } finally {
      inFlightRef.current = false;
      setIsFetchingEvents(false);
    }
  };

  useEffect(() => {
    if (!selectedJobId || !isTailing) {
      return undefined;
    }
    let cancelled = false;
    const schedule = () => {
      pollTimerRef.current = setTimeout(async () => {
        if (cancelled) {
          return;
        }
        await pollEventsOnce();
        schedule();
      }, pollMs);
    };
    schedule();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [selectedJobId, isTailing, pollMs]);

  useEffect(() => {
    if (!selectedJobId) {
      setEvents(null);
      setFlashKeys(new Set());
      setTailError(null);
      setIsTailing(false);
      lastEventTsRef.current = null;
      previousKeysRef.current = new Set();
    }
  }, [selectedJobId]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance <= 24) {
      setStickToBottom(true);
    } else if (stickToBottom) {
      setStickToBottom(false);
    }
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setStickToBottom(true);
  };

  const copyDebugBundle = async () => {
    if (!selectedJobId) {
      return;
    }
    try {
      const latestEvents = (events ?? []).slice(-20);
      const lines = [
        `jobId: ${selectedJobId}`,
        `cloudBaseUrl: ${baseUrl.replace(/\/$/, "")}`,
        "urls:",
        `- ${baseUrl.replace(/\/$/, "")}/v1/jobs/${selectedJobId}`,
        `- ${baseUrl.replace(/\/$/, "")}/v1/admin/jobs/${selectedJobId}`,
        `- ${baseUrl.replace(/\/$/, "")}/v1/admin/jobs/${selectedJobId}/events`,
        "events:"
      ];
      for (const event of latestEvents) {
        const stamp = new Date(event.tsMs).toISOString();
        const data = event.data ? JSON.stringify(event.data) : "";
        lines.push(`- ${stamp} ${event.type} ${data}`.trim());
      }
      const text = lines.join("\n");
      if (!text) {
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedAt(Date.now());
      setTimeout(() => setCopiedAt(null), 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    }
  };

  if (!isDev) {
    return <p>Admin panel is available only in dev mode.</p>;
  }

  return (
    <div style={{ display: "grid", gap: "12px", maxWidth: "1000px" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            style={{ marginLeft: "8px" }}
          >
            <option value="running">running</option>
            <option value="queued">queued</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <label>
          Limit
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            style={{ marginLeft: "8px", width: "80px" }}
          />
        </label>
        <button type="button" onClick={() => load()} disabled={loading}>
          Refresh
        </button>
        <button type="button" onClick={() => triggerRecovery()} disabled={loading}>
          Run Recovery Scan
        </button>
      </div>
      {error && (
        <pre style={{ background: "#fee2e2", padding: "8px", borderRadius: "6px" }}>
          {error}
        </pre>
      )}
      {recoverResult && (
        <pre style={{ background: "#e0f2fe", padding: "8px", borderRadius: "6px" }}>
          {JSON.stringify(recoverResult, null, 2)}
        </pre>
      )}
      {loading && <p>Loading...</p>}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Job ID</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Status</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Updated</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Retries</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Lease</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Error</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>Events</th>
          </tr>
        </thead>
        <tbody>
          {jobs.length === 0 && !loading && (
            <tr>
              <td colSpan={7} style={{ padding: "8px" }}>
                No jobs found.
              </td>
            </tr>
          )}
          {jobs.map((job) => (
            <tr key={job.jobId}>
              <td style={{ padding: "6px 8px" }}>{job.jobId}</td>
              <td style={{ padding: "6px 8px" }}>{job.status}</td>
              <td style={{ padding: "6px 8px" }}>{job.updatedAt ?? "n/a"}</td>
              <td style={{ padding: "6px 8px" }}>{job.retryCount ?? 0}</td>
              <td style={{ padding: "6px 8px" }}>
                {job.leaseOk ? "ok" : "missing"}{" "}
                {job.leaseTtlMs !== null && typeof job.leaseTtlMs === "number"
                  ? `${job.leaseTtlMs}ms`
                  : ""}
              </td>
              <td style={{ padding: "6px 8px" }}>
                {(job.lastError ?? "").slice(0, 120)}
              </td>
              <td style={{ padding: "6px 8px" }}>
                <button type="button" onClick={() => loadDetails(job.jobId)}>
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selectedJobId && (
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "12px" }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Events for {selectedJobId}</h3>
            <button type="button" onClick={() => loadDetails(selectedJobId)}>
              Refresh now
            </button>
            <button type="button" onClick={() => setIsTailing((value) => !value)}>
              {isTailing ? "Pause" : "Resume"}
            </button>
            <label>
              Poll ms
              <input
                type="number"
                min={500}
                value={pollMs}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next) && next >= 500) {
                    setPollMs(next);
                  }
                }}
                style={{ marginLeft: "8px", width: "90px" }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={stickToBottom}
                onChange={(event) => setStickToBottom(event.target.checked)}
              />{" "}
              Stick to bottom
            </label>
            {!stickToBottom && (
              <button type="button" onClick={jumpToLatest}>
                Jump to latest
              </button>
            )}
            <button type="button" onClick={copyDebugBundle}>
              Copy debug bundle
            </button>
          </div>
          {tailError && (
            <p style={{ color: "#b45309" }}>Events polling error: {tailError}</p>
          )}
          {isFetchingEvents && <p>Fetching events...</p>}
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{
              maxHeight: "320px",
              overflow: "auto",
              border: "1px solid #e5e7eb",
              padding: "8px",
              marginTop: "8px",
              background: "transparent"
            }}
          >
            {events && events.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: "16px" }}>
                {events.map((event, idx) => (
                  <li
                    key={`${event.tsMs}-${idx}`}
                    style={{
                      transition: "background-color 0.4s ease",
                      backgroundColor: flashKeys.has(eventKey(event))
                        ? "#fef9c3"
                        : "transparent"
                    }}
                  >
                    {new Date(event.tsMs).toLocaleString()} {event.type}{" "}
                    {event.data ? JSON.stringify(event.data).slice(0, 200) : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No events available.</p>
            )}
          </div>
          {copiedAt && <p>Copied debug bundle.</p>}
        </div>
      )}
    </div>
  );
}
