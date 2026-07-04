"use client";

import { useCallback, useEffect, useState } from "react";
import SupportChatAdmin from "./SupportChatAdmin";

type SupportStatus = "unread" | "read" | "archived";
type SupportMode = "email" | "chat";

type SupportListItem = {
  id: string;
  from_address: string;
  from_name: string | null;
  to_address: string;
  subject: string;
  plain_text: string | null;
  received_at: string;
  status: SupportStatus;
  replied_at: string | null;
};

type SupportReply = {
  id: string;
  body: string;
  sent_by_email: string | null;
  resend_message_id: string | null;
  created_at: string;
};

type SupportAttachment = {
  id: string;
  filename: string | null;
  content_type: string;
  size_bytes: number;
  is_inline: boolean;
};

type SupportDetail = SupportListItem & { html: string | null };

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

type StatusFilter = "active" | "archived" | "all";

const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Inbox" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" }
];

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function senderLabel(item: { from_name: string | null; from_address: string }): string {
  return item.from_name ? `${item.from_name} <${item.from_address}>` : item.from_address;
}

/** Dedicated legal/compliance inboxes worth flagging in the list. */
const HIGHLIGHTED_MAILBOXES = new Set(["privacy", "legal", "takedown"]);

/** The mailbox (local part) a message was sent to, e.g. "takedown". */
function mailboxLabel(toAddress: string): string {
  const at = toAddress.indexOf("@");
  return (at > 0 ? toAddress.slice(0, at) : toAddress).toLowerCase();
}

function preview(text: string | null): string {
  if (!text) {
    return "";
  }
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 140 ? `${collapsed.slice(0, 140)}…` : collapsed;
}

export default function SupportInbox() {
  const [mode, setMode] = useState<SupportMode>("email");
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [emails, setEmails] = useState<SupportListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportDetail | null>(null);
  const [replies, setReplies] = useState<SupportReply[]>([]);
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState("");

  const loadList = useCallback(async (active: StatusFilter) => {
    try {
      setListLoading(true);
      setListError("");
      const response = await fetch(`/api/admin/support?status=${active}`, {
        cache: "no-store"
      });
      const data = (await response.json()) as {
        emails?: SupportListItem[];
        unreadCount?: number;
        error?: string;
      };
      if (!response.ok) {
        setEmails([]);
        setListError(data.error ?? "Failed to load support emails.");
        return;
      }
      setEmails(data.emails ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      setEmails([]);
      setListError("Failed to load support emails.");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList(filter);
  }, [filter, loadList]);

  const openEmail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setReplies([]);
    setAttachments([]);
    setReplyText("");
    setReplyError("");
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/admin/support/${id}`, { cache: "no-store" });
      const data = (await response.json()) as {
        email?: SupportDetail;
        replies?: SupportReply[];
        attachments?: SupportAttachment[];
        error?: string;
      };
      if (!response.ok || !data.email) {
        setDetailError(data.error ?? "Failed to load message.");
        return;
      }
      setDetail(data.email);
      setReplies(data.replies ?? []);
      setAttachments(data.attachments ?? []);
      // The server marks an opened message read — mirror that locally.
      setEmails((current) =>
        current.map((item) =>
          item.id === id && item.status === "unread"
            ? { ...item, status: "read" }
            : item
        )
      );
      setUnreadCount((current) =>
        data.email?.status === "read" && current > 0 ? current - 1 : current
      );
    } catch {
      setDetailError("Failed to load message.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const setStatus = useCallback(
    async (id: string, status: SupportStatus) => {
      const response = await fetch(`/api/admin/support/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!response.ok) {
        return;
      }
      if (status === "archived" && filter !== "all") {
        setEmails((current) => current.filter((item) => item.id !== id));
        if (selectedId === id) {
          setSelectedId(null);
          setDetail(null);
        }
      } else {
        setEmails((current) =>
          current.map((item) => (item.id === id ? { ...item, status } : item))
        );
        setDetail((current) => (current && current.id === id ? { ...current, status } : current));
      }
      void loadList(filter);
    },
    [filter, loadList, selectedId]
  );

  const sendReply = useCallback(async () => {
    if (!detail) {
      return;
    }
    const message = replyText.trim();
    if (!message) {
      return;
    }
    setSending(true);
    setReplyError("");
    try {
      const response = await fetch(`/api/admin/support/${detail.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      const data = (await response.json()) as { reply?: SupportReply; error?: string };
      if (!response.ok || !data.reply) {
        setReplyError(data.error ?? "Failed to send reply.");
        return;
      }
      setReplies((current) => [...current, data.reply as SupportReply]);
      setReplyText("");
      setDetail((current) =>
        current ? { ...current, replied_at: data.reply?.created_at ?? current.replied_at } : current
      );
      void loadList(filter);
    } catch {
      setReplyError("Failed to send reply.");
    } finally {
      setSending(false);
    }
  }, [detail, replyText, filter, loadList]);

  return (
    <section className="card support-card">
      <div className="support-modes" role="tablist" aria-label="Support channel">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "email"}
          className={`support-mode${mode === "email" ? " is-active" : ""}`}
          onClick={() => setMode("email")}
        >
          Email
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "chat"}
          className={`support-mode${mode === "chat" ? " is-active" : ""}`}
          onClick={() => setMode("chat")}
        >
          Live chat
        </button>
      </div>

      {mode === "chat" ? (
        <SupportChatAdmin />
      ) : (
        <>
      <div className="support-toolbar">
        <div className="support-filters" role="tablist" aria-label="Support filters">
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
        <button
          type="button"
          className="support-refresh"
          onClick={() => void loadList(filter)}
        >
          Refresh
        </button>
      </div>

      <div className="support-layout">
        <div className="support-list">
          {listLoading ? (
            <p className="support-empty">Loading…</p>
          ) : listError ? (
            <p className="support-empty support-error">{listError}</p>
          ) : emails.length === 0 ? (
            <p className="support-empty">No messages here yet.</p>
          ) : (
            <ul className="support-list-items">
              {emails.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`support-list-item${
                      selectedId === item.id ? " is-active" : ""
                    }${item.status === "unread" ? " is-unread" : ""}`}
                    onClick={() => void openEmail(item.id)}
                  >
                    <div className="support-list-row">
                      <span className="support-list-from">{senderLabel(item)}</span>
                      <span className="support-list-date">
                        {formatDateTime(item.received_at)}
                      </span>
                    </div>
                    <div className="support-list-subject">
                      {item.status === "unread" ? <span className="support-dot" /> : null}
                      <span
                        className={`support-to-tag${
                          HIGHLIGHTED_MAILBOXES.has(mailboxLabel(item.to_address))
                            ? " is-legal"
                            : ""
                        }`}
                      >
                        {mailboxLabel(item.to_address)}
                      </span>
                      {item.subject}
                      {item.replied_at ? (
                        <span className="support-tag">Replied</span>
                      ) : null}
                    </div>
                    <div className="support-list-preview">{preview(item.plain_text)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="support-detail">
          {detailLoading ? (
            <p className="support-empty">Loading message…</p>
          ) : detailError ? (
            <p className="support-empty support-error">{detailError}</p>
          ) : !detail ? (
            <p className="support-empty">Select a message to read it.</p>
          ) : (
            <>
              <header className="support-detail-head">
                <h3>{detail.subject}</h3>
                <div className="support-detail-meta">
                  <span>
                    <strong>From:</strong> {senderLabel(detail)}
                  </span>
                  <span>
                    <strong>To:</strong> {detail.to_address}
                  </span>
                  <span>{formatDateTime(detail.received_at)}</span>
                </div>
                <div className="support-detail-actions">
                  <a className="support-action" href={`mailto:${detail.from_address}`}>
                    Open in mail client
                  </a>
                  {detail.status !== "archived" ? (
                    <button
                      type="button"
                      className="support-action"
                      onClick={() => void setStatus(detail.id, "archived")}
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="support-action"
                      onClick={() => void setStatus(detail.id, "read")}
                    >
                      Restore to inbox
                    </button>
                  )}
                  <button
                    type="button"
                    className="support-action"
                    onClick={() => void setStatus(detail.id, "unread")}
                  >
                    Mark unread
                  </button>
                </div>
              </header>

              <div className="support-body">
                {detail.plain_text ? (
                  <pre className="support-body-text">{detail.plain_text}</pre>
                ) : detail.html ? (
                  <iframe
                    className="support-body-html"
                    title="Message body"
                    sandbox=""
                    srcDoc={detail.html}
                  />
                ) : (
                  <p className="support-empty">This message has no body.</p>
                )}
              </div>

              {attachments.length > 0 ? (
                <div className="support-attachments">
                  <h4>Attachments</h4>
                  <div className="support-attachment-grid">
                    {attachments.map((attachment) => {
                      const url = `/api/admin/support/${detail.id}/attachments/${attachment.id}`;
                      return attachment.content_type.startsWith("image/") ? (
                        <a
                          key={attachment.id}
                          className="support-attachment-image"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- admin-gated API route, not a static asset */}
                          <img
                            src={url}
                            alt={attachment.filename ?? "Attached image"}
                            loading="lazy"
                          />
                        </a>
                      ) : (
                        <a
                          key={attachment.id}
                          className="support-attachment-file"
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="support-attachment-name">
                            {attachment.filename ?? "Attachment"}
                          </span>
                          <span className="support-attachment-size">
                            {formatSize(attachment.size_bytes)}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {replies.length > 0 ? (
                <div className="support-thread">
                  <h4>Replies</h4>
                  {replies.map((reply) => (
                    <article key={reply.id} className="support-reply">
                      <div className="support-reply-meta">
                        <strong>{reply.sent_by_email ?? "Support"}</strong>
                        <span>{formatDateTime(reply.created_at)}</span>
                      </div>
                      <pre className="support-body-text">{reply.body}</pre>
                    </article>
                  ))}
                </div>
              ) : null}

              <div className="support-reply-box">
                <label htmlFor="support-reply-text">
                  Reply to {detail.from_address}
                </label>
                <textarea
                  id="support-reply-text"
                  value={replyText}
                  onChange={(event) => setReplyText(event.target.value)}
                  placeholder="Write a reply…"
                  rows={5}
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
      )}
    </section>
  );
}
