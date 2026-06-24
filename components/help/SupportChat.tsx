"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./HelpPane.module.css";

type ChatMessage = {
  id: string;
  sender: "user" | "admin";
  body: string;
  created_at: string;
};

type SupportChatProps = {
  /** Called once the thread is loaded / re-polled so the parent can clear its dot. */
  onRead?: () => void;
};

const POLL_INTERVAL_MS = 8000;
const MAX_MESSAGE_LENGTH = 4000;

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The messenger-style chat body shown inside the HelpPane when the user picks
 * "Contact support". Loads the user's thread, polls for admin replies while
 * open, marks them read, and sends new user messages.
 */
export default function SupportChat({ onRead }: SupportChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const markRead = useCallback(async () => {
    try {
      await fetch("/api/support/chat/read", { method: "POST" });
      onReadRef.current?.();
    } catch {
      /* best-effort */
    }
  }, []);

  const load = useCallback(
    async (initial: boolean) => {
      try {
        const response = await fetch("/api/support/chat", { cache: "no-store" });
        const data = (await response.json()) as {
          messages?: ChatMessage[];
          unreadCount?: number;
          error?: string;
        };
        if (!response.ok) {
          if (initial) setError(data.error ?? "Couldn't load the conversation.");
          return;
        }
        setMessages(data.messages ?? []);
        if (data.unreadCount && data.unreadCount > 0) {
          void markRead();
        } else {
          onReadRef.current?.();
        }
      } catch {
        if (initial) setError("Couldn't load the conversation.");
      } finally {
        if (initial) setLoading(false);
      }
    },
    [markRead]
  );

  // Load on mount, then poll for admin replies while the chat stays open.
  useEffect(() => {
    void load(true);
    const timer = setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || sending) {
      return;
    }
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = (await response.json()) as { message?: ChatMessage; error?: string };
      if (!response.ok || !data.message) {
        setError(data.error ?? "Couldn't send your message.");
        return;
      }
      setMessages((current) => [...current, data.message as ChatMessage]);
      setDraft("");
    } catch {
      setError("Couldn't send your message.");
    } finally {
      setSending(false);
    }
  }, [draft, sending]);

  return (
    <div className={styles.chat}>
      <div className={styles.chatLog} ref={scrollRef}>
        {loading ? (
          <p className={styles.chatStatus}>Loading…</p>
        ) : messages.length === 0 ? (
          <div className={styles.chatIntro}>
            <p className={styles.chatIntroTitle}>Chat with our team</p>
            <p className={styles.chatIntroText}>
              Send us a message and we&apos;ll reply right here. You&apos;ll see a
              notification when we answer.
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={
                message.sender === "user"
                  ? `${styles.bubbleRow} ${styles.bubbleRowMine}`
                  : styles.bubbleRow
              }
            >
              <div
                className={
                  message.sender === "user"
                    ? `${styles.bubble} ${styles.bubbleMine}`
                    : `${styles.bubble} ${styles.bubbleTheirs}`
                }
              >
                <span className={styles.bubbleText}>{message.body}</span>
                <span className={styles.bubbleTime}>{formatTime(message.created_at)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {error ? <p className={styles.chatError}>{error}</p> : null}

      <div className={styles.chatComposer}>
        <textarea
          className={styles.chatInput}
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
          placeholder="Write a message…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className={styles.chatSend}
          onClick={() => void send()}
          disabled={sending || draft.trim().length === 0}
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 12 20 4l-4 16-4-6-8-2Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
