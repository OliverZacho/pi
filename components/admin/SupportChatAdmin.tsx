"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatThread = {
  id: string;
  user_id: string;
  user_email: string | null;
  status: string;
  last_message_at: string;
  last_message_sender: "user" | "admin" | null;
  user_unread_count: number;
  admin_unread_count: number;
  created_at: string;
};

type ChatMessage = {
  id: string;
  sender: "user" | "admin";
  body: string;
  sent_by_email: string | null;
  created_at: string;
};

type ThreadStatus = "open" | "archived";
type StatusFilter = "active" | "archived" | "all";

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Open" },
  { value: "archived", label: "Resolved" },
  { value: "all", label: "All" }
];

const THREAD_POLL_MS = 10000;

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Admin live-chat inbox — the in-app counterpart to the email SupportInbox.
 * Lists chat threads, shows a messenger-style transcript, and posts admin
 * replies that land in the user's "Need help?" panel (no email).
 */
export default function SupportChatAdmin() {
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<ThreadStatus>("open");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState("");

  const logRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async (active: StatusFilter) => {
    try {
      setListError("");
      const response = await fetch(`/api/admin/support/chat?status=${active}`, {
        cache: "no-store"
      });
      const data = (await response.json()) as {
        threads?: ChatThread[];
        unreadCount?: number;
        error?: string;
      };
      if (!response.ok) {
        setThreads([]);
        setListError(data.error ?? "Failed to load chats.");
        return;
      }
      setThreads(data.threads ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      setThreads([]);
      setListError("Failed to load chats.");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList(filter);
  }, [filter, loadList]);

  const loadThread = useCallback(
    async (id: string, initial: boolean) => {
      if (initial) {
        setDetailLoading(true);
        setDetailError("");
      }
      try {
        const response = await fetch(`/api/admin/support/chat/${id}`, { cache: "no-store" });
        const data = (await response.json()) as {
          thread?: { status?: string };
          messages?: ChatMessage[];
          error?: string;
        };
        if (!response.ok) {
          if (initial) setDetailError(data.error ?? "Failed to load chat.");
          return;
        }
        setMessages(data.messages ?? []);
        if (data.thread?.status === "archived" || data.thread?.status === "open") {
          setSelectedStatus(data.thread.status);
        }
        if (initial) {
          // Opening clears the admin unread badge server-side; mirror it locally.
          setThreads((current) =>
            current.map((t) => (t.id === id ? { ...t, admin_unread_count: 0 } : t))
          );
          setUnreadCount((current) => {
            const opened = threads.find((t) => t.id === id);
            return opened && opened.admin_unread_count > 0 && current > 0
              ? current - 1
              : current;
          });
        }
      } catch {
        if (initial) setDetailError("Failed to load chat.");
      } finally {
        if (initial) setDetailLoading(false);
      }
    },
    [threads]
  );

  const openThread = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMessages([]);
      setReplyText("");
      setReplyError("");
      void loadThread(id, true);
    },
    [loadThread]
  );

  // Poll the open thread for new user messages. The effect re-runs when the
  // selection changes, so the interval always targets the current thread.
  useEffect(() => {
    if (!selectedId) return;
    const timer = setInterval(() => {
      void loadThread(selectedId, false);
    }, THREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [selectedId, loadThread]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const sendReply = useCallback(async () => {
    if (!selectedId) return;
    const message = replyText.trim();
    if (!message) return;
    setSending(true);
    setReplyError("");
    try {
      const response = await fetch(`/api/admin/support/chat/${selectedId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = (await response.json()) as { message?: ChatMessage; error?: string };
      if (!response.ok || !data.message) {
        setReplyError(data.error ?? "Failed to send reply.");
        return;
      }
      setMessages((current) => [...current, data.message as ChatMessage]);
      setReplyText("");
      void loadList(filter);
    } catch {
      setReplyError("Failed to send reply.");
    } finally {
      setSending(false);
    }
  }, [selectedId, replyText, filter, loadList]);

  const setStatus = useCallback(
    async (status: ThreadStatus) => {
      if (!selectedId) return;
      const response = await fetch(`/api/admin/support/chat/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!response.ok) return;
      setSelectedStatus(status);
      // Resolving drops it from the Open list; reopening drops it from Resolved.
      if (
        (status === "archived" && filter === "active") ||
        (status === "open" && filter === "archived")
      ) {
        setThreads((current) => current.filter((t) => t.id !== selectedId));
        setSelectedId(null);
        setMessages([]);
      } else {
        setThreads((current) =>
          current.map((t) => (t.id === selectedId ? { ...t, status } : t))
        );
      }
      void loadList(filter);
    },
    [selectedId, filter, loadList]
  );

  return (
    <>
      <div className="support-toolbar">
        <div className="support-filters" role="tablist" aria-label="Chat filters">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              className={`support-filter${filter === option.value ? " is-active" : ""}`}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
              {option.value === "active" && unreadCount > 0 ? (
                <span className="support-unread-pill">{unreadCount}</span>
              ) : null}
            </button>
          ))}
        </div>
        <button type="button" className="support-refresh" onClick={() => void loadList(filter)}>
          Refresh
        </button>
      </div>

      <div className="support-layout">
        <div className="support-list">
          {listLoading ? (
            <p className="support-empty">Loading…</p>
          ) : listError ? (
            <p className="support-empty support-error">{listError}</p>
          ) : threads.length === 0 ? (
            <p className="support-empty">No chats yet.</p>
          ) : (
            <ul className="support-list-items">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className={`support-list-item${selectedId === thread.id ? " is-active" : ""}${
                      thread.admin_unread_count > 0 ? " is-unread" : ""
                    }`}
                    onClick={() => openThread(thread.id)}
                  >
                    <div className="support-list-row">
                      <span className="support-list-from">
                        {thread.user_email ?? "Unknown user"}
                      </span>
                      <span className="support-list-date">
                        {formatDateTime(thread.last_message_at)}
                      </span>
                    </div>
                    <div className="support-list-subject">
                      {thread.admin_unread_count > 0 ? <span className="support-dot" /> : null}
                      <span className="support-to-tag">chat</span>
                      {thread.last_message_sender === "admin" ? "You replied" : "New message"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="support-detail">
          {!selectedId ? (
            <p className="support-empty">Select a conversation to read it.</p>
          ) : detailLoading ? (
            <p className="support-empty">Loading chat…</p>
          ) : detailError ? (
            <p className="support-empty support-error">{detailError}</p>
          ) : (
            <>
              <div className="support-detail-actions support-chat-actions">
                {selectedStatus === "archived" ? (
                  <>
                    <span className="support-tag">Resolved</span>
                    <button
                      type="button"
                      className="support-action"
                      onClick={() => void setStatus("open")}
                    >
                      Reopen
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="support-action"
                    onClick={() => void setStatus("archived")}
                  >
                    Mark resolved
                  </button>
                )}
              </div>

              <div className="support-chat-log" ref={logRef}>
                {messages.length === 0 ? (
                  <p className="support-empty">No messages in this chat yet.</p>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`support-chat-row${
                        message.sender === "admin" ? " is-admin" : ""
                      }`}
                    >
                      <div className="support-chat-bubble">
                        <span className="support-chat-text">{message.body}</span>
                        <span className="support-chat-meta">
                          {message.sender === "admin"
                            ? message.sent_by_email ?? "Support"
                            : "User"}{" "}
                          · {formatDateTime(message.created_at)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="support-reply-box">
                <textarea
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="Write a reply…"
                  rows={3}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void sendReply();
                    }
                  }}
                />
                {replyError ? <p className="support-error">{replyError}</p> : null}
                <div className="support-reply-actions">
                  <button
                    type="button"
                    className="support-send"
                    onClick={() => void sendReply()}
                    disabled={sending || replyText.trim().length === 0}
                  >
                    {sending ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
