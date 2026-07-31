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
  status?: string;
  completedAt?: string | null;
  onComplete: () => void;
  onAbort: () => void;
  readOnly?: boolean;
}

export function ChatInterface({
  attemptId,
  initialMessages,
  timerSettings,
  expiresAt,
  startedAt,
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
  const [remaining, setRemaining] = useState("");
  const [elapsed, setElapsed] = useState("");
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sessionEnded = status != null && status !== "IN_PROGRESS";
  const frozenAtMs =
    stoppedAt ??
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
    setMessages((prev) => [
      ...prev,
      { id: `temp-${Date.now()}`, role: "user", content: userMessage },
    ]);

    try {
      const res = await fetch(`/api/attempts/${attemptId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      setStreamingContent("");

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            if (line.startsWith("0:")) {
              try {
                const text = JSON.parse(line.slice(2));
                assistantText += text;
                setStreamingContent(assistantText);
              } catch {
                // skip malformed chunks
              }
            }
          }
        }
      }

      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now()}`, role: "assistant", content: assistantText },
      ]);
      setStreamingContent("");
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "assistant", content: "An error occurred. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function requestHint() {
    setLoading(true);
    const res = await fetch(`/api/attempts/${attemptId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "hint" }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      setMessages((prev) => [
        ...prev,
        { id: `hint-${Date.now()}`, role: "assistant", content: `**Hint**\n\n${data.hint}` },
      ]);
    }
  }

  async function checkObjectives() {
    setLoading(true);
    await fetch(`/api/attempts/${attemptId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "evaluate_objective" }),
    });
    setLoading(false);
  }

  async function completeAssessment() {
    if (!confirm("Submit your assessment for scoring?")) return;
    setStoppedAt(Date.now());
    setLoading(true);
    await fetch(`/api/attempts/${attemptId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    });
    setLoading(false);
    onComplete();
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
