"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  id: string;
  role: string;
  content: string;
}

interface ChatInterfaceProps {
  attemptId: string;
  initialMessages: Message[];
  timerSettings: { showCountdown: boolean; showElapsed: boolean };
  expiresAt: string;
  startedAt: string;
  submittedAt?: string | null;
  status?: string;
  completedAt?: string | null;
  onComplete: () => void;
  onAbort: () => void;
  readOnly?: boolean;
}

function parseDataStreamChunk(buffer: string, chunk: string): { text: string; remainder: string } {
  const combined = buffer + chunk;
  const lines = combined.split("\n");
  const remainder = lines.pop() ?? "";
  let text = "";

  for (const line of lines) {
    if (line.startsWith("0:")) {
      try {
        text += JSON.parse(line.slice(2));
      } catch {
        // wait for complete line
      }
    }
  }

  return { text, remainder };
}

export function ChatInterface({
  attemptId,
  initialMessages,
  timerSettings,
  expiresAt,
  startedAt,
  submittedAt,
  status,
  completedAt,
  onComplete,
  onAbort,
  readOnly = false,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState("");
  const [elapsed, setElapsed] = useState("");
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sessionEnded = status != null && status !== "IN_PROGRESS";
  const frozenAtMs =
    stoppedAt ??
    (submittedAt ? new Date(submittedAt).getTime() : null) ??
    (sessionEnded
      ? completedAt
        ? new Date(completedAt).getTime()
        : Date.now()
      : null);
  const timersFrozen = frozenAtMs != null;

  const focusInput = useCallback(() => {
    if (!readOnly) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [readOnly]);

  const updateTimer = useCallback(() => {
    const now = frozenAtMs ?? Date.now();
    const start = new Date(startedAt).getTime();
    const end = new Date(expiresAt).getTime();
    const rem = Math.max(0, end - now);
    const el = Math.max(0, now - start);
    const fmt = (ms: number) => {
      const s = Math.floor(ms / 1000);
      return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
    };
    setRemaining(fmt(rem));
    setElapsed(fmt(el));
    if (rem <= 0 && !readOnly && !timersFrozen) {
      window.location.reload();
    }
  }, [expiresAt, startedAt, readOnly, frozenAtMs, timersFrozen]);

  useEffect(() => {
    updateTimer();
    if (timersFrozen) return;
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [updateTimer, timersFrozen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  useEffect(() => {
    if (!loading) {
      focusInput();
    }
  }, [loading, focusInput]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading || readOnly) return;

    const userMessage = input.trim();
    setInput("");
    setLoading(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: `temp-${Date.now()}`, role: "user", content: userMessage },
    ]);

    try {
      const turnId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch(`/api/attempts/${attemptId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, turnId }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error ?? "Failed to send message");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      let lineBuffer = "";
      setStreamingContent("");

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const parsed = parseDataStreamChunk(lineBuffer, chunk);
          lineBuffer = parsed.remainder;
          if (parsed.text) {
            assistantText += parsed.text;
            setStreamingContent(assistantText);
          }
        }
        if (lineBuffer.startsWith("0:")) {
          try {
            assistantText += JSON.parse(lineBuffer.slice(2));
            setStreamingContent(assistantText);
          } catch {
            // incomplete final line
          }
        }
      }

      if (assistantText.trim()) {
        setMessages((prev) => [
          ...prev,
          { id: `assistant-${Date.now()}`, role: "assistant", content: assistantText.trim() },
        ]);
      }
      setStreamingContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function requestHint() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "hint" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? "Failed to request hint");
      }
      setMessages((prev) => [
        ...prev,
        { id: `hint-${Date.now()}`, role: "assistant", content: `**Hint**\n\n${(data as { hint: string }).hint}` },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request hint");
    } finally {
      setLoading(false);
    }
  }

  async function checkObjectives() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "evaluate_objective" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Objective check failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Objective check failed");
    } finally {
      setLoading(false);
    }
  }

  async function completeAssessment() {
    if (!confirm("Submit your assessment for scoring?")) return;
    setStoppedAt(Date.now());
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/attempts/${attemptId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Submission failed");
      }
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setStoppedAt(null);
    } finally {
      setLoading(false);
    }
  }

  const timerClass = timersFrozen ? "chat-timer chat-timer-frozen" : "chat-timer";

  return (
    <div className="chat-shell">
      <div className="chat-toolbar">
        {timerSettings.showCountdown && (
          <span className={timerClass}>
            {timersFrozen ? "Remaining at end" : "Remaining"}: <strong>{remaining}</strong>
          </span>
        )}
        {timerSettings.showElapsed && (
          <span className={timerClass}>
            {timersFrozen ? "Elapsed at end" : "Elapsed"}: <strong>{elapsed}</strong>
          </span>
        )}
        {!readOnly && (
          <div className="chat-actions">
            <button className="btn btn-secondary btn-sm" type="button" onClick={requestHint} disabled={loading}>
              Hint
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={checkObjectives} disabled={loading}>
              Check objectives
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={completeAssessment} disabled={loading}>
              Submit
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => {
                setStoppedAt(Date.now());
                onAbort();
              }}
              disabled={loading}
            >
              Abort
            </button>
          </div>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="chat-messages">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-message ${m.role === "user" ? "chat-message-user" : "chat-message-assistant"}`}
          >
            <span className="chat-message-role">{m.role === "user" ? "You" : "Simulation"}</span>
            <div className="chat-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
            </div>
          </div>
        ))}
        {streamingContent && (
          <div className="chat-message chat-message-assistant">
            <span className="chat-message-role">Simulation</span>
            <div className="chat-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
            </div>
          </div>
        )}
        {loading && !streamingContent && (
          <div className="chat-loading">
            <span className="chat-loading-dot" />
            <span className="chat-loading-dot" />
            <span className="chat-loading-dot" />
            Waiting for simulation…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!readOnly && (
        <>
          <form className="chat-composer" onSubmit={sendMessage}>
            <input
              ref={inputRef}
              className="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe your next step — e.g. remote to client and run ping www.coolsite.com"
              disabled={loading}
              autoComplete="off"
            />
            <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
              Send
            </button>
          </form>
          <p className="chat-input-hint">Press Enter to send. Be specific about which machine and command.</p>
        </>
      )}
    </div>
  );
}
