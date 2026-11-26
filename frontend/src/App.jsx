import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import { verifyLudoProof } from "./fairness";
import {
  applySoloDraughtsMove,
  chooseComputerMove,
  createSoloDraughtsGame,
  legalSoloDraughtsMoves,
} from "./soloDraughts";

function ActionButton({ loading = false, disabled = false, onClick, children, ...props }) {
  const [clickPending, setClickPending] = useState(false);
  const pendingRef = useRef(false);
  const busy = loading || clickPending;

  async function handleClick(event) {
    if (!onClick || pendingRef.current) return;
    const result = onClick(event);
    if (!result || typeof result.then !== "function") return;
    pendingRef.current = true;
    setClickPending(true);
    try {
      await result;
    } finally {
      pendingRef.current = false;
      setClickPending(false);
    }
  }

  return (
    <button
      {...props}
      onClick={handleClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy && <span className="button-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

function AuthForm({ mode, onDone, onModeChange }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef(null);
  const usernameRef = useRef(null);

  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    usernameRef.current?.focus({ preventScroll: true });
  }, [mode]);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const session = mode === "signup"
        ? await api.register(username, password, ageConfirmed, displayName, email)
        : await api.login(username, password);
      onDone(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === "forgot-password") {
    return <ForgotPasswordForm onModeChange={onModeChange} />;
  }

  return (
    <form ref={formRef} className="card auth" onSubmit={submit}>
      <h2>{mode === "signup" ? "Create your account" : "Log in"}</h2>
      {mode === "signup" && (
        <>
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              minLength={2}
              maxLength={40}
              autoComplete="name"
              required
            />
          </label>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              autoComplete="email"
              required
            />
          </label>
        </>
      )}
      <label>
        Username
        <input
          ref={usernameRef}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          minLength={3}
          maxLength={32}
          pattern="[A-Za-z0-9_]+"
          title="Use 3-32 letters, numbers, or underscores."
          autoComplete="username"
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={mode === "signup" ? 8 : undefined}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
        />
      </label>
      {mode === "signup" && (
        <label className="age-confirmation">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            required
          />
          I confirm that I am at least 18 years old.
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <ActionButton className="btn" type="submit" loading={submitting}>
        {mode === "signup" ? "Sign up" : "Log in"}
      </ActionButton>
      <p className="login-prompt">
        {mode === "signup" ? "Already have an account? " : "Don't have an account? "}
        <button
          className="link auth-switch"
          type="button"
          onClick={() => onModeChange(mode === "signup" ? "login" : "signup")}
        >
          {mode === "signup" ? "Login" : "Create account"}
        </button>
      </p>
      {mode === "login" && (
        <button
          className="link auth-switch"
          type="button"
          onClick={() => onModeChange("forgot-password")}
        >
          Forgot password?
        </button>
      )}
    </form>
  );
}

function ForgotPasswordForm({ onModeChange }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api.requestPasswordReset(email);
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card auth" onSubmit={submit}>
      <h2>Recover your account</h2>
      <p className="login-prompt">Enter your verified email address to receive a password reset link.</p>
      <label>
        Email address
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
      </label>
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <ActionButton className="btn" type="submit" loading={submitting}>
        Send recovery link
      </ActionButton>
      <button className="link auth-switch" type="button" onClick={() => onModeChange("login")}>
        Back to log in
      </button>
    </form>
  );
}

function mergeChatMessages(current, incoming) {
  const messagesById = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) messagesById.set(message.id, message);
  return [...messagesById.values()].sort((first, second) => first.id - second.id);
}

function PracticeRoomChat({ token, roomId, username }) {
  const [messages, setMessages] = useState([]);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesContainerRef = useRef(null);
  const messageInputRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const lastMessageIdRef = useRef(0);
  const oldestMessageIdRef = useRef(0);
  const hasLoadedMessagesRef = useRef(false);
  const shouldScrollToBottomRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  function isNearBottom() {
    const container = messagesContainerRef.current;
    return !container || container.scrollHeight - container.scrollTop - container.clientHeight < 48;
  }

  useEffect(() => {
    let stopped = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await api.getPracticeRoomChat(token, roomId);
        if (!stopped) {
          const newestMessageId = result.messages[result.messages.length - 1]?.id || 0;
          if (!hasLoadedMessagesRef.current) {
            hasLoadedMessagesRef.current = true;
            oldestMessageIdRef.current = result.messages[0]?.id || 0;
            setHasOlderMessages(Boolean(result.has_more));
            if (isOpenRef.current) shouldScrollToBottomRef.current = true;
          } else {
            const incomingMessages = result.messages.filter(
              (message) => message.id > lastMessageIdRef.current && message.username !== username,
            );
            if (incomingMessages.length) {
              if (isOpenRef.current && isNearBottom()) {
                shouldScrollToBottomRef.current = true;
              } else {
                setUnreadCount((count) => count + incomingMessages.length);
              }
            }
            const firstLatestMessageId = result.messages[0]?.id;
            if (firstLatestMessageId && firstLatestMessageId <= oldestMessageIdRef.current) {
              setHasOlderMessages(Boolean(result.has_more));
            }
          }
          lastMessageIdRef.current = Math.max(lastMessageIdRef.current, newestMessageId);
          setHasOlderMessages(Boolean(result.has_more));
          setMessages((current) => mergeChatMessages(current, result.messages));
          setError("");
        }
      } catch (err) {
        if (!stopped) setError(err.message);
      } finally {
        refreshing = false;
      }
    };

    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 2500);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [token, roomId, username]);

  useEffect(() => {
    if (!shouldScrollToBottomRef.current || !messagesContainerRef.current) return;
    shouldScrollToBottomRef.current = false;
    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
      messageInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  async function loadOlderMessages() {
    if (!hasOlderMessages || loadingOlderRef.current || !messages.length) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    setError("");
    const previousHeight = container.scrollHeight;
    const previousTop = container.scrollTop;
    try {
      const result = await api.getPracticeRoomChat(token, roomId, messages[0].id);
      if (result.messages.length) {
        oldestMessageIdRef.current = result.messages[0].id;
      }
      setHasOlderMessages(Boolean(result.has_more));
      setMessages((current) => mergeChatMessages(result.messages, current));
      window.requestAnimationFrame(() => {
        container.scrollTop = previousTop + container.scrollHeight - previousHeight;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return undefined;
    function closeOnEscape(event) {
      if (event.key === "Escape") setIsOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    try {
      const message = await api.sendPracticeRoomChat(token, roomId, content);
      lastMessageIdRef.current = Math.max(lastMessageIdRef.current, message.id);
      shouldScrollToBottomRef.current = true;
      setUnreadCount(0);
      setMessages((current) => mergeChatMessages(current, [message]));
      setDraft("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-dock">
      {isOpen && (
        <section className="card chat-panel" id={`match-chat-${roomId}`} aria-label="Match chat">
          <div className="chat-panel-heading">
            <h3>Chat with players</h3>
            <button className="chat-close" type="button" onClick={() => setIsOpen(false)} aria-label="Close chat">
              ×
            </button>
          </div>
          <div
            className="chat-messages"
            ref={messagesContainerRef}
            onScroll={(event) => {
              if (event.currentTarget.scrollTop < 36) void loadOlderMessages();
            }}
            aria-live="polite"
            aria-relevant="additions"
          >
            {loadingOlder && <p className="chat-history-status" role="status">Loading earlier messages...</p>}
            {messages.length ? messages.map((message) => (
              <div className="chat-message" key={message.id}>
                <div className="chat-message-heading">
                  <strong><PlayerProfileLink username={message.username} /></strong>
                  <time dateTime={message.created_at}>
                    {new Date(message.created_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p>{message.content}</p>
              </div>
            )) : (
              <p className="empty-state">No messages yet. Say hello to the other players.</p>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              className="chat-jump-latest"
              type="button"
              onClick={() => {
                setUnreadCount(0);
                if (messagesContainerRef.current) {
                  messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
                }
              }}
            >
              Jump to latest · {unreadCount} new
            </button>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <form className="chat-form" onSubmit={sendMessage}>
            <input
              ref={messageInputRef}
              aria-label="Chat message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={500}
              placeholder="Write a message..."
              required
            />
            <ActionButton
              className="btn"
              type="submit"
              disabled={!draft.trim()}
              loading={sending}
            >
              Send
            </ActionButton>
          </form>
        </section>
      )}
      <button
        className={`chat-bell${unreadCount ? " has-unread" : ""}`}
        type="button"
        aria-label={unreadCount ? `Open match chat, ${unreadCount} new messages` : "Open match chat"}
        aria-expanded={isOpen}
        aria-controls={isOpen ? `match-chat-${roomId}` : undefined}
        onClick={() => {
          if (!isOpen) setUnreadCount(0);
          setIsOpen((open) => !open);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        <span>Chat</span>
        {unreadCount > 0 && (
          <span className="chat-unread-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>
    </div>
  );
}

function HostWorkspace({
  session,
  application,
  onApplicationChange,
  onRoleChange,
  onNotice,
}) {
  const [motivation, setMotivation] = useState("");
  const [gameId, setGameId] = useState("draughts");
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleContent, setRuleContent] = useState("");
  const [formPending, setFormPending] = useState(false);

  async function applyForHost(event) {
    event.preventDefault();
    setFormPending(true);
    try {
      const submitted = await api.requestHostRole(session.token, motivation);
      onApplicationChange(submitted);
      setMotivation("");
      onNotice("Host application submitted for administrator review.");
    } catch (error) {
      onNotice(error.message);
    } finally {
      setFormPending(false);
    }
  }

  async function refreshAccess() {
    try {
      const profile = await api.getMe(session.token);
      onRoleChange({ ...session, role: profile.role });
      onApplicationChange(await api.getMyHostApplication(session.token));
    } catch (error) {
      onNotice(error.message);
    }
  }

  async function proposeRulebook(event) {
    event.preventDefault();
    setFormPending(true);
    try {
      await api.proposeRulebook(session.token, {
        game_id: gameId,
        title: ruleTitle,
        content: ruleContent,
      });
      setRuleTitle("");
      setRuleContent("");
      onNotice("Rulebook proposal submitted for administrator review.");
    } catch (error) {
      onNotice(error.message);
    } finally {
      setFormPending(false);
    }
  }

  return (
    <section className="workflow-section" aria-label="Host access and rule studio">
      {session.role === "host" ? (
        <div className="card workflow-card">
          <p className="eyebrow">HOST WORKSPACE</p>
          <h2>Rulebook studio</h2>
          <p className="practice-note">
            Hosts can propose rulebook text for review. Approval updates the published
            description only; match mechanics remain server-enforced.
          </p>
          <form className="workflow-form" onSubmit={proposeRulebook}>
            <label>
              Game
              <select value={gameId} onChange={(event) => setGameId(event.target.value)}>
                <option value="draughts">Draughts</option>
                <option value="chess">Chess</option>
                <option value="golf">Golf</option>
                <option value="ludo">Ludo</option>
                <option value="polo">Polo</option>
                <option value="snooker">Snooker</option>
                <option value="whot">Whot</option>
              </select>
            </label>
            <label>
              Rulebook title
              <input
                value={ruleTitle}
                onChange={(event) => setRuleTitle(event.target.value)}
                minLength={3}
                maxLength={80}
                required
              />
            </label>
            <label className="full-width">
              Proposed rules
              <textarea
                value={ruleContent}
                onChange={(event) => setRuleContent(event.target.value)}
                minLength={30}
                maxLength={4000}
                rows={4}
                required
              />
            </label>
            <ActionButton className="btn" type="submit" loading={formPending}>
              {formPending ? "Submitting..." : "Submit for review"}
            </ActionButton>
          </form>
        </div>
      ) : (
        <div className="card workflow-card">
          <p className="eyebrow">COMMUNITY HOSTS</p>
          <h2>Apply for Host access</h2>
          {application?.status === "pending" ? (
            <>
              <p role="status">Your application is awaiting administrator review.</p>
              <ActionButton className="link" onClick={refreshAccess}>Check application status</ActionButton>
            </>
          ) : application?.status === "approved" ? (
            <>
              <p>Your Host application was approved. Refresh access to continue.</p>
              <ActionButton className="btn" onClick={refreshAccess}>Refresh access</ActionButton>
            </>
          ) : (
            <>
              {application?.status === "rejected" && (
                <p className="error">
                  Previous application was not approved.
                  {application.review_note ? ` ${application.review_note}` : ""}
                </p>
              )}
              <form className="workflow-form" onSubmit={applyForHost}>
                <label className="full-width">
                  Why would you like to host?
                  <textarea
                    value={motivation}
                    onChange={(event) => setMotivation(event.target.value)}
                    minLength={30}
                    maxLength={1000}
                    rows={4}
                    required
                  />
                </label>
                <ActionButton className="btn" type="submit" loading={formPending}>
                  {formPending ? "Submitting..." : "Request Host access"}
                </ActionButton>
              </form>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function AdminWorkspace({ session, onRulebooksChange, onNotice }) {
  const [applications, setApplications] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [reports, setReports] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [resolutions, setResolutions] = useState({});

  async function refreshQueues() {
    const [hostApplications, ruleProposals, moderationReports, gameDisputes] = await Promise.all([
      api.getAdminHostApplications(session.token),
      api.getAdminRuleProposals(session.token),
      api.getAdminReports(session.token),
      api.getAdminDisputes(session.token),
    ]);
    setApplications(hostApplications);
    setProposals(ruleProposals);
    setReports(moderationReports);
    setDisputes(gameDisputes);
  }

  useEffect(() => {
    refreshQueues().catch((error) => onNotice(error.message));
  }, [session.token]);

  async function reviewHost(applicationId, decision) {
    try {
      await api.reviewHostApplication(session.token, applicationId, decision);
      await refreshQueues();
      onNotice(`Host application ${decision === "approve" ? "approved" : "rejected"}.`);
    } catch (error) {
      onNotice(error.message);
    }
  }

  async function reviewRules(proposalId, decision) {
    try {
      await api.reviewRuleProposal(session.token, proposalId, decision);
      if (decision === "approve") onRulebooksChange(await api.getRulebooks());
      await refreshQueues();
      onNotice(`Rulebook proposal ${decision === "approve" ? "approved" : "rejected"}.`);
    } catch (error) {
      onNotice(error.message);
    }
  }

  async function reviewReport(reportId, decision) {
    const reportResolution = resolutions[reportId]?.trim() || "Dismissed after review.";
    try {
      await api.reviewModerationReport(
        session.token,
        reportId,
        decision,
        reportResolution,
      );
      setResolutions((current) => ({ ...current, [reportId]: "" }));
      await refreshQueues();
      onNotice(`Moderation report ${decision === "resolve" ? "resolved" : "dismissed"}.`);
    } catch (error) {
      onNotice(error.message);
    }
  }

  async function reviewDispute(disputeId, decision) {
    const resolution = resolutions[`dispute-${disputeId}`]?.trim();
    if (!resolution || resolution.length < 10) {
      onNotice("Enter a resolution note with at least 10 characters.");
      return;
    }
    try {
      await api.reviewGameDispute(session.token, disputeId, decision, resolution);
      setResolutions((current) => ({ ...current, [`dispute-${disputeId}`]: "" }));
      await refreshQueues();
      onNotice(`Game dispute ${decision === "resolve" ? "resolved" : "dismissed"}.`);
    } catch (error) {
      onNotice(error.message);
    }
  }

  return (
    <section className="workflow-section" aria-label="Administrator tools">
      <p className="eyebrow">ADMINISTRATION</p>
      <h2>Review queue</h2>
      <p className="section-note">
        Report review records outcomes; it does not automatically suspend accounts or change matches.
      </p>
      <div className="admin-queues">
        <div className="card workflow-card">
          <h3>Host applications ({applications.length})</h3>
          {applications.length ? applications.map((application) => (
            <article className="queue-item" key={application.id}>
              <strong>{application.username}</strong>
              <p>{application.motivation}</p>
              <div className="queue-actions">
                <ActionButton className="btn" onClick={() => reviewHost(application.id, "approve")}>
                  Approve
                </ActionButton>
                <ActionButton className="link" onClick={() => reviewHost(application.id, "reject")}>
                  Reject
                </ActionButton>
              </div>
            </article>
          )) : <p>No pending Host applications.</p>}
        </div>
        <div className="card workflow-card">
          <h3>Rulebook proposals ({proposals.length})</h3>
          {proposals.length ? proposals.map((proposal) => (
            <article className="queue-item" key={proposal.id}>
              <strong>{proposal.title} · {proposal.game_id}</strong>
              <p>Submitted by {proposal.username}</p>
              <p>{proposal.content}</p>
              <div className="queue-actions">
                <ActionButton className="btn" onClick={() => reviewRules(proposal.id, "approve")}>
                  Publish
                </ActionButton>
                <ActionButton className="link" onClick={() => reviewRules(proposal.id, "reject")}>
                  Reject
                </ActionButton>
              </div>
            </article>
          )) : <p>No pending rulebook proposals.</p>}
        </div>
        <div className="card workflow-card">
          <h3>Moderation reports ({reports.length})</h3>
          {reports.length ? reports.map((report) => (
            <article className="queue-item" key={report.id}>
              <strong>{report.category.replaceAll("_", " ")}</strong>
              <p>
                Reported by {report.reporter}
                {report.room_name ? ` · Room: ${report.room_name}` : ""}
                {report.target_username ? ` · User: ${report.target_username}` : ""}
              </p>
              <p>{report.details}</p>
              <label>
                Resolution note
                <textarea
                value={resolutions[report.id] || ""}
                onChange={(event) => setResolutions((current) => ({
                  ...current,
                  [report.id]: event.target.value,
                }))}
                  minLength={10}
                  maxLength={1000}
                  rows={2}
                />
              </label>
              <div className="queue-actions">
                <ActionButton
                  className="btn"
                  disabled={(resolutions[report.id] || "").trim().length < 10}
                  onClick={() => reviewReport(report.id, "resolve")}
                >
                  Resolve
                </ActionButton>
                <ActionButton className="link" onClick={() => reviewReport(report.id, "dismiss")}>
                  Dismiss
                </ActionButton>
              </div>
            </article>
          )) : <p>No open moderation reports.</p>}
        </div>
        <div className="card workflow-card">
          <h3>Game disputes ({disputes.length})</h3>
          {disputes.length ? disputes.map((dispute) => (
            <article className="queue-item" key={dispute.id}>
              <strong>{dispute.game_id} · {dispute.room_name}</strong>
              <p>Submitted by {dispute.reporter} · game version {dispute.game_version}</p>
              <p>{dispute.details}</p>
              <details className="dispute-snapshot">
                <summary>Review recorded game snapshot</summary>
                <pre>{JSON.stringify(dispute.snapshot, null, 2)}</pre>
              </details>
              <label>
                Resolution note
                <textarea
                  value={resolutions[`dispute-${dispute.id}`] || ""}
                  onChange={(event) => setResolutions((current) => ({
                    ...current,
                    [`dispute-${dispute.id}`]: event.target.value,
                  }))}
                  minLength={10}
                  maxLength={1000}
                  rows={2}
                />
              </label>
              <div className="queue-actions">
                <ActionButton
                  className="btn"
                  disabled={(resolutions[`dispute-${dispute.id}`] || "").trim().length < 10}
                  onClick={() => reviewDispute(dispute.id, "resolve")}
                >
                  Resolve
                </ActionButton>
                <ActionButton
                  className="link"
                  onClick={() => reviewDispute(dispute.id, "dismiss")}
                >
                  Dismiss
                </ActionButton>
              </div>
            </article>
          )) : <p>No open game disputes.</p>}
        </div>
      </div>
    </section>
  );
}

function RoomReportForm({ token, roomId, onCancel, onSubmitted, onNotice }) {
  const [category, setCategory] = useState("other");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.submitModerationReport(token, {
        room_id: roomId,
        category,
        details,
      });
      setDetails("");
      onSubmitted();
      onNotice("Room report submitted to the moderation queue.");
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="report-form" onSubmit={submit}>
      <label>
        Report category
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="cheating">Cheating</option>
          <option value="harassment">Harassment</option>
          <option value="inappropriate_content">Inappropriate content</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        What happened?
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          minLength={20}
          maxLength={2000}
          rows={3}
          required
        />
      </label>
      <div className="queue-actions">
        <ActionButton className="btn" type="submit" loading={submitting}>
          {submitting ? "Submitting..." : "Submit report"}
        </ActionButton>
        <ActionButton className="link" type="button" onClick={onCancel}>Cancel</ActionButton>
      </div>
    </form>
  );
}

function ResponsiblePlaySettings({ token, reminderMinutes, onReminderChange, onNotice }) {
  const [saving, setSaving] = useState(false);

  async function saveReminder(event) {
    const minutes = Number(event.target.value);
    try {
      setSaving(true);
      const saved = await api.saveResponsiblePlaySettings(token, minutes);
      onReminderChange(saved.break_reminder_minutes);
      onNotice(
        minutes === 0
          ? "Break reminders are turned off."
          : `Break reminder set for every ${minutes} minutes of active play.`,
      );
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="workflow-section" aria-label="Responsible play settings">
      <div className="card workflow-card responsible-card">
        <p className="eyebrow">YOUR WELLBEING</p>
        <h2>Break reminders</h2>
        <p>
          Reminders count time while AusPlay is visible. They are optional and do not limit
          access to free practice games.
        </p>
        <label className="reminder-setting">
          Remind me to take a break
          <select
            value={reminderMinutes}
            onChange={saveReminder}
            disabled={saving}
          >
            <option value={30}>Every 30 minutes</option>
            <option value={60}>Every hour</option>
            <option value={90}>Every 90 minutes</option>
            <option value={120}>Every 2 hours</option>
            <option value={0}>Turn reminders off</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function GameDisputePanel({ token, roomId, onNotice }) {
  const [dispute, setDispute] = useState(undefined);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [filingAnother, setFilingAnother] = useState(false);

  useEffect(() => {
    let stopped = false;
    api.getMyGameDispute(token, roomId)
      .then((result) => {
        if (!stopped) setDispute(result);
      })
      .catch((error) => {
        if (!stopped) onNotice(error.message);
      });
    return () => {
      stopped = true;
    };
  }, [token, roomId]);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const created = await api.submitGameDispute(token, roomId, details);
      setDispute(created);
      setDetails("");
      setFilingAnother(false);
      onNotice("Game result dispute submitted for administrator review.");
    } catch (error) {
      onNotice(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = !dispute || filingAnother;
  return (
    <div className="card dispute-panel">
      <p className="eyebrow">MATCH REVIEW</p>
      <h3>Dispute this result</h3>
      <p>
        Disputes are reviewed against the recorded game history. Submitting one does not
        automatically change the result.
      </p>
      {dispute && !filingAnother && (
        <div className="dispute-status">
          <strong>Status: {dispute.status}</strong>
          <p>{dispute.details}</p>
          {dispute.resolution && <p>Review note: {dispute.resolution}</p>}
          {dispute.status !== "open" && (
            <ActionButton className="link" onClick={() => setFilingAnother(true)}>
              File another dispute
            </ActionButton>
          )}
        </div>
      )}
      {showForm && (
        <form className="report-form" onSubmit={submit}>
          <label>
            Explain what seems wrong with the result
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              minLength={20}
              maxLength={2000}
              rows={4}
              required
            />
          </label>
          <ActionButton className="btn" type="submit" loading={submitting}>
            {submitting ? "Submitting..." : "Submit dispute"}
          </ActionButton>
        </form>
      )}
    </div>
  );
}

function LudoBoard({ game, onRoll, onMove, actionPending }) {
  const { state, legal_moves: legalMoves, viewer, players } = game;
  const [fairnessStatus, setFairnessStatus] = useState("");
  useEffect(() => setFairnessStatus(""), [game.room_id]);
  const currentPlayer = state.players.find((player) => player.user_id === state.turn_user_id);
  const canRoll = viewer.is_turn && state.die_value == null && state.status === "active";
  const resultMessage = state.last_result === "no_legal_move"
    ? state.last_roll === 6
      ? "No token can move. Roll again."
      : "No legal move. Turn passed."
    : state.last_result === "captured"
      ? "Token captured and sent back to base."
      : "";

  async function verifyFairness() {
    setFairnessStatus("Verifying recorded rolls...");
    try {
      const verified = await verifyLudoProof(game.fairness);
      setFairnessStatus(
        verified
          ? `Verified ${game.fairness.rolls.length} recorded rolls.`
          : "Verification failed. Do not rely on these rolls.",
      );
    } catch (error) {
      setFairnessStatus(`Could not verify rolls: ${error.message}`);
    }
  }

  return (
    <div className="ludo-layout">
      <div className="ludo-controls card">
        <div className="dice-display" aria-live="polite">
          {state.die_value ?? state.last_roll ?? "-"}
        </div>
        <ActionButton className="btn" onClick={onRoll} disabled={!canRoll || actionPending}>
          {actionPending ? "Rolling..." : "Roll die"}
        </ActionButton>
        <p>
          {state.status === "finished"
            ? state.winner_user_id === viewer.user_id
              ? "You won!"
              : `${players[currentPlayer.color]} won the match.`
            : viewer.is_turn
              ? state.die_value == null
                ? "Your turn. Roll the die."
                : `You rolled ${state.die_value}. Choose a legal token.`
              : `Waiting for ${players[currentPlayer.color]} (${currentPlayer.color}).`}
        </p>
        {resultMessage && <p className="ludo-result">{resultMessage}</p>}
        <p className="practice-note">
          A six lets a token leave base and grants another roll. Exact rolls are required to finish;
          captures do not grant an extra turn, and there is no three-sixes penalty.
        </p>
        <p className="practice-note">
          {game.solo
            ? "The computer's dice are generated on the server for solo practice."
            : "Rolls are committed before play. The server seed is revealed when the match ends."}
        </p>
        {game.fairness?.available ? (
          <div className="fairness-info">
            <p>Server-seed commitment (SHA-256)</p>
            <code>{game.fairness.server_seed_hash}</code>
            {game.fairness.server_seed ? (
              <>
                <p>Revealed server seed</p>
                <code>{game.fairness.server_seed}</code>
                <ActionButton className="link" onClick={verifyFairness}>Verify recorded rolls</ActionButton>
                <details className="fairness-rolls">
                  <summary>Show roll proof data ({game.fairness.rolls.length})</summary>
                  <ol>
                    {game.fairness.rolls.map((roll) => (
                      <li key={roll.nonce}>
                        Roll {roll.nonce}: {roll.value} · client seed <code>{roll.client_seed}</code>
                      </li>
                    ))}
                  </ol>
                </details>
                {fairnessStatus && <p role="status">{fairnessStatus}</p>}
              </>
            ) : game.solo ? (
              <p className="practice-note">Solo practice does not use a multiplayer roll proof.</p>
            ) : (
              <p>Seed reveal is available after the match is finished.</p>
            )}
          </div>
        ) : (
          <p className="practice-note">
            This match started before verifiable dice were enabled.
          </p>
        )}
      </div>
      <div className="ludo-players">
        {state.players.map((player) => (
          <div className={`card ludo-player ${player.color}`} key={player.user_id}>
            <div className="ludo-player-heading">
              <h3>
                <TurnIndicator
                  playerName={players[player.color]}
                  isTurn={player.user_id === state.turn_user_id}
                  gameActive={state.status === "active"}
                />
                <PlayerProfileLink username={players[player.color]} />
              </h3>
              <span>{player.color}{player.user_id === viewer.user_id ? " · You" : ""}</span>
            </div>
            <div className="ludo-tokens">
              {player.tokens.map((progress, tokenIndex) => {
                const canMove = viewer.is_turn && player.user_id === viewer.user_id &&
                  legalMoves.some((move) => move.token_index === tokenIndex);
                const position = progress === -1
                  ? "Base"
                  : progress === 57
                    ? "Home"
                    : progress >= 52
                      ? `Home ${progress - 51}/6`
                      : `Track ${progress + 1}/52`;
                return (
                  <ActionButton
                    className={`ludo-token${canMove ? " movable" : ""}${progress === 57 ? " finished" : ""}`}
                    key={tokenIndex}
                    onClick={() => onMove(tokenIndex)}
                    disabled={!canMove || actionPending}
                    aria-label={`${player.color} token ${tokenIndex + 1}: ${position}`}
                  >
                    <span>{tokenIndex + 1}</span>
                    <small>{position}</small>
                  </ActionButton>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerProfileLink({ username, children }) {
  if (!username || username.startsWith("Computer")) return children || username;
  return (
    <a
      className="player-profile-link"
      href={`/?player=${encodeURIComponent(username)}`}
      target="_blank"
      rel="noreferrer"
    >
      {children || username}
    </a>
  );
}

function TurnIndicator({ playerName, isTurn, gameActive = true }) {
  const state = !gameActive ? "finished" : isTurn ? "active" : "waiting";
  const label = !gameActive
    ? `${playerName}: game finished`
    : isTurn
      ? `${playerName}: to move`
      : `${playerName}: waiting`;
  return <span className={`turn-indicator ${state}`} role="img" aria-label={label} title={label} />;
}

function GameOrientationToggle({ orientation, onChange }) {
  return (
    <div className="orientation-toggle" role="group" aria-label="Game view orientation">
      {["portrait", "landscape"].map((view) => (
        <button
          className={orientation === view ? "selected" : ""}
          key={view}
          type="button"
          aria-pressed={orientation === view}
          onClick={() => onChange(view)}
        >
          {view === "portrait" ? "Portrait" : "Landscape"}
        </button>
      ))}
    </div>
  );
}

function BoardPlayerLabel({ name, username = name, side, isTurn, gameActive = true }) {
  return (
    <div className="board-player-label">
      <strong>
        <TurnIndicator playerName={name} isTurn={isTurn} gameActive={gameActive} />
        <PlayerProfileLink username={username}>{name}</PlayerProfileLink>
      </strong>
      <span>{side}</span>
    </div>
  );
}

function ChessBoard({ game, selectedSquare, onSquareClick, actionPending, pendingSquare }) {
  const { state, legal_moves: legalMoves, viewer, players } = game;
  const activePlayer = players[state.turn_user_id === state.white_player_id ? "white" : "black"];
  const glyphs = {
    K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
    k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
  };
  const targets = selectedSquare
    ? legalMoves.filter((move) => (
      move.from_x === selectedSquare.x && move.from_y === selectedSquare.y
    ))
    : [];
  const result = state.status === "finished"
    ? state.winner_user_id
      ? `${players[state.winner_user_id === state.white_player_id ? "white" : "black"]} wins by checkmate.`
      : `Draw${state.result ? ` (${state.result})` : ""}.`
    : viewer.is_turn
      ? state.check ? "Your move. You are in check." : "Your move."
      : `Waiting for ${activePlayer}${state.check ? " — in check" : ""}.`;

  return (
    <div className="game-layout">
      <div className="board-with-players">
        <BoardPlayerLabel
          name={game.player_display_names?.black || players.black}
          username={players.black}
          side="Black"
          isTurn={state.turn_user_id === state.black_player_id}
          gameActive={state.status === "active"}
        />
        <div className="chess-board" role="grid" aria-label="Chess board">
          {state.board.flatMap((row, y) => row.map((piece, x) => {
            const isSelected = selectedSquare?.x === x && selectedSquare?.y === y;
            const isTarget = targets.some((move) => move.to_x === x && move.to_y === y);
            const shade = (x + y) % 2 === 1 ? "dark" : "light";
            return (
              <ActionButton
                className={`square ${shade}${isSelected ? " selected" : ""}${isTarget ? " target" : ""}`}
                key={`${x}-${y}`}
                role="gridcell"
                aria-label={`${piece === "." ? "Empty" : `${piece === piece.toUpperCase() ? "White" : "Black"} ${({
                  k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn",
                })[piece.toLowerCase()]}`} ${"abcdefgh"[x]}${8 - y}`}
                onClick={() => onSquareClick(x, y)}
                loading={pendingSquare?.x === x && pendingSquare?.y === y}
                disabled={actionPending || !viewer.is_turn || state.status !== "active"}
              >
                {piece !== "." && (
                  <span className={`chess-piece ${piece === piece.toUpperCase() ? "white" : "black"}`}>
                    {glyphs[piece]}
                  </span>
                )}
              </ActionButton>
            );
          }))}
        </div>
        <BoardPlayerLabel
          name={game.player_display_names?.white || players.white}
          username={players.white}
          side="White"
          isTurn={state.turn_user_id === state.white_player_id}
          gameActive={state.status === "active"}
        />
      </div>
      <div className="game-info card">
        <p>You are <strong>{players[viewer.side]}</strong> ({viewer.side}).</p>
        <p aria-live="polite">{result}</p>
        <p>White: {players.white} · Black: {players.black}</p>
        {state.moves.length > 0 && (
          <details className="chess-history">
            <summary>Move history ({state.moves.length})</summary>
            <ol>
              {Array.from({ length: Math.ceil(state.moves.length / 2) }, (_, index) => (
                <li key={index}>
                  {state.moves[index * 2]?.san}
                  {state.moves[index * 2 + 1] ? ` · ${state.moves[index * 2 + 1].san}` : ""}
                </li>
              ))}
            </ol>
          </details>
        )}
        <p className="practice-note">Standard chess rules. Free practice only; no stakes or prizes.</p>
      </div>
    </div>
  );
}

function GolfScorecard({ game, onSubmitScore, actionPending }) {
  const { state, players, viewer } = game;
  const [strokes, setStrokes] = useState(state.pars[state.current_hole - 1] || 4);
  const golferOnTurn = state.players.find(
    (player) => player.user_id === state.turn_user_id,
  );
  const currentPar = state.pars[state.current_hole - 1] || 4;
  const winners = state.winner_user_ids.map((userId) => players[userId]);

  useEffect(() => {
    setStrokes(state.pars[state.current_hole - 1] || 4);
  }, [game.room_id, state.current_hole]);

  const status = state.status === "finished"
    ? winners.length > 1
      ? `Round complete. Tied winners: ${winners.join(", ")}.`
      : `${winners[0]} wins with the lowest total.`
    : viewer.is_turn
      ? `Your turn to enter your strokes for hole ${state.current_hole} (par ${currentPar}).`
      : `Waiting for ${players[golferOnTurn?.user_id]} to enter a score for hole ${state.current_hole}.`;

  return (
    <div className="golf-layout">
      <div className="card golf-scorecard-wrap">
        <p className="eyebrow">NINE-HOLE STROKE PLAY</p>
        <h3>Scorecard</h3>
        <div className="golf-scorecard-scroll">
          <table className="golf-scorecard">
            <thead>
              <tr>
                <th scope="col">Player</th>
                {state.pars.map((_, index) => (
                  <th scope="col" key={index}>{index + 1}</th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr className="golf-par-row">
                <th scope="row">Par</th>
                {state.pars.map((par, index) => <td key={index}>{par}</td>)}
                <td>{state.pars.reduce((sum, par) => sum + par, 0)}</td>
              </tr>
              {state.players.map((golfer) => {
                const recordedScores = golfer.scores.filter((score) => score != null);
                const total = recordedScores.reduce((sum, score) => sum + score, 0);
                const isOnTurn = golfer.user_id === state.turn_user_id && state.status === "active";
                return (
                  <tr className={isOnTurn ? "golf-player-on-turn" : ""} key={golfer.user_id}>
                    <th scope="row">
                      <TurnIndicator
                        playerName={players[golfer.user_id]}
                        isTurn={isOnTurn}
                        gameActive={state.status === "active"}
                      />
                      <PlayerProfileLink username={players[golfer.user_id]} />
                      {golfer.user_id === viewer.user_id ? " (you)" : ""}
                    </th>
                    {golfer.scores.map((score, index) => (
                      <td key={index}>{score ?? "—"}</td>
                    ))}
                    <td>{recordedScores.length ? total : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="game-info card golf-controls">
        <strong aria-live="polite">{status}</strong>
        <p>
          {state.status === "active"
            ? `Hole ${state.current_hole} of ${state.pars.length} · Par ${currentPar}`
            : `${state.pars.length} holes completed`}
        </p>
        {viewer.is_turn && state.status === "active" && (
          <form onSubmit={(event) => {
            event.preventDefault();
            onSubmitScore(Number(strokes));
          }}>
            <label>
              Your completed strokes
              <input
                type="number"
                min="1"
                max="15"
                step="1"
                value={strokes}
                onChange={(event) => setStrokes(event.target.value)}
                required
              />
            </label>
            <ActionButton
              className="btn"
              type="submit"
              loading={actionPending}
              disabled={actionPending || !Number.isInteger(Number(strokes)) || Number(strokes) < 1 || Number(strokes) > 15}
            >
              {actionPending ? "Submitting..." : "Submit hole score"}
            </ActionButton>
          </form>
        )}
        <p className="practice-note">
          Enter your completed hole score in turn. Scores are self-reported for friendly practice;
          this is a scorecard simulation, not shot-by-shot golf.
        </p>
      </div>
    </div>
  );
}

function PoloScorecard({ game, onSubmitScore, actionPending }) {
  const { state, players, viewer } = game;
  const [goals, setGoals] = useState(0);
  const teamOnTurn = state.teams.find((team) => team.user_id === state.turn_user_id);
  const currentTeam = state.teams.find((team) => team.user_id === viewer.user_id);
  const winners = state.winner_user_ids.map((userId) => players[userId]);

  useEffect(() => {
    setGoals(0);
  }, [game.room_id, state.current_chukka, state.turn_user_id]);

  const status = state.status === "finished"
    ? winners.length > 1
      ? `Match tied between ${winners.join(" and ")}.`
      : `${winners[0]} wins the match.`
    : viewer.is_turn
      ? `Your turn to enter your team's goals for chukka ${state.current_chukka}.`
      : `Waiting for ${players[teamOnTurn?.user_id]} to enter their goals for chukka ${state.current_chukka}.`;

  return (
    <div className="golf-layout">
      <div className="card golf-scorecard-wrap">
        <p className="eyebrow">FOUR-CHUKKA MATCH</p>
        <h3>Polo scorecard</h3>
        <div className="golf-scorecard-scroll">
          <table className="golf-scorecard">
            <thead>
              <tr>
                <th scope="col">Team captain</th>
                {Array.from({ length: state.chukkas }, (_, index) => (
                  <th scope="col" key={index}>C{index + 1}</th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {state.teams.map((team, index) => {
                const recordedGoals = team.goals.filter((score) => score != null);
                const total = recordedGoals.reduce((sum, score) => sum + score, 0);
                const isOnTurn = team.user_id === state.turn_user_id && state.status === "active";
                return (
                  <tr className={isOnTurn ? "golf-player-on-turn" : ""} key={team.user_id}>
                    <th scope="row">
                      <TurnIndicator
                        playerName={players[team.user_id]}
                        isTurn={isOnTurn}
                        gameActive={state.status === "active"}
                      />
                      Team {index === 0 ? "A" : "B"} · <PlayerProfileLink username={players[team.user_id]} />
                      {team.user_id === viewer.user_id ? " (you)" : ""}
                    </th>
                    {team.goals.map((score, scoreIndex) => (
                      <td key={scoreIndex}>{score ?? "—"}</td>
                    ))}
                    <td>{recordedGoals.length ? total : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="game-info card golf-controls">
        <strong aria-live="polite">{status}</strong>
        <p>
          {state.status === "active"
            ? `Chukka ${state.current_chukka} of ${state.chukkas}`
            : `${state.chukkas} chukkas completed`}
        </p>
        {viewer.is_turn && state.status === "active" && (
          <form onSubmit={(event) => {
            event.preventDefault();
            onSubmitScore(Number(goals));
          }}>
            <label>
              Goals scored by Team {state.turn_index === 0 ? "A" : "B"} this chukka
              <input
                type="number"
                min="0"
                max="20"
                step="1"
                value={goals}
                onChange={(event) => setGoals(event.target.value)}
                required
              />
            </label>
            <ActionButton
              className="btn"
              type="submit"
              loading={actionPending}
              disabled={actionPending || !Number.isInteger(Number(goals)) || Number(goals) < 0 || Number(goals) > 20}
            >
              {actionPending ? "Submitting..." : "Submit chukka score"}
            </ActionButton>
          </form>
        )}
        <p className="practice-note">
          Each player represents one team and enters goals for their team in turn. Scores are
          self-reported for friendly practice; this is a scorecard simulation.
          {currentTeam ? ` You represent Team ${state.teams.indexOf(currentTeam) === 0 ? "A" : "B"}.` : ""}
        </p>
      </div>
    </div>
  );
}

function SnookerScorecard({ game, onSubmitScore, actionPending }) {
  const { state, players, viewer } = game;
  const [breakPoints, setBreakPoints] = useState(0);
  const currentPlayer = state.players.find(
    (player) => player.user_id === state.turn_user_id,
  );
  const winners = state.winner_user_ids.map((userId) => players[userId]);
  const winner = state.players.find(
    (player) => player.user_id === state.winner_user_ids[0],
  );
  const runnerUp = state.players.find(
    (player) => player.user_id !== state.winner_user_ids[0],
  );

  useEffect(() => {
    setBreakPoints(0);
  }, [game.room_id, state.current_frame, state.turn_user_id]);

  const status = state.status === "finished"
    ? winners.length > 1
      ? `Match tied after ${state.frames} frames.`
      : `${winners[0]} wins ${winner.frame_wins}-${runnerUp.frame_wins}.`
    : viewer.is_turn
      ? `Your turn to enter your points for frame ${state.current_frame}.`
      : `Waiting for ${players[currentPlayer?.user_id]} to enter their points for frame ${state.current_frame}.`;

  return (
    <div className="golf-layout">
      <div className="card golf-scorecard-wrap">
        <p className="eyebrow">BEST OF THREE FRAMES</p>
        <h3>Snooker scorecard</h3>
        <div className="golf-scorecard-scroll">
          <table className="golf-scorecard">
            <thead>
              <tr>
                <th scope="col">Player</th>
                {Array.from({ length: state.frames }, (_, index) => (
                  <th scope="col" key={index}>Frame {index + 1}</th>
                ))}
                <th scope="col">Frames won</th>
              </tr>
            </thead>
            <tbody>
              {state.players.map((player) => {
                const isOnTurn = player.user_id === state.turn_user_id && state.status === "active";
                return (
                  <tr className={isOnTurn ? "golf-player-on-turn" : ""} key={player.user_id}>
                    <th scope="row">
                      <TurnIndicator
                        playerName={players[player.user_id]}
                        isTurn={isOnTurn}
                        gameActive={state.status === "active"}
                      />
                      <PlayerProfileLink username={players[player.user_id]} />
                      {player.user_id === viewer.user_id ? " (you)" : ""}
                    </th>
                    {player.scores.map((score, index) => (
                      <td key={index}>{score ?? "—"}</td>
                    ))}
                    <td>{player.frame_wins}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="game-info card golf-controls">
        <strong aria-live="polite">{status}</strong>
        <p>
          {state.status === "active"
            ? `Frame ${state.current_frame} of ${state.frames} · first to ${state.frames_to_win} frame wins`
            : `${state.frames} frames maximum`}
        </p>
        {viewer.is_turn && state.status === "active" && (
          <form onSubmit={(event) => {
            event.preventDefault();
            onSubmitScore(Number(breakPoints));
          }}>
            <label>
              Your frame points (0-155)
              <input
                type="number"
                min="0"
                max="155"
                step="1"
                value={breakPoints}
                onChange={(event) => setBreakPoints(event.target.value)}
                required
              />
            </label>
            <ActionButton
              className="btn"
              type="submit"
              loading={actionPending}
              disabled={actionPending || !Number.isInteger(Number(breakPoints)) || Number(breakPoints) < 0 || Number(breakPoints) > 155}
            >
              {actionPending ? "Submitting..." : "Submit frame score"}
            </ActionButton>
          </form>
        )}
        <p className="practice-note">
          Players enter their own frame points in turn. The higher score takes the frame; a tied
          frame is not awarded. Scores are self-reported for friendly practice, not referee-verified.
        </p>
      </div>
    </div>
  );
}

const WHOT_SUIT_NAMES = {
  circle: "Circle",
  triangle: "Triangle",
  cross: "Cross",
  square: "Square",
  star: "Star",
};

function WhotSuitSymbol({ suit }) {
  let shape;
  switch (suit) {
    case "circle":
      shape = <circle cx="24" cy="24" r="15" />;
      break;
    case "triangle":
      shape = <path d="M24 7 42 39H6L24 7Z" />;
      break;
    case "cross":
      shape = (
        <path
          d="m15 8 9 10 9-10 7 7-10 9 10 9-7 7-9-10-9 10-7-7 10-9-10-9 7-7Z"
          fill="currentColor"
          stroke="none"
        />
      );
      break;
    case "square":
      shape = <rect x="9" y="9" width="30" height="30" rx="2" />;
      break;
    case "star":
      shape = <path d="m24 5 5.7 12 13.2 1.6-9.7 9.1 2.6 13-11.8-6.5-11.8 6.5 2.6-13-9.7-9.1L18.3 17 24 5Z" />;
      break;
    default:
      return null;
  }

  return (
    <svg
      className={`whot-suit-symbol whot-suit-${suit}`}
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      {shape}
    </svg>
  );
}

function WhotCardFace({ number, suit }) {
  return (
    <>
      <strong>{number}</strong>
      {suit ? (
        <WhotSuitSymbol suit={suit} />
      ) : (
        <span className="whot-wild-symbol" aria-hidden="true">
          {Object.keys(WHOT_SUIT_NAMES).map((wildSuit) => (
            <WhotSuitSymbol key={wildSuit} suit={wildSuit} />
          ))}
        </span>
      )}
    </>
  );
}

function WhotBoard({ game, onPlay, onDraw, actionPending }) {
  const { state, legal_moves: legalMoves, viewer, players, can_draw: canDraw } = game;
  const [chosenSuit, setChosenSuit] = useState("circle");
  const hasPlayableWhot = state.players
    .find((player) => player.user_id === viewer.user_id)
    ?.hand.some((card) => card.number === 20 && legalMoves.includes(card.id));
  const activePlayerName = players[state.turn_user_id];
  const resultMessage = state.last_result === "general_market"
    ? "Everyone else drew one card."
    : state.last_result === "held"
      ? "The next player was held."
      : state.last_result === "suspended"
        ? "The next player was skipped."
        : state.last_result?.startsWith("drew_")
          ? `The next player drew ${state.last_result.match(/drew_(\d+)/)?.[1] || ""} and was skipped.`
          : state.last_result === "drew_card"
            ? "You drew one card. Your turn passed."
            : "";

  return (
    <div className="whot-layout">
      <div className="whot-table card">
        <div className="whot-status" aria-live="polite">
          <strong>
            {state.status === "finished"
              ? `${players[state.winner_user_id]} won!`
              : viewer.is_turn
                ? "Your turn"
                : `Waiting for ${activePlayerName}`}
          </strong>
          <span>Current suit: {state.current_suit}</span>
          <span>Cards to draw: {state.draw_pile_count}</span>
        </div>
        <div className="whot-discard">
          <span
            className={`whot-card ${state.discard_top.suit || "whot-wild"}`}
            role="img"
            aria-label={`Top card: ${state.discard_top.suit
              ? WHOT_SUIT_NAMES[state.discard_top.suit]
              : "Whot"} ${state.discard_top.number}`}
          >
            <WhotCardFace number={state.discard_top.number} suit={state.discard_top.suit} />
          </span>
          <span>Top card</span>
        </div>
        {resultMessage && <p className="whot-result">{resultMessage}</p>}
        {state.status === "finished" && (
          <p className="whot-result">
            {state.winner_user_id === viewer.user_id ? "You won the game!" : "Game over."}
          </p>
        )}
        {hasPlayableWhot && (
          <label className="whot-suit-picker">
            Choose the next suit
            <select value={chosenSuit} onChange={(event) => setChosenSuit(event.target.value)}>
              {["circle", "triangle", "cross", "square", "star"].map((suit) => (
                <option key={suit} value={suit}>{suit}</option>
              ))}
            </select>
          </label>
        )}
        {canDraw && (
          <ActionButton className="btn" onClick={onDraw} disabled={actionPending}>
            {actionPending ? "Drawing..." : "Draw one card"}
          </ActionButton>
        )}
        <p className="practice-note">
          Match suit or number. A 1 holds, 2 draws two, 5 draws three, 8 skips, 14 starts a
          general market, and WHOT 20 chooses a suit. Penalty cards do not stack.
        </p>
      </div>
      <div className="whot-players">
        {state.players.map((player) => (
          <div className="card whot-player" key={player.user_id}>
            <strong>
              <TurnIndicator
                playerName={players[player.user_id]}
                isTurn={player.user_id === state.turn_user_id}
                gameActive={state.status === "active"}
              />
              <PlayerProfileLink username={players[player.user_id]} />
              {player.user_id === viewer.user_id ? " (you)" : ""}
            </strong>
            <span>{player.card_count} cards</span>
            {player.user_id === viewer.user_id && (
              <div className="whot-hand" aria-label="Your hand">
                {player.hand.map((card) => {
                  const playable = viewer.is_turn && legalMoves.includes(card.id);
                  return (
                    <ActionButton
                      className={`whot-card ${card.suit || "whot-wild"}${playable ? " playable" : ""}`}
                      key={card.id}
                      disabled={!playable || actionPending}
                      onClick={() => onPlay(card.id, card.number === 20 ? chosenSuit : undefined)}
                      aria-label={`${card.suit ? WHOT_SUIT_NAMES[card.suit] : "Whot"} ${card.number}`}
                    >
                      <WhotCardFace number={card.number} suit={card.suit} />
                    </ActionButton>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SoloDraughts({ token, username, displayName, orientation, onOrientationChange, onClose }) {
  const [game, setGame] = useState(createSoloDraughtsGame);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [level, setLevel] = useState(1);
  const [gameLevel, setGameLevel] = useState(1);
  const [highestLevel, setHighestLevel] = useState(1);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressSaving, setProgressSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [round, setRound] = useState(0);
  const recordedRound = useRef(null);
  const legalMoves = legalSoloDraughtsMoves(game, "player");

  useEffect(() => {
    let stopped = false;
    setProgressLoading(true);
    setLoadError("");
    api.getSoloDraughtsProgress(token)
      .then(({ highest_level: savedLevel }) => {
        if (stopped) return;
        setHighestLevel(savedLevel);
        setLevel(savedLevel);
        setGameLevel(savedLevel);
        setProgressLoaded(true);
      })
      .catch((err) => {
        if (!stopped) setLoadError(err.message);
      })
      .finally(() => {
        if (!stopped) setProgressLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [token, loadAttempt]);

  useEffect(() => {
    if (
      !progressLoaded
      || game.turn !== "system"
      || game.status !== "active"
    ) {
      setThinking(false);
      return undefined;
    }

    setThinking(true);
    const timer = window.setTimeout(() => {
      setGame((current) => {
        const move = chooseComputerMove(current, gameLevel);
        return move ? applySoloDraughtsMove(current, "system", move) : current;
      });
      setThinking(false);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [game, gameLevel, progressLoaded]);

  useEffect(() => {
    if (
      !progressLoaded
      || game.status !== "finished"
      || game.winner !== "player"
      || recordedRound.current === round
    ) {
      return undefined;
    }

    recordedRound.current = round;
    let stopped = false;
    setProgressSaving(true);
    setSaveError("");
    api.completeSoloDraughtsLevel(token, gameLevel)
      .then(({ highest_level: savedLevel }) => {
        if (stopped) return;
        setHighestLevel(savedLevel);
        const nextLevel = gameLevel + 1;
        if (nextLevel <= savedLevel) {
          setLevel(nextLevel);
          setGameLevel(nextLevel);
          setGame(createSoloDraughtsGame());
          setSelectedSquare(null);
          setThinking(false);
          setProgressMessage(
            savedLevel > highestLevel
              ? `Level ${savedLevel} unlocked! Starting level ${nextLevel}.`
              : `Starting level ${nextLevel}.`,
          );
          setRound((current) => current + 1);
        } else if (gameLevel === 100) {
          setProgressMessage("You completed the final level!");
        } else {
          setProgressMessage(`Level ${gameLevel} completed.`);
        }
      })
      .catch((err) => {
        if (!stopped) setSaveError(err.message);
      })
      .finally(() => {
        if (!stopped) setProgressSaving(false);
      });
    return () => {
      stopped = true;
    };
  }, [game.status, game.winner, gameLevel, progressLoaded, round, saveAttempt, token]);

  function chooseSquare(x, y) {
    if (
      !progressLoaded
      || game.turn !== "player"
      || game.status !== "active"
      || thinking
    ) return;
    const move = selectedSquare && legalMoves.find(
      (candidate) =>
        candidate.from_x === selectedSquare.x
        && candidate.from_y === selectedSquare.y
        && candidate.to_x === x
        && candidate.to_y === y,
    );
    if (move) {
      setGame((current) => applySoloDraughtsMove(current, "player", move));
      setSelectedSquare(null);
      return;
    }

    if (legalMoves.some((candidate) => candidate.from_x === x && candidate.from_y === y)) {
      setSelectedSquare({ x, y });
    } else {
      setSelectedSquare(null);
    }
  }

  function startNewGame() {
    setGame(createSoloDraughtsGame());
    setGameLevel(level);
    setSelectedSquare(null);
    setThinking(false);
    setProgressMessage("");
    setSaveError("");
    setRound((current) => current + 1);
  }

  function chooseLevel(event) {
    const selectedLevel = Number(event.target.value);
    setLevel(selectedLevel);
    setGameLevel(selectedLevel);
    setGame(createSoloDraughtsGame());
    setSelectedSquare(null);
    setThinking(false);
    setProgressMessage("");
    setSaveError("");
    setRound((current) => current + 1);
  }

  const statusMessage = game.status === "finished"
    ? game.winner === "player" ? `You beat level ${gameLevel}!` : `The system wins. Try level ${gameLevel} again.`
    : progressLoading ? "Loading your saved level progress..."
      : !progressLoaded ? "Your levels could not be loaded."
    : thinking ? "The system is thinking..."
      : game.turn === "player"
        ? "Your turn. Select a piece, then a highlighted destination."
        : "The system's turn.";

  return (
    <section
      className={`game-section solo-game-section orientation-${orientation}`}
      id="solo-practice"
      aria-label="Solo Draughts"
    >
      <div className="game-toolbar">
        <div>
          <p className="eyebrow">SOLO PRACTICE · LEVEL {gameLevel}</p>
          <h2>Draughts vs computer</h2>
        </div>
        <div className="room-actions">
          <GameOrientationToggle orientation={orientation} onChange={onOrientationChange} />
          <ActionButton
            className="link"
            onClick={startNewGame}
            disabled={progressSaving}
          >
            New game
          </ActionButton>
          <ActionButton className="link" onClick={onClose}>Quit game</ActionButton>
        </div>
      </div>
      <div className="solo-draughts-layout">
        <div className="board-with-players">
          <BoardPlayerLabel
            name="Computer"
            side="Black"
            isTurn={game.turn === "computer"}
            gameActive={game.status === "active"}
          />
          <div className="draughts-board" aria-label="Solo Draughts board">
            {game.board.flatMap((row, y) =>
              row.map((piece, x) => {
                const isSelected = selectedSquare?.x === x && selectedSquare?.y === y;
                const isTarget = selectedSquare && legalMoves.some(
                  (move) =>
                    move.from_x === selectedSquare.x
                    && move.from_y === selectedSquare.y
                    && move.to_x === x
                    && move.to_y === y,
                );
                const shade = (x + y) % 2 === 1 ? "dark" : "light";
                const owner = piece === "." ? "Empty" : piece.toLowerCase() === "r" ? "Your" : "System";
                return (
                  <ActionButton
                    className={`square ${shade}${isSelected ? " selected" : ""}${isTarget ? " target" : ""}`}
                    key={`${x}-${y}`}
                    aria-label={`${owner} square ${x + 1}, ${y + 1}`}
                    onClick={() => chooseSquare(x, y)}
                    disabled={
                      !progressLoaded
                      || game.turn !== "player"
                      || game.status !== "active"
                      || thinking
                    }
                  >
                    {piece !== "." && (
                      <span className={`piece ${piece.toLowerCase() === "r" ? "red-piece" : "black-piece"}${piece === "R" || piece === "B" ? " king" : ""}`}>
                        {piece === "R" || piece === "B" ? "K" : ""}
                      </span>
                    )}
                  </ActionButton>
                );
              })
            )}
          </div>
          <BoardPlayerLabel
            name={displayName || username}
            username={username}
            side="Red · You"
            isTurn={game.turn === "player"}
            gameActive={game.status === "active"}
          />
        </div>
        <div className="game-info card" aria-live="polite">
          <p><strong>{statusMessage}</strong></p>
          {progressLoaded && (
            <label className="solo-level-picker">
              Level — {highestLevel} of 100 unlocked
              <select value={level} onChange={chooseLevel} disabled={progressSaving}>
                {Array.from({ length: highestLevel }, (_, index) => index + 1).map((unlocked) => (
                  <option key={unlocked} value={unlocked}>Level {unlocked}</option>
                ))}
              </select>
              <small>Win a level to unlock the next. Changing level starts a new game.</small>
            </label>
          )}
          <p>You play as red. The system plays as black.</p>
          <p>Captures are mandatory. Continue a multi-jump with the same piece.</p>
          {progressSaving && <p className="practice-note">Saving your level progress...</p>}
          {progressMessage && <p className="practice-note">{progressMessage}</p>}
          {loadError && (
            <div>
              <p className="error" role="alert">Could not load your levels: {loadError}</p>
              <ActionButton className="link" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                Retry
              </ActionButton>
            </div>
          )}
          {saveError && (
            <div>
              <p className="error" role="alert">
                Could not save your level progress: {saveError}
              </p>
              <ActionButton
                className="link"
                onClick={() => {
                  recordedRound.current = null;
                  setSaveAttempt((attempt) => attempt + 1);
                }}
              >
                Retry saving
              </ActionButton>
            </div>
          )}
          <p className="practice-note">Free practice against the computer. An account is required; there are no stakes.</p>
        </div>
      </div>
    </section>
  );
}

function SoloGame({ token, gameId, orientation, onOrientationChange, onClose }) {
  const [game, setGame] = useState(null);
  const [level, setLevel] = useState(1);
  const [highestLevel, setHighestLevel] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const gameName = gameId.charAt(0).toUpperCase() + gameId.slice(1);

  useEffect(() => {
    document.getElementById("solo-practice")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError("");
    api.getCurrentSoloGame(token, gameId)
      .then(({ session: current, progress }) => {
        if (stopped) return;
        setHighestLevel(progress.highest_level);
        setLevel(current?.status === "active" ? current.level : progress.highest_level);
        setGame(current);
      })
      .catch((err) => {
        if (!stopped) setError(err.message);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [token, gameId, loadAttempt]);

  async function startGame(selectedLevel = level) {
    setPending(true);
    setError("");
    try {
      const result = await api.startSoloGame(token, gameId, selectedLevel);
      setHighestLevel(result.progress.highest_level);
      setLevel(selectedLevel);
      setGame(result.session);
      setSelectedSquare(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  async function submitAction(action) {
    if (!game) return;
    setPending(true);
    setError("");
    try {
      const result = await api.submitSoloGameAction(
        token,
        gameId,
        game.solo_session_id,
        action,
      );
      setGame(result.session);
      setHighestLevel(result.progress.highest_level);
      setLevel(result.session.level);
      setSelectedSquare(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  function chooseChessSquare(x, y) {
    if (!game || !game.viewer.is_turn || pending) return;
    const targetMoves = selectedSquare && game.legal_moves.filter(
      (move) => move.from_x === selectedSquare.x
        && move.from_y === selectedSquare.y
        && move.to_x === x
        && move.to_y === y,
    );
    if (targetMoves?.length) {
      const move = targetMoves.find((candidate) => candidate.uci.endsWith("q")) || targetMoves[0];
      void submitAction({ action: "move", uci: move.uci });
      return;
    }
    const canMovePiece = game.legal_moves.some(
      (move) => move.from_x === x && move.from_y === y,
    );
    setSelectedSquare(canMovePiece ? { x, y } : null);
  }

  const scorecardProps = {
    game,
    actionPending: pending,
    onSubmitScore: (value) => void submitAction({ action: "score", value }),
  };
  const levelWon = Boolean(game && (
    game.state.winner_user_id === game.viewer.user_id
    || game.state.winner_user_ids?.includes(game.viewer.user_id)
  ));

  return (
    <section
      className={`game-section solo-game-section orientation-${orientation}`}
      id="solo-practice"
      aria-label={`Solo ${gameName}`}
    >
      <div className="game-toolbar">
        <div>
          <p className="eyebrow">SOLO PRACTICE · LEVEL {game?.level || level}</p>
          <h2>{gameName} vs computer</h2>
        </div>
        <div className="room-actions">
          <GameOrientationToggle orientation={orientation} onChange={onOrientationChange} />
          <ActionButton className="link" onClick={onClose}>Quit game</ActionButton>
        </div>
      </div>

      {loading ? (
        <p className="login-prompt">Loading your saved solo game...</p>
      ) : !game || game.status !== "active" ? (
        <div className="game-info card solo-level-controls">
          <p>
            {game?.status === "finished"
              ? levelWon
                ? `You won level ${game.level}. ${highestLevel > game.level ? `Level ${game.level + 1} is unlocked.` : "You have reached the highest unlocked level."}`
                : `Level ${game.level} is finished. Win to unlock the next level.`
              : `Choose an unlocked level. Level ${highestLevel} is currently your highest.`}
          </p>
          <label className="solo-level-picker">
            Level — {highestLevel} of 100 unlocked
            <select
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              disabled={pending}
            >
              {Array.from({ length: highestLevel }, (_, index) => index + 1).map((unlocked) => (
                <option key={unlocked} value={unlocked}>Level {unlocked}</option>
              ))}
            </select>
          </label>
          <ActionButton className="btn" onClick={() => void startGame()} disabled={pending}>
            {pending ? "Starting..." : `Start level ${level}`}
          </ActionButton>
        </div>
      ) : (
        <>
          <div className="solo-level-controls card">
            <strong>Level {game.level} · Computer opponent</strong>
            <span>
              {gameId === "golf" || gameId === "polo" || gameId === "snooker"
                ? "The computer's score is generated for this difficulty level."
                : "Win to unlock the next level. Each game keeps its own progress."}
            </span>
            <label className="solo-level-picker">
              New game level
              <select
                value={level}
                onChange={(event) => setLevel(Number(event.target.value))}
                disabled={pending}
              >
                {Array.from({ length: highestLevel }, (_, index) => index + 1).map((unlocked) => (
                  <option key={unlocked} value={unlocked}>Level {unlocked}</option>
                ))}
              </select>
            </label>
            <ActionButton
              className="link"
              onClick={() => void startGame(level)}
              disabled={pending}
            >
              Start new game
            </ActionButton>
          </div>
          {gameId === "chess" ? (
            <ChessBoard
              game={game}
              selectedSquare={selectedSquare}
              onSquareClick={chooseChessSquare}
              actionPending={pending}
              pendingSquare={null}
            />
          ) : gameId === "ludo" ? (
            <LudoBoard
              game={game}
              onRoll={() => void submitAction({ action: "roll" })}
              onMove={(tokenIndex) => void submitAction({ action: "token", token_index: tokenIndex })}
              actionPending={pending}
            />
          ) : gameId === "whot" ? (
            <WhotBoard
              game={game}
              onPlay={(cardId, chosenSuit) => void submitAction({
                action: "play_card",
                card_id: cardId,
                chosen_suit: chosenSuit,
              })}
              onDraw={() => void submitAction({ action: "draw" })}
              actionPending={pending}
            />
          ) : gameId === "golf" ? (
            <GolfScorecard {...scorecardProps} />
          ) : gameId === "polo" ? (
            <PoloScorecard {...scorecardProps} />
          ) : (
            <SnookerScorecard {...scorecardProps} />
          )}
        </>
      )}
      {error && (
        <div>
          <p className="error" role="alert">{error}</p>
          {!game && (
            <ActionButton className="link" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              Retry
            </ActionButton>
          )}
        </div>
      )}
      <p className="practice-note">Free practice against the computer. An account is required; there are no stakes.</p>
    </section>
  );
}

function PlayerProfile({ token }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);

  useEffect(() => {
    document.getElementById("player-profile")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setError("");
    api.getPlayerProfile(token)
      .then((result) => {
        if (!stopped) setProfile(result);
      })
      .catch((err) => {
        if (!stopped) setError(err.message);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [token, loadAttempt]);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.user.display_name || profile.user.username);
    setEmail(profile.user.email || "");
  }, [profile]);

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    setProfileMessage("");
    try {
      const updated = await api.updatePlayerProfile(token, displayName, email || null);
      setProfile((current) => ({
        ...current,
        user: { ...current.user, ...updated },
      }));
      setProfileMessage(
        updated.email && !updated.email_verified
          ? "Profile saved. Check your email to verify it for account recovery."
          : "Profile saved.",
      );
    } catch (saveError) {
      setProfileMessage(saveError.message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function sendVerification() {
    setSendingVerification(true);
    setProfileMessage("");
    try {
      await api.resendEmailVerification(token);
      setProfileMessage("Verification email sent. Check your inbox.");
    } catch (verificationError) {
      setProfileMessage(verificationError.message);
    } finally {
      setSendingVerification(false);
    }
  }

  return (
    <section className="workflow-section profile-section" id="player-profile">
      <div className="section-heading">
        <div>
          <p className="eyebrow">YOUR AUSPLAY ACCOUNT</p>
          <h2>Player profile</h2>
        </div>
        {profile && (
          <p className="profile-member">
            Member since {new Date(profile.user.member_since).toLocaleDateString()}
          </p>
        )}
      </div>
      {loading && <p className="login-prompt" role="status">Loading your profile...</p>}
      {error && (
        <div className="card profile-card">
          <p className="error" role="alert">Could not load your profile: {error}</p>
          <ActionButton
            className="link"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            Retry
          </ActionButton>
        </div>
      )}
      {profile && !loading && (
        <div className="card profile-card">
          <div className="profile-heading">
            <div>
              <h3>{profile.user.display_name || profile.user.username}</h3>
              <p>@{profile.user.username}</p>
              <span className="role-badge">{profile.user.role}</span>
            </div>
            <p>Your email is private. Your match history is visible on your public player profile.</p>
          </div>
          <form className="profile-edit-form" onSubmit={saveProfile}>
            <label>
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                minLength={2}
                maxLength={40}
                required
              />
            </label>
            <label>
              Recovery email (private)
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
              />
            </label>
            <div className="queue-actions">
              <ActionButton className="btn" type="submit" loading={savingProfile}>
                Save profile
              </ActionButton>
              {profile.user.email && !profile.user.email_verified && (
                <ActionButton
                  className="link"
                  type="button"
                  onClick={sendVerification}
                  loading={sendingVerification}
                >
                  Resend verification
                </ActionButton>
              )}
            </div>
            {profile.user.email && (
              <span className={profile.user.email_verified ? "profile-verified" : "profile-unverified"}>
                {profile.user.email_verified ? "Email verified" : "Email not verified"}
              </span>
            )}
            {profileMessage && <p role="status">{profileMessage}</p>}
          </form>
          <div className="profile-stats">
            {[
              ["Matches", profile.stats.played],
              ["Wins", profile.stats.wins],
              ["Draws", profile.stats.draws],
              ["Losses", profile.stats.losses],
              ["Win rate", `${profile.stats.win_rate}%`],
            ].map(([label, value]) => (
              <div className="profile-stat" key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="profile-solo-level">
            <strong>Solo Draughts</strong>
            <span>Level {profile.solo_draughts_highest_level} unlocked</span>
          </div>
          <div className="profile-game-stats">
            <h3>Results by game</h3>
            {profile.games.some((game) => game.played > 0) ? (
              <div className="grid">
                {profile.games.filter((game) => game.played > 0).map((game) => (
                  <div className="profile-game-stat" key={game.game_id}>
                    <strong>{game.name}</strong>
                    <span>{game.played} played</span>
                    <small>{game.wins} wins · {game.draws} draws · {game.losses} losses</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="login-prompt">Finish a practice match to start building your stats.</p>
            )}
          </div>
          <div className="profile-history">
            <h3>Recent matches</h3>
            {profile.recent_matches.length ? (
              <div className="profile-match-list">
                {profile.recent_matches.map((match) => (
                  <article className="profile-match" key={match.room_id}>
                    <div className="profile-match-info">
                      <strong>{match.game_name} · {match.room_name}</strong>
                      <span>
                        {match.opponents.length
                          ? `Played with ${match.opponents.join(", ")}`
                          : "No opponent recorded"}
                      </span>
                    </div>
                    <div className="profile-match-result">
                      <span className={`profile-result ${match.result}`}>{match.result}</span>
                      <time dateTime={match.completed_at}>
                        {new Date(match.completed_at).toLocaleString()}
                      </time>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="login-prompt">Your completed matches will appear here.</p>
            )}
            {profile.recent_matches.length === 20 && (
              <p className="profile-history-note">Showing your 20 most recent completed matches.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const INITIAL_GAMES = [
  { id: "ludo", name: "Ludo", players: "2-4", playable: true },
  { id: "whot", name: "Whot", players: "2-4", playable: true },
  { id: "draughts", name: "Draughts", players: "2", playable: true },
  { id: "golf", name: "Golf", players: "2-4", playable: true },
  { id: "chess", name: "Chess", players: "2", playable: true },
  { id: "polo", name: "Polo", players: "2", playable: true },
  { id: "snooker", name: "Snooker", players: "2", playable: true },
];

function PublicPlayerProfile({ username }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    api.getPublicPlayerProfile(username)
      .then((result) => {
        if (!stopped) setProfile(result);
      })
      .catch((requestError) => {
        if (!stopped) setError(requestError.message);
      });
    return () => {
      stopped = true;
    };
  }, [username]);

  return (
    <main className="public-profile">
      <a className="link" href="/">Back to AusPlay</a>
      {error && <p className="error" role="alert">{error}</p>}
      {!profile && !error && <p role="status">Loading player profile...</p>}
      {profile && (
        <section className="workflow-section profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">AUSPLAY PLAYER</p>
              <h1>{profile.user.display_name}</h1>
              <p className="profile-member">@{profile.user.username} · Member since {new Date(profile.user.member_since).toLocaleDateString()}</p>
            </div>
            <span className="role-badge">{profile.user.role}</span>
          </div>
          <div className="card profile-card">
            <div className="profile-stats">
              {[
                ["Matches", profile.stats.played],
                ["Wins", profile.stats.wins],
                ["Draws", profile.stats.draws],
                ["Losses", profile.stats.losses],
                ["Win rate", `${profile.stats.win_rate}%`],
              ].map(([label, value]) => (
                <div className="profile-stat" key={label}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <div className="profile-game-stats">
              <h3>Results by game</h3>
              {profile.games.some((game) => game.played > 0) ? (
                <div className="grid">
                  {profile.games.filter((game) => game.played > 0).map((game) => (
                    <div className="profile-game-stat" key={game.game_id}>
                      <strong>{game.name}</strong>
                      <span>{game.played} played</span>
                      <small>{game.wins} wins · {game.draws} draws · {game.losses} losses</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="login-prompt">No completed matches yet.</p>
              )}
            </div>
            <div className="profile-history">
              <h3>Recent matches</h3>
              {profile.recent_matches.map((match) => (
                <article className="profile-match" key={match.room_id}>
                  <div className="profile-match-info">
                    <strong>{match.game_name} · {match.room_name}</strong>
                    <span>{match.opponents.length ? `Played with ${match.opponents.join(", ")}` : "No opponent recorded"}</span>
                  </div>
                  <div className="profile-match-result">
                    <span className={`profile-result ${match.result}`}>{match.result}</span>
                    <time dateTime={match.completed_at}>{new Date(match.completed_at).toLocaleString()}</time>
                  </div>
                </article>
              ))}
              {!profile.recent_matches.length && <p className="login-prompt">No completed matches yet.</p>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function EmailVerificationPage({ token }) {
  const [message, setMessage] = useState("Verifying your email...");
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    api.verifyEmail(token)
      .then(() => {
        if (!stopped) setMessage("Your email is verified and can now be used for account recovery.");
      })
      .catch((verificationError) => {
        if (!stopped) setError(verificationError.message);
      });
    return () => {
      stopped = true;
    };
  }, [token]);

  return (
    <main className="card auth">
      <h2>Email verification</h2>
      {error ? <p className="error" role="alert">{error}</p> : <p role="status">{message}</p>}
      <a className="link" href="/">Return to AusPlay</a>
    </main>
  );
}

function PasswordResetPage({ token }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.completePasswordReset(token, password);
      setMessage(result.message);
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card auth" onSubmit={submit}>
      <h2>Choose a new password</h2>
      {!message ? (
        <>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <ActionButton className="btn" type="submit" loading={submitting}>
            Reset password
          </ActionButton>
        </>
      ) : (
        <>
          <p role="status">{message}</p>
          <a className="btn" href="/?login=1">Log in</a>
        </>
      )}
    </form>
  );
}

function HomeApp() {
  const [session, setSession] = useState(null); // { token, username }
  const [authReady, setAuthReady] = useState(false);
  const [mode, setMode] = useState(
    () => new URLSearchParams(window.location.search).get("login") === "1" ? "login" : null,
  ); // "signup" | "login" | null
  const [pendingPlayChoice, setPendingPlayChoice] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [games, setGames] = useState(INITIAL_GAMES);
  const [rulebooks, setRulebooks] = useState({});
  const [rooms, setRooms] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [hostApplication, setHostApplication] = useState(null);
  const [breakReminderMinutes, setBreakReminderMinutes] = useState(60);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [nextReminderSeconds, setNextReminderSeconds] = useState(60 * 60);
  const [activeGame, setActiveGame] = useState(null);
  const [boardOrientation, setBoardOrientation] = useState("portrait");
  const [soloGameOpen, setSoloGameOpen] = useState(false);
  const [soloGameId, setSoloGameId] = useState("draughts");
  const [startSoloAfterAuth, setStartSoloAfterAuth] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [notice, setNotice] = useState("");
  const [roomName, setRoomName] = useState("");
  const [gameId, setGameId] = useState("draughts");
  const [selectedGameFilter, setSelectedGameFilter] = useState(null);
  const [showSelectedGameOptions, setShowSelectedGameOptions] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [busyRoom, setBusyRoom] = useState(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [reportRoomId, setReportRoomId] = useState(null);
  const [gameActionPending, setGameActionPending] = useState(false);
  const [pendingSquare, setPendingSquare] = useState(null);
  const waitingRoomKey = session && !activeGame
    ? rooms
      .filter((room) => room.viewer_is_seated && room.game_status === "not_started")
      .map((room) => room.id)
      .sort((a, b) => a - b)
      .join(",")
    : "";

  useEffect(() => {
    api.getGames().then(setGames).catch((err) => setNotice(err.message));
  }, []);
  useEffect(() => {
    let stopped = false;
    api.getMe()
      .then((user) => {
        if (!stopped) setSession({ ...user, token: "" });
      })
      .catch((err) => {
        if (!stopped && err.status !== 401) {
          setNotice(`Could not restore your session: ${err.message}`);
        }
      })
      .finally(() => {
        if (!stopped) setAuthReady(true);
      });
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (!authReady || !pendingPlayChoice) return;
    setPendingPlayChoice(null);
    if (!session) {
      if (pendingPlayChoice.kind === "solo") setStartSoloAfterAuth(true);
      setMode("signup");
    } else if (pendingPlayChoice.kind === "solo") {
      setSoloGameId(pendingPlayChoice.gameId);
      setSoloGameOpen(true);
    } else {
      document.getElementById("practice-rooms")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [authReady, pendingPlayChoice, session]);
  useEffect(() => {
    if (soloGameOpen) {
      document.getElementById("solo-practice")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [soloGameOpen]);
  useEffect(() => {
    api.getRulebooks().then(setRulebooks).catch((err) => setNotice(err.message));
  }, []);
  useEffect(() => {
    api.getRooms(session?.token).then(setRooms).catch((err) => setNotice(err.message));
  }, [session]);
  useEffect(() => {
    if (session) {
      api.getWallet(session.token).then(setWallet).catch((err) => setNotice(err.message));
      api.getMyHostApplication(session.token)
        .then(setHostApplication)
        .catch((err) => setNotice(err.message));
    } else {
      setWallet(null);
      setHostApplication(null);
      setActiveGame(null);
    }
  }, [session]);
  useEffect(() => {
    let stopped = false;
    if (!session?.token) {
      setBreakReminderMinutes(60);
      setActiveSeconds(0);
      return () => {
        stopped = true;
      };
    }
    api.getResponsiblePlaySettings(session.token)
      .then((settings) => {
        if (!stopped) setBreakReminderMinutes(settings.break_reminder_minutes);
      })
      .catch((err) => {
        if (!stopped) setNotice(err.message);
      });
    return () => {
      stopped = true;
    };
  }, [session?.token]);
  useEffect(() => {
    if (!session?.token) return undefined;
    let elapsed = 0;
    let lastTick = Date.now();
    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === "visible") {
        elapsed += (now - lastTick) / 1000;
      }
      lastTick = now;
      setActiveSeconds(elapsed);
    };
    const timer = window.setInterval(tick, 1000);
    const updateVisibility = () => {
      lastTick = Date.now();
    };
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, [session?.token]);
  useEffect(() => {
    if (!session?.token || breakReminderMinutes === 0) {
      setNextReminderSeconds(Number.POSITIVE_INFINITY);
      return;
    }
    setNextReminderSeconds(activeSeconds + breakReminderMinutes * 60);
  }, [breakReminderMinutes, session?.token]);
  useEffect(() => {
    if (!session || activeGame?.room_id == null) return undefined;
    let stopped = false;
    let connected = false;
    let reconnectDelay = 500;
    let reconnectTimer;
    let socket;
    const roomId = activeGame.room_id;
    const refresh = async () => {
      try {
        const latest = await api.getPracticeGame(session.token, roomId);
        if (!stopped) setActiveGame(latest);
      } catch (err) {
        if (!stopped) setNotice(err.message);
      }
    };
    const scheduleReconnect = () => {
      if (stopped) return;
      reconnectTimer = window.setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    };
    const connect = () => {
      let connection;
      try {
        connection = api.connectRoomUpdates(session.token, roomId);
      } catch (err) {
        setNotice(`Live updates unavailable: ${err.message}`);
        scheduleReconnect();
        return;
      }
      socket = connection;
      connection.addEventListener("message", (event) => {
        let update;
        try {
          update = JSON.parse(event.data);
        } catch {
          if (!stopped) setNotice("Received an invalid live update.");
          return;
        }
        if (update.type === "connected") {
          connected = true;
          reconnectDelay = 500;
          void refresh();
        } else if (update.type === "game_updated") {
          void refresh();
        }
      });
      connection.addEventListener("close", () => {
        connected = false;
        scheduleReconnect();
      });
      connection.addEventListener("error", () => connection.close());
    };
    connect();
    const interval = window.setInterval(() => {
      if (!connected) void refresh();
    }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [session, activeGame?.room_id]);

  useEffect(() => {
    if (!session || activeGame || !waitingRoomKey) return undefined;
    let stopped = false;
    const roomIds = waitingRoomKey.split(",").map(Number);
    const connectedRooms = new Set();
    const sockets = new Map();
    const reconnectTimers = new Map();
    const reconnectDelays = new Map(roomIds.map((roomId) => [roomId, 500]));

    const refreshRoomsAndOpenStartedGame = async () => {
      try {
        const latestRooms = await api.getRooms(session.token);
        if (stopped) return;
        setRooms(latestRooms);
        const startedRoom = latestRooms.find(
          (room) => roomIds.includes(room.id) && room.game_status !== "not_started",
        );
        if (!startedRoom) return;
        const game = await api.getPracticeGame(session.token, startedRoom.id);
        if (!stopped) {
          setActiveGame(game);
          setSelectedSquare(null);
        }
      } catch (err) {
        if (!stopped) setNotice(err.message);
      }
    };

    const scheduleReconnect = (roomId) => {
      if (stopped) return;
      const delay = reconnectDelays.get(roomId) || 500;
      reconnectTimers.set(roomId, window.setTimeout(() => connect(roomId), delay));
      reconnectDelays.set(roomId, Math.min(delay * 2, 10000));
    };

    const connect = (roomId) => {
      let connection;
      try {
        connection = api.connectRoomUpdates(session.token, roomId);
      } catch (err) {
        setNotice(`Live updates unavailable: ${err.message}`);
        scheduleReconnect(roomId);
        return;
      }
      sockets.set(roomId, connection);
      connection.addEventListener("message", (event) => {
        let update;
        try {
          update = JSON.parse(event.data);
        } catch {
          if (!stopped) setNotice("Received an invalid live update.");
          return;
        }
        if (update.type === "connected") {
          connectedRooms.add(roomId);
          reconnectDelays.set(roomId, 500);
          void refreshRoomsAndOpenStartedGame();
        } else if (update.type === "game_updated") {
          void refreshRoomsAndOpenStartedGame();
        }
      });
      connection.addEventListener("close", () => {
        connectedRooms.delete(roomId);
        scheduleReconnect(roomId);
      });
      connection.addEventListener("error", () => connection.close());
    };

    roomIds.forEach(connect);
    const interval = window.setInterval(() => {
      if (connectedRooms.size < roomIds.length) {
        void refreshRoomsAndOpenStartedGame();
      }
    }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      reconnectTimers.forEach((timer) => window.clearTimeout(timer));
      sockets.forEach((socket) => socket.close());
    };
  }, [session, activeGame?.room_id, waitingRoomKey]);

  async function reloadRooms() {
    setRooms(await api.getRooms(session?.token));
  }

  async function openGame(room) {
    setNotice("");
    try {
      const game = await api.getPracticeGame(session.token, room.id);
      setActiveGame(game);
      setSelectedSquare(null);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function createRoom(e) {
    e.preventDefault();
    setNotice("");
    setCreatingRoom(true);
    try {
      const room = await api.createPracticeRoom(session.token, {
        game_id: gameId,
        name: roomName,
        max_players: maxPlayers,
      });
      setRoomName("");
      await reloadRooms();
      setNotice(`Practice room "${room.name}" created.`);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setCreatingRoom(false);
    }
  }

  async function joinRoom(room) {
    setBusyRoom(room.id);
    setNotice("");
    try {
      const result = await api.joinPracticeRoom(session.token, room.id);
      await reloadRooms();
      if (result.game_started) {
        await openGame(room);
      } else {
        setNotice(`You joined "${room.name}" (${result.players}/${result.max_players} players).`);
      }
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusyRoom(null);
    }
  }

  function chooseSquare(x, y) {
    if (!activeGame || !activeGame.viewer.is_turn || gameActionPending) return;
    const move = selectedSquare && activeGame.legal_moves.find(
      (candidate) =>
        candidate.from_x === selectedSquare.x &&
        candidate.from_y === selectedSquare.y &&
        candidate.to_x === x &&
        candidate.to_y === y
    );
    if (move) {
      setSelectedSquare(null);
      setPendingSquare({ x, y });
      setGameActionPending(true);
      return api.submitDraughtsMove(session.token, activeGame.room_id, move)
        .then(setActiveGame)
        .catch((err) => setNotice(err.message))
        .finally(() => {
          setPendingSquare(null);
          setGameActionPending(false);
        });
    }
    const piece = activeGame.state.board[y][x];
    const ownPiece = activeGame.viewer.side === "red"
      ? piece === "r" || piece === "R"
      : piece === "b" || piece === "B";
    const canMovePiece = activeGame.legal_moves.some(
      (candidate) => candidate.from_x === x && candidate.from_y === y
    );
    setSelectedSquare(ownPiece && canMovePiece ? { x, y } : null);
  }

  function chooseChessSquare(x, y) {
    if (!activeGame || !activeGame.viewer.is_turn || gameActionPending) return;
    const targetMoves = selectedSquare && activeGame.legal_moves.filter(
      (move) => move.from_x === selectedSquare.x
        && move.from_y === selectedSquare.y
        && move.to_x === x
        && move.to_y === y,
    );
    if (targetMoves?.length) {
      const move = targetMoves.find((candidate) => candidate.uci.endsWith("q")) || targetMoves[0];
      setSelectedSquare(null);
      setPendingSquare({ x, y });
      setGameActionPending(true);
      return api.submitChessMove(session.token, activeGame.room_id, move.uci)
        .then(setActiveGame)
        .catch((err) => setNotice(err.message))
        .finally(() => {
          setPendingSquare(null);
          setGameActionPending(false);
        });
    }

    const canMovePiece = activeGame.legal_moves.some(
      (move) => move.from_x === x && move.from_y === y,
    );
    setSelectedSquare(canMovePiece ? { x, y } : null);
  }

  async function rollLudo() {
    setGameActionPending(true);
    setNotice("");
    try {
      setActiveGame(await api.rollLudoDie(session.token, activeGame.room_id));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setGameActionPending(false);
    }
  }

  async function moveLudoToken(tokenIndex) {
    setGameActionPending(true);
    setNotice("");
    try {
      setActiveGame(await api.moveLudoToken(session.token, activeGame.room_id, tokenIndex));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setGameActionPending(false);
    }
  }

  async function submitGolfScore(strokes) {
    setGameActionPending(true);
    setNotice("");
    try {
      setActiveGame(await api.submitGolfScore(session.token, activeGame.room_id, strokes));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setGameActionPending(false);
    }
  }

  async function submitPoloScore(goals) {
    setGameActionPending(true);
    setNotice("");
    try {
      setActiveGame(await api.submitPoloScore(session.token, activeGame.room_id, goals));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setGameActionPending(false);
    }
  }

  async function submitSnookerFrameScore(breakPoints) {
    setGameActionPending(true);
    setNotice("");
    try {
      setActiveGame(await api.submitSnookerFrameScore(
        session.token,
        activeGame.room_id,
        breakPoints,
      ));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setGameActionPending(false);
    }
  }

  async function playWhotCard(cardId, chosenSuit) {
    setGameActionPending(true);
    setNotice("");
    try {
      setActiveGame(await api.playWhotCard(
        session.token,
        activeGame.room_id,
        cardId,
        chosenSuit,
      ));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setGameActionPending(false);
    }
  }

  async function drawWhotCard() {
    setGameActionPending(true);
    setNotice("");
    try {
      setActiveGame(await api.drawWhotCard(session.token, activeGame.room_id));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setGameActionPending(false);
    }
  }

  const playerOptions = ["draughts", "chess", "polo", "snooker"].includes(gameId) ? [2] : [2, 3, 4];
  const displayedRooms = selectedGameFilter
    ? rooms.filter((room) => room.game_id === selectedGameFilter)
    : rooms;
  const selectedGame = games.find((game) => game.id === selectedGameFilter);
  const activeGamePlayer = activeGame
    ? activeGame.players[activeGame.viewer.side || activeGame.viewer.color]
    : null;
  const activeGameName = activeGame
    ? games.find((game) => game.id === activeGame.game_id)?.name || activeGame.game_id
    : "";

  function selectGame(game) {
    if (!game.playable) {
      setNotice(`${game.name} is coming soon.`);
      return;
    }
    setGameId(game.id);
    setMaxPlayers(2);
    setSelectedGameFilter(game.id);
    setShowSelectedGameOptions(true);
    setNotice(
      session
        ? `${game.name} selected. Create a room or join an open room below.`
        : `Sign up or log in to play ${game.name}.`,
    );
    if (!session && authReady) {
      setMode("signup");
    }
  }

  function playSelectedGameWithOthers() {
    setShowSelectedGameOptions(false);
    if (!authReady) {
      setPendingPlayChoice({ kind: "others" });
      return;
    }
    if (!session) {
      setMode("signup");
      return;
    }
    document.getElementById("practice-rooms")?.scrollIntoView({ behavior: "smooth" });
  }

  function openSoloGame(selectedGameId) {
    setShowSelectedGameOptions(false);
    setSoloGameId(selectedGameId);
    if (!authReady) {
      setPendingPlayChoice({ kind: "solo", gameId: selectedGameId });
      return;
    }
    if (!session) {
      setStartSoloAfterAuth(true);
      setMode("signup");
      return;
    }
    setSoloGameOpen(true);
  }

  function takeBreak() {
    setActiveGame(null);
    setSelectedSquare(null);
    setNextReminderSeconds(activeSeconds + 10 * 60);
    setNotice("Game view closed for your break; you can return to the room whenever you’re ready.");
  }

  function quitSoloGame() {
    setSoloGameOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function logOut() {
    try {
      await api.logout(session?.token);
    } catch (err) {
      setNotice(`Could not log out: ${err.message}`);
      return;
    }
    setSession(null);
    setProfileOpen(false);
    setNotice("");
    setActiveGame(null);
    setSoloGameOpen(false);
    setStartSoloAfterAuth(false);
  }

  return (
    <div className={`page${showSelectedGameOptions && selectedGame ? " has-mobile-game-options" : ""}${activeGame || soloGameOpen ? " game-focus" : ""}`}>
      <nav>
        <span className="logo">Aus<b>Play</b></span>
        <div className="nav-links">
          {session ? (
            <>
              <ActionButton
                className="link username-link"
                aria-expanded={profileOpen}
                aria-controls="player-profile"
                aria-label={`View ${session.username}'s profile and game history`}
                onClick={() => setProfileOpen((open) => !open)}
              >
                {session.username}
              </ActionButton>
              <span className="role-badge">{session.role}</span>
              <ActionButton className="link" onClick={logOut}>
                Log out
              </ActionButton>
            </>
          ) : (
            <>
              <ActionButton className="link" onClick={() => setMode("login")}>Log in</ActionButton>
              <ActionButton className="btn" onClick={() => setMode("signup")}>Sign up</ActionButton>
            </>
          )}
        </div>
      </nav>

      <section className="games-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CHOOSE YOUR GAME</p>
            <h2>Games</h2>
          </div>
          <p className="section-note">Free practice rooms. No deposits or stakes.</p>
        </div>
        <div className="grid">
          {games.map((g) => (
            <div
              className={`card game-card${g.playable ? " selectable" : ""}${selectedGameFilter === g.id ? " selected" : ""}`}
              key={g.id}
              role={g.playable ? "button" : undefined}
              tabIndex={g.playable ? 0 : undefined}
              aria-pressed={g.playable ? selectedGameFilter === g.id : undefined}
              onClick={g.playable ? () => selectGame(g) : undefined}
              onKeyDown={g.playable ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectGame(g);
                }
              } : undefined}
            >
              <span className="game-mark">{g.name.slice(0, 1)}</span>
              <span className={`game-availability ${g.playable ? "ready" : ""}`}>
                {g.playable ? "Playable now" : "Coming soon"}
              </span>
              <h3>{g.name}</h3>
              <p>{g.players === "TBD" ? "Player count to be announced" : `${g.players} players`}</p>
              {g.playable && <span className="game-action">Create or join a practice room</span>}
            </div>
          ))}
        </div>
        {selectedGame && showSelectedGameOptions && (
          <div className="selected-game-options">
            <div>
              <p className="eyebrow">PLAY {selectedGame.name.toUpperCase()}</p>
              <p>Choose how you want to play this game.</p>
            </div>
            <div className="selected-game-buttons">
              <ActionButton className="btn" onClick={playSelectedGameWithOthers}>
                Play with others
              </ActionButton>
              <ActionButton className="btn" onClick={() => openSoloGame(selectedGame.id)}>
                Play {selectedGame.name} solo vs computer
              </ActionButton>
            </div>
          </div>
        )}
      </section>

      {session && soloGameOpen && (
        soloGameId === "draughts" ? (
          <SoloDraughts
            token={session.token}
            username={session.username}
            displayName={session.display_name}
            orientation={boardOrientation}
            onOrientationChange={setBoardOrientation}
            onClose={quitSoloGame}
          />
        ) : (
          <SoloGame
            token={session.token}
            gameId={soloGameId}
            orientation={boardOrientation}
            onOrientationChange={setBoardOrientation}
            onClose={quitSoloGame}
          />
        )
      )}

      {mode && !session ? (
        <AuthForm
          mode={mode}
          onDone={(s) => {
            setSession({ ...s, role: s.role || "player" });
            setMode(null);
            if (s.email_verified === false) {
              setNotice("Verify your email in your profile to enable account recovery.");
            }
            if (startSoloAfterAuth) {
              setStartSoloAfterAuth(false);
              setSoloGameOpen(true);
            }
          }}
          onModeChange={setMode}
        />
      ) : (
        <header className="hero">
          <p className="eyebrow">PLAY FAIR. PLAY TOGETHER.</p>
          <h1>Find your next<br />friendly challenge.</h1>
          <p>Discover games, meet your players, and practise together.</p>
          {!session && <ActionButton className="btn big" onClick={() => setMode("signup")}>Create free account</ActionButton>}
          {session && wallet && (
            <p className="wallet">Wallet: NGN {(wallet.available_kobo / 100).toLocaleString()}</p>
          )}
        </header>
      )}

      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}

      {session && profileOpen && <PlayerProfile token={session.token} />}

      {session && (
        <ResponsiblePlaySettings
          token={session.token}
          reminderMinutes={breakReminderMinutes}
          onReminderChange={setBreakReminderMinutes}
          onNotice={setNotice}
        />
      )}
      {session && breakReminderMinutes > 0 && activeSeconds >= nextReminderSeconds && (
        <div className="break-reminder" role="alert">
          <strong>Time for a break?</strong>
          <p>You’ve been playing for a while. A short break is always okay.</p>
          <div className="queue-actions">
            <ActionButton className="btn" onClick={takeBreak}>Close game view and take a break</ActionButton>
            <ActionButton
              className="link"
              onClick={() => setNextReminderSeconds(activeSeconds + 15 * 60)}
            >
              Remind me in 15 minutes
            </ActionButton>
          </div>
        </div>
      )}

      {session && session.role !== "admin" && (
        <HostWorkspace
          session={session}
          application={hostApplication}
          onApplicationChange={setHostApplication}
          onRoleChange={setSession}
          onNotice={setNotice}
        />
      )}
      {session?.role === "admin" && (
        <AdminWorkspace
          session={session}
          onRulebooksChange={setRulebooks}
          onNotice={setNotice}
        />
      )}

      <section className="rooms-section" id="practice-rooms">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PLAY WITH OTHERS</p>
            <h2>Practice rooms</h2>
          </div>
          <div className="room-actions">
            <p className="section-note">Join an open room or start one for your group.</p>
            <ActionButton className="link" onClick={() => reloadRooms().catch((err) => setNotice(err.message))}>
              Refresh rooms
            </ActionButton>
            {selectedGameFilter && (
              <ActionButton
                className="link"
                onClick={() => {
                  setSelectedGameFilter(null);
                  setShowSelectedGameOptions(false);
                }}
              >
                Show all games
              </ActionButton>
            )}
          </div>
        </div>
        {session ? (
          <form className="card room-form" onSubmit={createRoom}>
            <h3>Create a practice room</h3>
            <label>
              Room name
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                minLength={3}
                maxLength={40}
                placeholder="Friday night game"
                required
              />
            </label>
            <label>
              Game
              <select value={gameId} onChange={(e) => {
                setGameId(e.target.value);
                setMaxPlayers(2);
                setSelectedGameFilter(e.target.value);
                setShowSelectedGameOptions(true);
              }}>
                {games.filter((game) => game.playable).map((game) => (
                  <option key={game.id} value={game.id}>{game.name}</option>
                ))}
              </select>
            </label>
            <label>
              Players
              <select value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))}>
                {playerOptions.map((count) => <option key={count} value={count}>{count} players</option>)}
              </select>
            </label>
            <ActionButton className="btn" type="submit" loading={creatingRoom}>
              {creatingRoom ? "Creating..." : "Create room"}
            </ActionButton>
          </form>
        ) : (
          <p className="login-prompt">Log in or sign up to create a practice room and join other players.</p>
        )}
        {displayedRooms.length ? (
          <div className="grid room-grid">
            {displayedRooms.map((room) => (
              <div className="card room-card" key={room.id}>
                <div className="room-card-heading">
                  <h3>{room.name}</h3>
                  <span className={`room-status ${room.status}`}>{room.status}</span>
                </div>
                <p>
                  {games.find((game) => game.id === room.game_id)?.name || room.game_id}
                  {" · Hosted by "}
                  <PlayerProfileLink username={room.host} />
                </p>
                <p>{room.players}/{room.max_players} players</p>
                <p className="room-rules">
                  <strong>{rulebooks[room.game_id]?.title || "Game rules"}</strong>
                  {" · "}
                  {rulebooks[room.game_id]?.content || "See the game rules."}
                </p>
                {session && room.viewer_is_seated && (
                  room.game_status === "active" || room.game_status === "finished"
                ) && (
                  <ActionButton className="btn room-join" onClick={() => openGame(room)}>
                    {room.game_status === "active" ? "Open game" : "View result"}
                  </ActionButton>
                )}
                {session && room.status === "open" && !room.viewer_is_seated && (
                  <ActionButton
                    className="btn room-join"
                    onClick={() => joinRoom(room)}
                    disabled={busyRoom === room.id}
                  >
                    {busyRoom === room.id ? "Joining..." : "Join room"}
                  </ActionButton>
                )}
                {session && room.status === "open" && room.viewer_is_seated && (
                  <p className="room-unavailable">You're in - waiting for other players.</p>
                )}
                {room.game_status === "not_started" && room.status === "full" && (
                  <p className="room-unavailable">This game is not playable yet.</p>
                )}
                {session && (
                  <>
                    <ActionButton
                      className="link report-toggle"
                      onClick={() => setReportRoomId(reportRoomId === room.id ? null : room.id)}
                    >
                      {reportRoomId === room.id ? "Cancel report" : "Report room"}
                    </ActionButton>
                    {reportRoomId === room.id && (
                      <RoomReportForm
                        token={session.token}
                        roomId={room.id}
                        onCancel={() => setReportRoomId(null)}
                        onSubmitted={() => setReportRoomId(null)}
                        onNotice={setNotice}
                      />
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            {selectedGame
              ? `No ${selectedGame.name} rooms yet. Create one above and invite your friends.`
              : "No practice rooms yet. Start one and invite your friends."}
          </p>
        )}
      </section>

      {activeGame && (
        <section
          className={`game-section orientation-${boardOrientation}`}
          aria-label={`${activeGameName} game`}
        >
          <div className="game-toolbar">
            <div>
              <p className="eyebrow">FREE PRACTICE MATCH</p>
              <h2>{activeGameName}</h2>
            </div>
            <ActionButton className="link" onClick={() => {
              setActiveGame(null);
              setSelectedSquare(null);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}>
              Quit game
            </ActionButton>
            <GameOrientationToggle
              orientation={boardOrientation}
              onChange={setBoardOrientation}
            />
          </div>
          {activeGame.game_id === "snooker" ? (
            <SnookerScorecard
              game={activeGame}
              onSubmitScore={submitSnookerFrameScore}
              actionPending={gameActionPending}
            />
          ) : activeGame.game_id === "polo" ? (
            <PoloScorecard
              game={activeGame}
              onSubmitScore={submitPoloScore}
              actionPending={gameActionPending}
            />
          ) : activeGame.game_id === "golf" ? (
            <GolfScorecard
              game={activeGame}
              onSubmitScore={submitGolfScore}
              actionPending={gameActionPending}
            />
          ) : activeGame.game_id === "chess" ? (
            <ChessBoard
              game={activeGame}
              selectedSquare={selectedSquare}
              onSquareClick={chooseChessSquare}
              actionPending={gameActionPending}
              pendingSquare={pendingSquare}
            />
          ) : activeGame.game_id === "ludo" ? (
            <LudoBoard
              game={activeGame}
              onRoll={rollLudo}
              onMove={moveLudoToken}
              actionPending={gameActionPending}
            />
          ) : activeGame.game_id === "whot" ? (
            <WhotBoard
              game={activeGame}
              onPlay={playWhotCard}
              onDraw={drawWhotCard}
              actionPending={gameActionPending}
            />
          ) : (
          <div className="game-layout">
            <div className="board-with-players">
              <BoardPlayerLabel
                name={activeGame.player_display_names?.black || activeGame.players.black}
                username={activeGame.players.black}
                side="Black"
                isTurn={activeGame.state.turn_user_id === activeGame.state.black_player_id}
                gameActive={activeGame.state.status === "active"}
              />
              <div className="draughts-board" aria-label="Draughts board">
                {activeGame.state.board.flatMap((row, y) =>
                  row.map((piece, x) => {
                    const isSelected = selectedSquare?.x === x && selectedSquare?.y === y;
                    const isTarget = selectedSquare && activeGame.legal_moves.some(
                      (move) =>
                        move.from_x === selectedSquare.x &&
                        move.from_y === selectedSquare.y &&
                        move.to_x === x &&
                        move.to_y === y
                    );
                    const shade = (x + y) % 2 === 1 ? "dark" : "light";
                    return (
                      <ActionButton
                        className={`square ${shade}${isSelected ? " selected" : ""}${isTarget ? " target" : ""}`}
                        key={`${x}-${y}`}
                        aria-label={`${piece === "." ? "Empty" : piece === "r" || piece === "R" ? "Red" : "Black"} square ${x + 1}, ${y + 1}`}
                        onClick={() => chooseSquare(x, y)}
                        loading={pendingSquare?.x === x && pendingSquare?.y === y}
                        disabled={gameActionPending || !activeGame.viewer.is_turn || activeGame.status !== "active"}
                      >
                        {piece !== "." && (
                          <span className={`piece ${piece.toLowerCase() === "r" ? "red-piece" : "black-piece"}${piece === "R" || piece === "B" ? " king" : ""}`}>
                            {piece === "R" || piece === "B" ? "K" : ""}
                          </span>
                        )}
                      </ActionButton>
                    );
                  })
                )}
              </div>
              <BoardPlayerLabel
                name={activeGame.player_display_names?.red || activeGame.players.red}
                username={activeGame.players.red}
                side="Red"
                isTurn={activeGame.state.turn_user_id === activeGame.state.red_player_id}
                gameActive={activeGame.state.status === "active"}
              />
            </div>
            <div className="game-info card">
              <p>You are <strong>{activeGamePlayer}</strong> ({activeGame.viewer.side}).</p>
              <p>
                {activeGame.status === "finished"
                  ? activeGame.state.winner_user_id === activeGame.viewer.user_id
                    ? "You won!"
                    : "Match finished."
                  : activeGame.viewer.is_turn
                    ? "Your turn. Select one of your highlighted pieces, then a destination."
                    : `Waiting for ${activeGame.players[activeGame.state.turn_user_id === activeGame.state.red_player_id ? "red" : "black"]} to move.`}
              </p>
              <p>Red: {activeGame.players.red} · Black: {activeGame.players.black}</p>
              <p className="practice-note">Practice only. No stakes or prizes.</p>
            </div>
          </div>
          )}
          <PracticeRoomChat
            key={activeGame.room_id}
            token={session.token}
            roomId={activeGame.room_id}
            username={session.username}
          />
          {activeGame.status === "finished" && (
            <GameDisputePanel
              token={session.token}
              roomId={activeGame.room_id}
              onNotice={setNotice}
            />
          )}
        </section>
      )}

      <footer>
        AusPlay by Aus Tech Limited · Adults 18+ only. This MVP offers free practice rooms only;
        Chess uses standard server-validated rules. Draughts uses forward-moving men, short kings,
        and mandatory captures. Golf is a self-reported nine-hole scorecard match. Ludo uses
        server-rolled dice, exact finishing rolls, and safe squares. Polo uses a self-reported
        four-chukka scorecard; Snooker uses self-reported frame scores. Whot uses a simple documented
        baseline ruleset. Real-money play, deposits, and prizes are not available.
      </footer>
    </div>
  );
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const verificationToken = params.get("verify_email");
  const resetToken = params.get("reset_password");
  const playerUsername = params.get("player");

  if (verificationToken) return <EmailVerificationPage token={verificationToken} />;
  if (resetToken) return <PasswordResetPage token={resetToken} />;
  if (playerUsername) return <PublicPlayerProfile username={playerUsername} />;
  return <HomeApp />;
}
