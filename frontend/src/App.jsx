import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import { verifyLudoProof } from "./fairness";
import {
  applySoloDraughtsMove,
  chooseComputerMove,
  createSoloDraughtsGame,
  legalSoloDraughtsMoves,
} from "./soloDraughts";
import { findDirectionalTarget, getGamepadDirection } from "./gamepadNavigation";
import { mergeGameCatalogue } from "./gameCatalogue";
import { filterRooms, getRoomAvailability, uniqueRooms } from "./roomDiscovery";

const formatNaira = (kobo = 0) => new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
}).format(kobo / 100);

function nairaToKobo(amount) {
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : NaN;
}

function createRequestKey() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const GAME_ARTWORK = {
  chess: "/game-art/chess.svg",
  draughts: "/game-art/draughts.svg",
  golf: "/game-art/golf.svg",
  ludo: "/game-art/ludo.svg",
  polo: "/game-art/polo.svg",
  ps5: "/game-art/ps5.svg",
  snooker: "/game-art/snooker.svg",
  whot: "/game-art/whot.svg",
};

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

function ControllerNavigation() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (typeof navigator.getGamepads !== "function") return undefined;

    let animationFrame = null;
    let gamepadIndex = null;
    let lastDirectionTime = 0;
    let selectWasPressed = false;

    function focusables() {
      return Array.from(document.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      )).filter((element) => {
        if (element.getAttribute("aria-disabled") === "true" || element.closest('[aria-hidden="true"]')) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
    }

    function moveFocus(direction) {
      const available = focusables();
      const target = findDirectionalTarget(document.activeElement, available, direction);
      target?.focus();
    }

    function poll() {
      animationFrame = null;
      const gamepads = Array.from(navigator.getGamepads() || []);
      const selectedPad = gamepadIndex === null ? null : gamepads[gamepadIndex];
      const gamepad = selectedPad?.connected
        ? selectedPad
        : gamepads.find((pad) => pad?.connected);

      if (!gamepad) {
        gamepadIndex = null;
        selectWasPressed = false;
        setConnected(false);
        return;
      }

      gamepadIndex = gamepad.index;
      const now = performance.now();
      const direction = getGamepadDirection(gamepad);
      if (direction && now - lastDirectionTime >= 200) {
        moveFocus(direction);
        lastDirectionTime = now;
      }

      const selectPressed = Boolean(gamepad.buttons[0]?.pressed);
      if (selectPressed && !selectWasPressed) {
        const activeElement = document.activeElement;
        if (activeElement !== document.body && typeof activeElement.click === "function") {
          activeElement.click();
        } else {
          focusables()[0]?.focus();
        }
      }
      selectWasPressed = selectPressed;
      animationFrame = window.requestAnimationFrame(poll);
    }

    function startPolling(gamepad) {
      gamepadIndex = gamepad.index;
      setConnected(true);
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(poll);
    }

    function onConnected(event) {
      startPolling(event.gamepad);
    }

    function onDisconnected(event) {
      if (event.gamepad.index !== gamepadIndex) return;
      const remainingPad = Array.from(navigator.getGamepads() || [])
        .find((pad) => pad?.connected);
      if (remainingPad) {
        startPolling(remainingPad);
        return;
      }
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
      gamepadIndex = null;
      selectWasPressed = false;
      setConnected(false);
    }

    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);
    const connectedPad = Array.from(navigator.getGamepads() || [])
      .find((pad) => pad?.connected);
    if (connectedPad) startPolling(connectedPad);

    return () => {
      window.removeEventListener("gamepadconnected", onConnected);
      window.removeEventListener("gamepaddisconnected", onDisconnected);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  if (!connected) return null;
  return (
    <div className="gamepad-help" role="status" aria-live="polite">
      Controller connected · D-pad/stick to move · ✕ / A to select
    </div>
  );
}

function AuthForm({ mode, onDone, onModeChange }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
        ? await api.register(username, password, ageConfirmed)
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
  applicationLoading,
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
      {session.role !== "host" && applicationLoading ? (
        <div className="card workflow-card">
          <p role="status">Loading your Host application status...</p>
        </div>
      ) : session.role === "host" ? (
        <div className="card workflow-card">
          <p className="eyebrow">HOST WORKSPACE</p>
          <h2>Rulebook studio</h2>
          <p className="practice-note">
            Community Hosts can propose rulebook text for administrator review. Approved text
            updates published instructions only; game mechanics remain server-enforced.
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
          <h2>Become an AusPlay Community Host</h2>
          <p className="host-intro">
            Signed-in players can apply. Hosts can propose game-rule updates for administrator
            review; approval does not change how games are enforced.
          </p>
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
  const [walletTopups, setWalletTopups] = useState([]);
  const [walletWithdrawals, setWalletWithdrawals] = useState([]);
  const [topup, setTopup] = useState({
    username: "",
    amount: "",
    reference: "",
    reason: "",
  });
  const [withdrawalOtps, setWithdrawalOtps] = useState({});

  async function refreshQueues() {
    const [
      hostApplications,
      ruleProposals,
      moderationReports,
      gameDisputes,
      recentTopups,
      pendingWithdrawals,
    ] = await Promise.all([
      api.getAdminHostApplications(session.token),
      api.getAdminRuleProposals(session.token),
      api.getAdminReports(session.token),
      api.getAdminDisputes(session.token),
      api.getAdminWalletTopups(session.token),
      api.getAdminWalletWithdrawals(session.token),
    ]);
    setApplications(hostApplications);
    setProposals(ruleProposals);
    setReports(moderationReports);
    setDisputes(gameDisputes);
    setWalletTopups(recentTopups);
    setWalletWithdrawals(pendingWithdrawals);
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

  async function submitTopup(event) {
    event.preventDefault();
    const amountKobo = nairaToKobo(topup.amount);
    if (!Number.isInteger(amountKobo) || amountKobo < 100) {
      onNotice("Enter a top-up amount of at least NGN 1.00.");
      return;
    }
    try {
      await api.createAdminWalletTopup(session.token, {
        username: topup.username.trim(),
        amount_kobo: amountKobo,
        reference: topup.reference.trim(),
        reason: topup.reason.trim(),
      });
      setTopup({ username: "", amount: "", reference: "", reason: "" });
      await refreshQueues();
      onNotice("Wallet top-up recorded.");
    } catch (error) {
      onNotice(error.message);
    }
  }

  async function finalizeWithdrawal(withdrawalId) {
    const otp = withdrawalOtps[withdrawalId]?.trim();
    if (!otp) {
      onNotice("Enter the Paystack transfer OTP.");
      return;
    }
    try {
      await api.finalizeWalletWithdrawal(session.token, withdrawalId, otp);
      setWithdrawalOtps((current) => ({ ...current, [withdrawalId]: "" }));
      await refreshQueues();
      onNotice("Paystack transfer confirmation submitted.");
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
        <form className="card workflow-card" onSubmit={submitTopup}>
          <h3>Top up a player wallet</h3>
          <p>Only credit a wallet after you have verified the off-platform funding.</p>
          <label>
            Player username
            <input
              minLength="3"
              maxLength="32"
              required
              value={topup.username}
              onChange={(event) => setTopup({ ...topup, username: event.target.value })}
            />
          </label>
          <label>
            Amount (NGN)
            <input
              type="number"
              min="1"
              step="0.01"
              required
              value={topup.amount}
              onChange={(event) => setTopup({ ...topup, amount: event.target.value })}
            />
          </label>
          <label>
            Funding reference
            <input
              minLength="6"
              maxLength="80"
              required
              value={topup.reference}
              onChange={(event) => setTopup({ ...topup, reference: event.target.value })}
            />
          </label>
          <label>
            Audit reason
            <input
              minLength="10"
              maxLength="240"
              required
              value={topup.reason}
              onChange={(event) => setTopup({ ...topup, reason: event.target.value })}
            />
          </label>
          <ActionButton className="btn" type="submit">Record top-up</ActionButton>
          <h4>Recent top-ups</h4>
          {walletTopups.length ? walletTopups.slice(0, 8).map((item) => (
            <article className="queue-item" key={item.reference}>
              <strong>{item.username} · {formatNaira(item.amount_kobo)}</strong>
              <p>{item.reference} · {item.reason}</p>
            </article>
          )) : <p>No wallet top-ups recorded.</p>}
        </form>
        <div className="card workflow-card">
          <h3>Pending Paystack withdrawals ({walletWithdrawals.length})</h3>
          {walletWithdrawals.length ? walletWithdrawals.map((item) => (
            <article className="queue-item" key={item.id}>
              <strong>{item.username} · {formatNaira(item.amount_kobo)}</strong>
              <p>{item.reference} · {item.status_detail || item.status}</p>
              {item.transfer_code && (
                <label>
                  Paystack transfer OTP
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={withdrawalOtps[item.id] || ""}
                    onChange={(event) => setWithdrawalOtps((current) => ({
                      ...current,
                      [item.id]: event.target.value,
                    }))}
                  />
                </label>
              )}
              {item.transfer_code && (
                <ActionButton className="btn" onClick={() => finalizeWithdrawal(item.id)}>
                  Confirm transfer
                </ActionButton>
              )}
            </article>
          )) : <p>No withdrawals are waiting for transfer approval.</p>}
        </div>
      </div>
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
        {game.fairness?.available && (
          <details className="fairness-info">
            <summary>Roll fairness</summary>
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
            ) : game.solo ? null : (
              <p>Seed reveal is available after the match is finished.</p>
            )}
          </details>
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

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      className="confirm-dialog"
      ref={dialogRef}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirm-dialog-title">{title}</h2>
      <p id="confirm-dialog-message">{message}</p>
      <div className="confirm-dialog-actions">
        <button className="link" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn" type="button" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

function GameActionIcon({ action }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {action === "help" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.7 9a2.4 2.4 0 1 1 4.1 1.7c-1 .9-1.8 1.2-1.8 2.8" />
          <path d="M12 17h.01" />
        </>
      ) : action === "rotate" ? (
        <>
          <path d="M3 12a9 9 0 0 1 15-6l2 2M20 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6l-2-2M4 21v-5h5" />
        </>
      ) : action === "quit" ? (
        <>
          <path d="M10 17l5-5-5-5M15 12H3" />
          <path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" />
        </>
      ) : (
        <>
          <path d="M20 11a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v5h-5" />
        </>
      )}
    </svg>
  );
}

function NavigationIcon({ name }) {
  const paths = {
    home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z" />,
    games: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
    play: <path d="M8 5.5v13l10-6.5-10-6.5Z" />,
    predict: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M22 12h-3M12 22v-3M2 12h3" /></>,
    profile: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  };
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function VirtualGamesWorkspace({ session, games, onLogin }) {
  const [data, setData] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [outcomeKey, setOutcomeKey] = useState("");
  const [stake, setStake] = useState("10");
  const [saving, setSaving] = useState(false);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [banks, setBanks] = useState([]);
  const [withdrawal, setWithdrawal] = useState({
    amount: "",
    account_name: "",
    account_number: "",
    bank_code: "",
  });
  const [withdrawing, setWithdrawing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const draftRoundId = useRef(null);

  useEffect(() => {
    if (!session) {
      setData(null);
      setWallet(null);
      setLoading(false);
      setError("");
      draftRoundId.current = null;
      return undefined;
    }

    let stopped = false;
    let refreshing = false;
    const refresh = async (silent = false) => {
      if (refreshing) return;
      refreshing = true;
      if (!silent) setLoading(true);
      try {
        const latest = await api.getVirtualGames(session.token);
        if (!stopped) {
          setData(latest);
          setWallet((current) => ({
            ...current,
            currency: "NGN",
            available_kobo: latest.available_kobo,
            locked_kobo: latest.locked_kobo,
          }));
          setError("");
          const currentRoundId = latest.active_round?.id ?? null;
          if (currentRoundId !== draftRoundId.current) {
            draftRoundId.current = currentRoundId;
            setOutcomeKey(latest.active_round?.my_bet?.outcome_key || "");
            setStake(
              latest.active_round?.my_bet
                ? (latest.active_round.my_bet.stake_kobo / 100).toFixed(2)
                : "10",
            );
          }
        }
      } catch (requestError) {
        if (!stopped) setError(requestError.message);
      } finally {
        refreshing = false;
        if (!stopped && !silent) setLoading(false);
      }
    };

    void refresh();
    api.getWallet(session.token)
      .then((latestWallet) => {
        if (!stopped) setWallet(latestWallet);
      })
      .catch((requestError) => {
        if (!stopped) setError(requestError.message);
      });
    const refreshTimer = window.setInterval(() => void refresh(true), 5000);
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      stopped = true;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [session?.token]);

  async function saveBet(round) {
    const stakeKobo = nairaToKobo(stake);
    if (!outcomeKey) {
      setError("Choose an outcome before placing your prediction.");
      return;
    }
    if (!Number.isInteger(stakeKobo) || stakeKobo < 100 || stakeKobo > data.available_kobo) {
      setError("Enter a stake of at least NGN 1.00 within your available balance.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.placeVirtualBet(session.token, round.id, {
        outcome_key: outcomeKey,
        stake_kobo: stakeKobo,
      });
      setMessage("Your prediction is saved. It will lock when the timer ends.");
      const [latest, latestWallet] = await Promise.all([
        api.getVirtualGames(session.token),
        api.getWallet(session.token),
      ]);
      setData(latest);
      setWallet(latestWallet);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function openWithdrawalForm() {
    setError("");
    setWithdrawalOpen(true);
    if (banks.length) return;
    try {
      const availableBanks = await api.getPaystackBanks(session.token);
      setBanks(availableBanks);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submitWithdrawal(event) {
    event.preventDefault();
    const amountKobo = nairaToKobo(withdrawal.amount);
    if (!Number.isInteger(amountKobo) || amountKobo < 10000) {
      setError("The minimum withdrawal is NGN 100.00.");
      return;
    }
    if (amountKobo > (wallet?.available_kobo ?? 0)) {
      setError("Your available NGN balance is too low for that withdrawal.");
      return;
    }
    setWithdrawing(true);
    setError("");
    setMessage("");
    try {
      const result = await api.requestWalletWithdrawal(session.token, {
        amount_kobo: amountKobo,
        account_name: withdrawal.account_name.trim(),
        account_number: withdrawal.account_number,
        bank_code: withdrawal.bank_code,
        request_key: createRequestKey(),
      });
      setMessage(`Withdrawal ${result.status}: ${formatNaira(result.amount_kobo)}.`);
      setWithdrawalOpen(false);
      setWithdrawal({ amount: "", account_name: "", account_number: "", bank_code: "" });
      const [latest, latestWallet] = await Promise.all([
        api.getVirtualGames(session.token),
        api.getWallet(session.token),
      ]);
      setData(latest);
      setWallet(latestWallet);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWithdrawing(false);
    }
  }

  const gameNames = Object.fromEntries(games.map((game) => [game.id, game.name]));
  const round = data?.active_round;
  const secondsRemaining = round
    ? Math.max(0, Math.ceil((new Date(round.closes_at).getTime() - clock) / 1000))
    : 0;

  return (
    <section className="predictions-section" id="predictions">
      <div className="section-heading">
        <div>
          <p className="eyebrow">VIRTUAL GAME ROUNDS</p>
          <h2>Predict a past match</h2>
        </div>
        <p className="section-note">Completed AusPlay matches, replayed as a timed simulation.</p>
      </div>
      {!session ? (
        <div className="card prediction-empty">
          <p>Sign in to view your NGN wallet and play eligible historical prediction rounds.</p>
          <ActionButton className="btn" onClick={onLogin}>Log in or sign up</ActionButton>
        </div>
      ) : (
        <>
          <div className="prediction-summary">
            <div className="prediction-points">
              <span>Available balance</span>
              <strong>{formatNaira(wallet?.available_kobo)}</strong>
            </div>
            <div className="prediction-points">
              <span>In play</span>
              <strong>{formatNaira(wallet?.locked_kobo)}</strong>
            </div>
            <p>NGN funds are held in a platform wallet. Predictions require at least 10 completed matches for the same game and player count.</p>
            <ActionButton className="btn" onClick={openWithdrawalForm}>
              Withdraw to bank
            </ActionButton>
            <ActionButton
              className="link"
              onClick={async () => {
                try {
                  const [latest, latestWallet] = await Promise.all([
                    api.getVirtualGames(session.token),
                    api.getWallet(session.token),
                  ]);
                  setData(latest);
                  setWallet(latestWallet);
                } catch (requestError) {
                  setError(requestError.message);
                }
              }}
              disabled={loading}
            >
              Refresh
            </ActionButton>
          </div>
          {withdrawalOpen && (
            <form className="card wallet-withdrawal-form" onSubmit={submitWithdrawal}>
              <h3>Withdraw to a Nigerian bank</h3>
              <p>Paystack processes the transfer. Your balance is reserved while it is pending.</p>
              <label>
                Amount (NGN)
                <input
                  type="number"
                  min="100"
                  step="0.01"
                  max={(wallet?.available_kobo ?? 0) / 100}
                  required
                  value={withdrawal.amount}
                  onChange={(event) => setWithdrawal({ ...withdrawal, amount: event.target.value })}
                />
              </label>
              <label>
                Account holder name
                <input
                  autoComplete="name"
                  maxLength="120"
                  required
                  value={withdrawal.account_name}
                  onChange={(event) => setWithdrawal({ ...withdrawal, account_name: event.target.value })}
                />
              </label>
              <label>
                Account number
                <input
                  inputMode="numeric"
                  pattern="[0-9]{10}"
                  maxLength="10"
                  required
                  value={withdrawal.account_number}
                  onChange={(event) => setWithdrawal({ ...withdrawal, account_number: event.target.value })}
                />
              </label>
              <label>
                Bank
                <select
                  required
                  value={withdrawal.bank_code}
                  onChange={(event) => setWithdrawal({ ...withdrawal, bank_code: event.target.value })}
                >
                  <option value="">Select a bank</option>
                  {banks.map((bank) => (
                    <option key={bank.code} value={bank.code}>{bank.name}</option>
                  ))}
                </select>
              </label>
              <div className="queue-actions">
                <ActionButton className="btn" type="submit" loading={withdrawing}>
                  Request withdrawal
                </ActionButton>
                <ActionButton className="link" onClick={() => setWithdrawalOpen(false)}>
                  Cancel
                </ActionButton>
              </div>
            </form>
          )}
          {wallet?.withdrawals?.length > 0 && (
            <div className="prediction-history">
              <h3>Recent withdrawals</h3>
              <div className="prediction-history-list">
                {wallet.withdrawals.map((item) => (
                  <article className="prediction-history-item" key={item.id}>
                    <div>
                      <strong>{formatNaira(item.amount_kobo)} · {item.status}</strong>
                      <span>{item.reference}</span>
                      {item.status_detail && <span>{item.status_detail}</span>}
                    </div>
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                  </article>
                ))}
              </div>
            </div>
          )}
          {error && <p className="error prediction-feedback" role="alert">{error}</p>}
          {message && <p className="success prediction-feedback" role="status">{message}</p>}
          {loading && !data ? (
            <p className="login-prompt" role="status">Loading virtual game...</p>
          ) : round ? (
            <article className="card prediction-card">
              <div className="prediction-card-heading">
                <div>
                  <span className="prediction-game">
                    {gameNames[round.game_id] || round.game_id}
                  </span>
                  <h3>{round.is_demo ? "Demo prediction round" : "Historical match prediction"}</h3>
                </div>
                <div
                  className="prediction-timer"
                  aria-label={`${secondsRemaining} seconds remaining in this round`}
                >
                  <span>{secondsRemaining}s</span>
                  <small>{round.my_bet ? "Round closes in" : "Betting closes in"}</small>
                </div>
              </div>
              <p className="prediction-lock-note">
                {round.is_demo
                  ? "DEMO ONLY — this sample result is not a recorded match. No NGN stakes or payouts are available."
                  : `This result is from a completed match. Player labels are anonymous; this is not live play. ${round.sample_size} completed matches are in the same game and player-count pool.`}
              </p>
              <fieldset>
                <legend>{round.is_demo ? "Sample outcomes" : "Choose an outcome"}</legend>
                {round.options.map((option) => (
                  round.is_demo ? (
                    <div className="prediction-option" key={option.key}>
                      <span>{option.label}</span>
                      <strong>Demo</strong>
                    </div>
                  ) : (
                    <label
                      className={`prediction-option${outcomeKey === option.key ? " selected" : ""}`}
                      key={option.key}
                    >
                      <input
                        type="radio"
                        name={`virtual-round-${round.id}`}
                        value={option.key}
                        checked={outcomeKey === option.key}
                        onChange={() => setOutcomeKey(option.key)}
                      />
                      <span>{option.label}</span>
                      <strong>
                        {option.historical_odds_milli
                          ? `${(100000 / option.historical_odds_milli).toFixed(1)}% historical`
                          : "No history"}
                      </strong>
                    </label>
                  )
                ))}
              </fieldset>
              {!round.is_demo && (
                <>
                  <label className="prediction-stake">
                    Stake (NGN)
                    <input
                      type="number"
                      min="1"
                      max={(data.available_kobo + (round.my_bet?.stake_kobo || 0)) / 100}
                      step="0.01"
                      value={stake}
                      onChange={(event) => setStake(event.target.value)}
                    />
                  </label>
                  <p className="prediction-lock-note">
                    Winners share the losing stakes proportionally. The platform retains 10% of losing stakes; returns are pooled and are not fixed odds.
                  </p>
                  <ActionButton
                    className="btn prediction-submit"
                    onClick={() => saveBet(round)}
                    disabled={saving || secondsRemaining === 0 || !outcomeKey}
                    loading={saving}
                  >
                    {round.my_bet ? "Update prediction" : "Place prediction"}
                  </ActionButton>
                </>
              )}
            </article>
          ) : data && !error ? (
            <p className="empty-state">
              No unused completed matches are available for a virtual round yet.
            </p>
          ) : null}
          {data?.recent_bets.length > 0 && (
            <div className="prediction-history">
              <h3>Your recent virtual bets</h3>
              <div className="prediction-history-list">
                {data.recent_bets.map((bet) => (
                  <article className="prediction-history-item" key={bet.round_id}>
                    <div>
                      <strong>{gameNames[bet.game_id] || bet.game_id}: {bet.is_demo ? "demo round" : "historical prediction"}</strong>
                      <span>Your pick: {bet.outcome}</span>
                      {bet.result && <span>Past result: {bet.result}</span>}
                    </div>
                    <div className={`prediction-result ${bet.status}`}>
                      <span>{bet.status === "pending"
                        ? "Awaiting reveal"
                        : bet.status === "won" ? "Won" : bet.status === "refunded" ? "Refunded" : "Not this time"}</span>
                      {bet.status !== "pending" && (
                        <strong>{bet.status === "won"
                          ? `+${formatNaira(bet.payout_kobo - bet.stake_kobo)}`
                          : bet.status === "refunded"
                            ? formatNaira(bet.payout_kobo)
                            : `-${formatNaira(bet.stake_kobo)}`}</strong>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          {data?.recent_rounds.length > 0 && (
            <div className="prediction-history">
              <h3>Recently revealed rounds</h3>
              <div className="prediction-history-list">
                {data.recent_rounds.map((pastRound) => (
                  <article className="prediction-history-item" key={pastRound.id}>
                    <div>
                      <strong>{pastRound.game_name} · {pastRound.is_demo ? "demo simulation" : "historical match"}</strong>
                      <span>{pastRound.is_demo ? "Sample only; no money involved" : `${pastRound.participant_count} anonymous players`}</span>
                    </div>
                    <div className="prediction-result">
                      <span>Past result</span>
                      <strong>{pastRound.result}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function orientBoard180(board, rotated) {
  return rotated ? [...board].reverse().map((row) => [...row].reverse()) : board;
}

function RotateBoardButton({ rotated, onClick }) {
  return (
    <ActionButton
      className="game-icon-button board-rotate-button"
      type="button"
      aria-label="Rotate board 180 degrees"
      aria-pressed={rotated}
      title="Rotate board 180°"
      onClick={onClick}
    >
      <GameActionIcon action="rotate" />
    </ActionButton>
  );
}

function GameHelpButton({ gameId, gameName, rulebook }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const titleId = `game-help-title-${gameId}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <ActionButton
        className="game-icon-button"
        type="button"
        aria-label={`How to play ${gameName}`}
        title="How to play"
        onClick={() => setOpen(true)}
      >
        <GameActionIcon action="help" />
      </ActionButton>
      <dialog
        className="game-help-dialog"
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <h2 id={titleId}>{rulebook?.title || `${gameName} rules`}</h2>
        <p className="game-help-content">
          {rulebook?.content || "Game instructions are unavailable right now."}
        </p>
        <div className="game-help-actions">
          <ActionButton className="btn" type="button" onClick={() => setOpen(false)}>
            Close
          </ActionButton>
        </div>
      </dialog>
    </>
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
  const [boardRotated, setBoardRotated] = useState(false);
  const boardRows = orientBoard180(state.board, boardRotated);
  const topPlayerColor = boardRotated ? "white" : "black";
  const bottomPlayerColor = boardRotated ? "black" : "white";
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
        <div className="board-tools">
          <RotateBoardButton
            rotated={boardRotated}
            onClick={() => setBoardRotated((rotated) => !rotated)}
          />
        </div>
        <BoardPlayerLabel
          name={game.player_display_names?.[topPlayerColor] || players[topPlayerColor]}
          username={players[topPlayerColor]}
          side={topPlayerColor === "white" ? "White" : "Black"}
          isTurn={state.turn_user_id === state[`${topPlayerColor}_player_id`]}
          gameActive={state.status === "active"}
        />
        <div className="chess-board" role="grid" aria-label="Chess board">
          {boardRows.flatMap((row, displayY) => row.map((piece, displayX) => {
            const x = boardRotated ? 7 - displayX : displayX;
            const y = boardRotated ? 7 - displayY : displayY;
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
          name={game.player_display_names?.[bottomPlayerColor] || players[bottomPlayerColor]}
          username={players[bottomPlayerColor]}
          side={bottomPlayerColor === "white" ? "White" : "Black"}
          isTurn={state.turn_user_id === state[`${bottomPlayerColor}_player_id`]}
          gameActive={state.status === "active"}
        />
      </div>
      <div className="game-info card">
        <p aria-live="polite">{result}</p>
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
      </div>
    </div>
  );
}

function PoloScorecard({ game, onSubmitScore, actionPending }) {
  const { state, players, viewer } = game;
  const [goals, setGoals] = useState(0);
  const teamOnTurn = state.teams.find((team) => team.user_id === state.turn_user_id);
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

function SoloDraughts({ token, username, displayName, rulebook, onClose }) {
  const [game, setGame] = useState(createSoloDraughtsGame);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [boardRotated, setBoardRotated] = useState(false);
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
  const [confirmation, setConfirmation] = useState(null);
  const [pendingLevel, setPendingLevel] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [round, setRound] = useState(0);
  const recordedRound = useRef(null);
  const legalMoves = legalSoloDraughtsMoves(game, "player");
  const boardRows = orientBoard180(game.board, boardRotated);

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

  function applyLevelChoice(selectedLevel) {
    setLevel(selectedLevel);
    setGameLevel(selectedLevel);
    setGame(createSoloDraughtsGame());
    setSelectedSquare(null);
    setThinking(false);
    setProgressMessage("");
    setSaveError("");
    setRound((current) => current + 1);
  }

  function chooseLevel(event) {
    const selectedLevel = Number(event.target.value);
    if (game.status === "active") {
      setPendingLevel(selectedLevel);
      setConfirmation("change-level");
      return;
    }
    applyLevelChoice(selectedLevel);
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
      className="game-section solo-game-section"
      id="solo-practice"
      aria-label="Solo Draughts"
    >
      <div className="game-toolbar">
        <div>
          <h2>{username} vs Computer</h2>
        </div>
        <div className="room-actions">
          <ActionButton
            className="game-icon-button"
            aria-label="Start a new game"
            title="New game"
            onClick={() => setConfirmation("new-game")}
            disabled={progressSaving}
          >
            <GameActionIcon action="new-game" />
          </ActionButton>
          <ActionButton
            className="game-icon-button"
            aria-label="Quit game"
            title="Quit game"
            onClick={() => setConfirmation("quit")}
          >
            <GameActionIcon action="quit" />
          </ActionButton>
          <GameHelpButton gameId="draughts" gameName="Draughts" rulebook={rulebook} />
        </div>
      </div>
      <div className="solo-draughts-layout">
        <div className="board-with-players">
          <div className="board-tools">
            {progressLoaded && (
              <label className="solo-level-picker solo-draughts-level">
                <span>Level</span>
                <select
                  aria-label="Select Draughts level"
                  value={level}
                  onChange={chooseLevel}
                  disabled={progressSaving}
                >
                  {Array.from({ length: highestLevel }, (_, index) => index + 1).map((unlocked) => (
                    <option key={unlocked} value={unlocked}>{unlocked}</option>
                  ))}
                </select>
              </label>
            )}
            <RotateBoardButton
              rotated={boardRotated}
              onClick={() => setBoardRotated((rotated) => !rotated)}
            />
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {statusMessage}
            {progressSaving ? " Saving your level progress." : ""}
            {progressMessage ? ` ${progressMessage}` : ""}
          </p>
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
              <p className="error" role="alert">Could not save your level progress: {saveError}</p>
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
          <BoardPlayerLabel
            name={boardRotated ? displayName || username : "Computer"}
            username={boardRotated ? username : undefined}
            side={boardRotated ? "Red · You" : "Black"}
            isTurn={boardRotated ? game.turn === "player" : game.turn === "computer"}
            gameActive={game.status === "active"}
          />
          <div className="draughts-board" aria-label="Solo Draughts board">
            {boardRows.flatMap((row, displayY) =>
              row.map((piece, displayX) => {
                const x = boardRotated ? 7 - displayX : displayX;
                const y = boardRotated ? 7 - displayY : displayY;
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
            name={boardRotated ? "Computer" : displayName || username}
            username={boardRotated ? undefined : username}
            side={boardRotated ? "Black" : "Red · You"}
            isTurn={boardRotated ? game.turn === "computer" : game.turn === "player"}
            gameActive={game.status === "active"}
          />
        </div>
      </div>
      {confirmation && (
        <ConfirmDialog
          title={confirmation === "quit"
            ? "Quit this game?"
            : confirmation === "change-level"
              ? "Change level?"
              : "Start a new game?"}
          message={confirmation === "quit"
            ? "Your current solo round will end; only your unlocked level progress is saved."
            : confirmation === "change-level"
              ? "Changing level will end this round and start a fresh board at the selected level. Your unlocked progress will remain saved."
              : "This will end the current round and deal a fresh board at the selected level. Your unlocked progress will remain saved."}
          confirmLabel={confirmation === "quit"
            ? "Quit game"
            : confirmation === "change-level"
              ? "Change level"
              : "Start new game"}
          onCancel={() => {
            setConfirmation(null);
            setPendingLevel(null);
          }}
          onConfirm={() => {
            const action = confirmation;
            setConfirmation(null);
            if (action === "quit") {
              onClose();
            } else if (action === "change-level" && pendingLevel != null) {
              applyLevelChoice(pendingLevel);
              setPendingLevel(null);
            } else {
              startNewGame();
            }
          }}
        />
      )}
    </section>
  );
}

function SoloGame({ token, gameId, username, rulebook, onClose }) {
  const [game, setGame] = useState(null);
  const [level, setLevel] = useState(1);
  const [highestLevel, setHighestLevel] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState(null);
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

  function requestNewGame() {
    if (game?.status === "active") {
      setConfirmation({ type: "new-game", level });
    } else {
      void startGame(level);
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
  return (
    <section
      className="game-section solo-game-section"
      id="solo-practice"
      aria-label={`Solo ${gameName}`}
    >
      <div className="game-toolbar">
        <div>
          <h2>{username} vs Computer</h2>
        </div>
        <div className="room-actions">
          <ActionButton
            className="game-icon-button"
            aria-label="Start a new game"
            title="New game"
            onClick={requestNewGame}
            disabled={pending}
          >
            <GameActionIcon action="new-game" />
          </ActionButton>
          <ActionButton
            className="game-icon-button"
            aria-label="Quit game"
            title="Quit game"
            onClick={() => setConfirmation({ type: "quit" })}
          >
            <GameActionIcon action="quit" />
          </ActionButton>
          <GameHelpButton gameId={gameId} gameName={gameName} rulebook={rulebook} />
        </div>
      </div>

      {loading ? (
        <p className="login-prompt">Loading your saved solo game...</p>
      ) : !game || game.status !== "active" ? (
        <div className="solo-level-controls">
          <label className="solo-level-picker solo-draughts-level">
            <span>Level</span>
            <select
              aria-label={`Select ${gameName} level`}
              value={level}
              onChange={(event) => setLevel(Number(event.target.value))}
              disabled={pending}
            >
              {Array.from({ length: highestLevel }, (_, index) => index + 1).map((unlocked) => (
                <option key={unlocked} value={unlocked}>{unlocked}</option>
              ))}
            </select>
          </label>
          <ActionButton
            className="game-icon-button"
            aria-label={`Start level ${level}`}
            title={`Start level ${level}`}
            onClick={() => void startGame()}
            disabled={pending}
          >
            <GameActionIcon action="new-game" />
          </ActionButton>
        </div>
      ) : (
        <>
          <div className="solo-level-controls">
            <label className="solo-level-picker solo-draughts-level">
              <span>Level</span>
              <select
                aria-label={`Select ${gameName} level`}
                value={level}
                onChange={(event) => setLevel(Number(event.target.value))}
                disabled={pending}
              >
                {Array.from({ length: highestLevel }, (_, index) => index + 1).map((unlocked) => (
                  <option key={unlocked} value={unlocked}>{unlocked}</option>
                ))}
              </select>
            </label>
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
      {confirmation && (
        <ConfirmDialog
          title={confirmation.type === "quit" ? "Leave this solo game?" : "Start a new game?"}
          message={confirmation.type === "quit"
            ? "Your current solo game will stay saved, and you can return to it later."
            : "Starting a new game will abandon the current solo game and replace it. Your unlocked level progress will remain saved."}
          confirmLabel={confirmation.type === "quit" ? "Leave game" : "Start new game"}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation;
            setConfirmation(null);
            if (action.type === "quit") {
              onClose();
            } else {
              void startGame(action.level);
            }
          }}
        />
      )}
    </section>
  );
}

function PlayerProfile({ token, initialProfile, initialProfileLoading, onProfileChange }) {
  const [profile, setProfile] = useState(initialProfile || null);
  const [loading, setLoading] = useState(!initialProfile);
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
    if (initialProfile) {
      setProfile(initialProfile);
      setLoading(false);
      setError("");
      return () => {
        stopped = true;
      };
    }
    if (initialProfileLoading) {
      setLoading(true);
      return () => {
        stopped = true;
      };
    }
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
  }, [token, loadAttempt, initialProfile, initialProfileLoading]);

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
      onProfileChange?.({
        ...profile,
        user: { ...profile.user, ...updated },
      });
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
  { id: "chess", name: "Chess", players: "2", playable: true },
  { id: "draughts", name: "Draughts", players: "2", playable: true },
  { id: "golf", name: "Golf", players: "2-4", playable: true },
  { id: "ludo", name: "Ludo", players: "2-4", playable: true },
  { id: "polo", name: "Polo", players: "2", playable: true },
  {
    id: "ps5",
    name: "PS5",
    players: "TBD",
    playable: false,
    description: "PlayStation 5 support is planned, but not playable yet.",
  },
  { id: "snooker", name: "Snooker", players: "2", playable: true },
  { id: "whot", name: "Whot", players: "2-4", playable: true },
];

const GAME_DESCRIPTIONS = {
  chess: "Plan ahead in a classic strategy match.",
  draughts: "Capture pieces and crown your kings.",
  golf: "Compete across a friendly nine-hole scorecard.",
  ludo: "Race your tokens home with fair server-rolled dice.",
  polo: "Track team goals across four chukkas.",
  snooker: "Play best-of-three frames on the scorecard.",
  whot: "Match suits, play action cards, and empty your hand.",
};

const ROOM_AVAILABILITY_LABELS = {
  waiting: "Waiting for players",
  full: "Full",
  "in-progress": "In progress",
  completed: "Completed",
};

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
  const [profileSummary, setProfileSummary] = useState(null);
  const [profileSummaryLoading, setProfileSummaryLoading] = useState(false);
  const [profileSummaryError, setProfileSummaryError] = useState("");
  const [games, setGames] = useState(INITIAL_GAMES);
  const [rulebooks, setRulebooks] = useState({});
  const [rooms, setRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [roomAvailabilityFilter, setRoomAvailabilityFilter] = useState("all");
  const [roomGameFilter, setRoomGameFilter] = useState("all");
  const [hostApplication, setHostApplication] = useState(null);
  const [hostApplicationLoading, setHostApplicationLoading] = useState(false);
  const [breakReminderMinutes, setBreakReminderMinutes] = useState(60);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [nextReminderSeconds, setNextReminderSeconds] = useState(60 * 60);
  const [activeGame, setActiveGame] = useState(null);
  const [gameConnectionStatus, setGameConnectionStatus] = useState("offline");
  const [confirmQuitGame, setConfirmQuitGame] = useState(false);
  const [soloGameOpen, setSoloGameOpen] = useState(false);
  const [soloGameId, setSoloGameId] = useState("draughts");
  const [startSoloAfterAuth, setStartSoloAfterAuth] = useState(false);
  const [startRoomsAfterAuth, setStartRoomsAfterAuth] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [draughtsBoardRotated, setDraughtsBoardRotated] = useState(false);
  const [notice, setNotice] = useState("");
  const [roomName, setRoomName] = useState("");
  const [gameId, setGameId] = useState("draughts");
  const [selectedGameFilter, setSelectedGameFilter] = useState(null);
  const [showSelectedGameOptions, setShowSelectedGameOptions] = useState(false);
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [roomStake, setRoomStake] = useState("0");
  const [busyRoom, setBusyRoom] = useState(null);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [reportRoomId, setReportRoomId] = useState(null);
  const [gameActionPending, setGameActionPending] = useState(false);
  const [pendingSquare, setPendingSquare] = useState(null);
  const roomsRequestId = useRef(0);
  const profileRequestId = useRef(0);
  const loadedResults = useRef("");
  const waitingRoomKey = session && !activeGame
    ? rooms
      .filter((room) => room.viewer_is_seated && room.game_status === "not_started")
      .map((room) => room.id)
      .sort((a, b) => a - b)
      .join(",")
    : "";

  useEffect(() => {
    api.getGames()
      .then((serverGames) => setGames(mergeGameCatalogue(serverGames, INITIAL_GAMES)))
      .catch((err) => setNotice(err.message));
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
      if (pendingPlayChoice.kind === "others") setStartRoomsAfterAuth(true);
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
    reloadRooms().catch(() => {});
  }, [session?.token]);
  useEffect(() => {
    if (!session) {
      setProfileSummary(null);
      setProfileSummaryError("");
      setProfileSummaryLoading(false);
      return undefined;
    }
    let stopped = false;
    const requestId = ++profileRequestId.current;
    setProfileSummaryLoading(true);
    setProfileSummaryError("");
    api.getPlayerProfile(session.token)
      .then((profile) => {
        if (!stopped && requestId === profileRequestId.current) setProfileSummary(profile);
      })
      .catch((err) => {
        if (!stopped && requestId === profileRequestId.current) {
          setProfileSummaryError(err.message);
        }
      })
      .finally(() => {
        if (!stopped && requestId === profileRequestId.current) {
          setProfileSummaryLoading(false);
        }
      });
    return () => {
      stopped = true;
    };
  }, [session?.token, session?.username]);
  useEffect(() => {
    const resultKey = activeGame?.status === "finished" && session
      ? `${activeGame.room_id}:${activeGame.state.status}`
      : "";
    if (!resultKey || loadedResults.current === resultKey) return;
    loadedResults.current = resultKey;
    let stopped = false;
    const requestId = ++profileRequestId.current;
    api.getPlayerProfile(session.token)
      .then((profile) => {
        if (!stopped && requestId === profileRequestId.current) setProfileSummary(profile);
      })
      .catch((err) => {
        if (!stopped && requestId === profileRequestId.current) setProfileSummaryError(err.message);
      });
    return () => {
      stopped = true;
    };
  }, [activeGame?.room_id, activeGame?.status, activeGame?.state?.status, session?.token, session?.username]);
  useEffect(() => {
    let stopped = false;
    if (session) {
      setHostApplicationLoading(true);
      api.getMyHostApplication(session.token)
        .then((application) => {
          if (!stopped) setHostApplication(application);
        })
        .catch((err) => {
          if (!stopped) setNotice(`Could not load Host application status: ${err.message}`);
        })
        .finally(() => {
          if (!stopped) setHostApplicationLoading(false);
        });
    } else {
      setHostApplication(null);
      setHostApplicationLoading(false);
      setActiveGame(null);
    }
    return () => {
      stopped = true;
    };
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
    setGameConnectionStatus("connecting");
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
        setGameConnectionStatus("reconnecting");
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
          setGameConnectionStatus("connected");
          reconnectDelay = 500;
          void refresh();
        } else if (update.type === "game_updated") {
          void refresh();
        }
      });
      connection.addEventListener("close", () => {
        connected = false;
        if (!stopped) setGameConnectionStatus("reconnecting");
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
        setRooms(uniqueRooms(latestRooms));
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
    const requestId = ++roomsRequestId.current;
    setRoomsLoading(true);
    setRoomsError("");
    try {
      const latestRooms = await api.getRooms(session?.token);
      if (requestId === roomsRequestId.current) setRooms(uniqueRooms(latestRooms));
    } catch (error) {
      if (requestId === roomsRequestId.current) setRoomsError(error.message);
      throw error;
    } finally {
      if (requestId === roomsRequestId.current) setRoomsLoading(false);
    }
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
    const stakeKobo = nairaToKobo(roomStake);
    if (!Number.isInteger(stakeKobo) || stakeKobo < 0 || (stakeKobo > 0 && stakeKobo < 100)) {
      setNotice("Enter 0 for a free room or a stake of at least NGN 1.00 per player.");
      return;
    }
    setCreatingRoom(true);
    try {
      const room = await api.createPracticeRoom(session.token, {
        game_id: gameId,
        name: roomName,
        max_players: maxPlayers,
        stake_kobo: stakeKobo,
      });
      setRoomName("");
      setRoomStake("0");
      await reloadRooms();
      setNotice(`Practice room "${room.name}" created.`);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setCreatingRoom(false);
    }
  }

  async function joinRoom(room) {
    if (
      room.stake_kobo > 0
      && !window.confirm(
        `This room stakes ${formatNaira(room.stake_kobo)} per player. Your stake is held when the game starts. Join?`,
      )
    ) return;
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
  const selectedGame = games.find((game) => game.id === selectedGameFilter);
  const filteredRooms = filterRooms(rooms, {
    search: roomSearch,
    gameId: roomGameFilter,
    availability: roomAvailabilityFilter,
  });
  const sortedGames = [...games].sort((first, second) =>
    first.name.localeCompare(second.name, undefined, { sensitivity: "base" }),
  );
  const activeGameName = activeGame
    ? games.find((game) => game.id === activeGame.game_id)?.name || activeGame.game_id
    : "";

  function scrollToSection(sectionId) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth" });
  }

  function openProfile() {
    if (!session) {
      setMode("login");
      return;
    }
    setProfileOpen(true);
    window.setTimeout(() => scrollToSection("player-profile"), 0);
  }

  function selectGame(game) {
    if (!game.playable) {
      setNotice(`${game.name} is coming soon.`);
      return;
    }
    setGameId(game.id);
    setMaxPlayers(2);
    setSelectedGameFilter(game.id);
    setRoomGameFilter(game.id);
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
      setStartRoomsAfterAuth(true);
      setMode("signup");
      return;
    }
    scrollToSection("practice-rooms");
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
    setProfileSummary(null);
    setProfileOpen(false);
    setNotice("");
    setActiveGame(null);
    setSoloGameOpen(false);
    setStartSoloAfterAuth(false);
  }

  const profileDisplayName = profileSummary?.user.display_name || session?.display_name || session?.username || "";
  const profileInitials = profileDisplayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  return (
    <div id="home" className={`page${showSelectedGameOptions && selectedGame ? " has-mobile-game-options" : ""}${activeGame || soloGameOpen ? " game-focus" : ""}`}>
      <ControllerNavigation />
      <nav className="site-nav">
        <span className="logo">Aus<b>Play</b></span>
        <div className="primary-nav" aria-label="Main navigation">
          <a className="nav-anchor" href="#home">Home</a>
          <a className="nav-anchor" href="#games">Games</a>
          <a className="nav-anchor" href="#practice-rooms">Practice Rooms</a>
          <a className="nav-anchor" href="#predictions">Virtual Games</a>
        </div>
        <div className="nav-links">
          {session ? (
            <>
              <ActionButton
                className="profile-menu-button"
                aria-expanded={profileOpen}
                aria-controls="player-profile"
                aria-label={`View ${session.username}'s profile and game history`}
                onClick={openProfile}
              >
                <span className="avatar avatar-small" aria-hidden="true">{profileInitials || "A"}</span>
                <span>{profileDisplayName}</span>
              </ActionButton>
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
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <a href="#home" aria-label="Home">
          <NavigationIcon name="home" />
          <small>Home</small>
        </a>
        <a href="#games" aria-label="Games">
          <NavigationIcon name="games" />
          <small>Games</small>
        </a>
        <button type="button" onClick={playSelectedGameWithOthers} aria-label="Play">
          <NavigationIcon name="play" />
          <small>Play</small>
        </button>
        <a href="#predictions" aria-label="Virtual Games">
          <NavigationIcon name="predict" />
          <small>Virtual</small>
        </a>
        <button type="button" onClick={openProfile} aria-label="Profile">
          <NavigationIcon name="profile" />
          <small>Profile</small>
        </button>
      </nav>

      {mode && !session ? (
        <AuthForm
          mode={mode}
          onDone={(s) => {
            setSession({ ...s, role: s.role || "player" });
            setMode(null);
            if (mode === "signup" && s.email_verification_sent) {
              setNotice("Account created. Check your email to verify it and enable account recovery.");
            } else if (mode === "signup") {
              setNotice("Account created. Add or verify an email in your profile later to enable account recovery.");
            }
            if (startSoloAfterAuth) {
              setStartSoloAfterAuth(false);
              setSoloGameOpen(true);
            }
            if (startRoomsAfterAuth) {
              setStartRoomsAfterAuth(false);
              window.setTimeout(() => scrollToSection("practice-rooms"), 0);
            }
          }}
          onModeChange={setMode}
        />
      ) : (
        <header className="hero">
          <p className="eyebrow">PLAY FAIR. PLAY TOGETHER.</p>
          <h1>Your next match<br />starts here.</h1>
          <p>Challenge friends, meet new players, and enjoy free practice games.</p>
          <div className="hero-actions">
            <ActionButton className="btn big" onClick={() => scrollToSection("games")}>
              Play Now
            </ActionButton>
            <ActionButton className="btn-secondary" onClick={playSelectedGameWithOthers}>
              Play with Friends
            </ActionButton>
            <ActionButton className="link hero-link" onClick={() => scrollToSection("practice-rooms")}>
              Browse Practice Rooms
            </ActionButton>
          </div>
        </header>
      )}

      <section className="games-section" id="games">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CHOOSE YOUR GAME</p>
            <h2>Games</h2>
          </div>
          <p className="section-note">Choose a free practice room or one with an optional NGN stake.</p>
        </div>
        <div className="grid">
          {sortedGames.map((g) => (
            <article
              className={`card game-card${g.playable ? " selectable" : ""}${selectedGameFilter === g.id ? " selected" : ""}`}
              key={g.id}
              aria-label={`${g.name}${g.playable ? `, ${g.players} players` : ", coming soon"}`}
            >
              <div className="game-card-art" aria-hidden="true">
                {GAME_ARTWORK[g.id] ? (
                  <img src={GAME_ARTWORK[g.id]} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="game-card-art-fallback">{g.name.slice(0, 1)}</span>
                )}
              </div>
              <span className={`game-availability ${g.playable ? "ready" : ""}`}>
                {g.playable ? "Playable now" : "Coming soon"}
              </span>
              <div className="game-card-copy">
                <h3>{g.name}</h3>
                <span className="game-player-count">
                  {g.playable ? `${g.players} players` : "Not playable yet"}
                </span>
                <p>{g.description || GAME_DESCRIPTIONS[g.id] || "Explore this practice game."}</p>
              </div>
              <ActionButton
                className={g.playable ? "game-card-action" : "game-card-action unavailable"}
                onClick={g.playable ? () => selectGame(g) : undefined}
                disabled={!g.playable}
              >
                {g.playable ? "Play" : "Coming soon"}
              </ActionButton>
            </article>
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

      {session && (
        <section className="dashboard-section" aria-label="Player progress">
          {profileSummaryLoading && !profileSummary ? (
            <p className="login-prompt" role="status">Loading your player summary...</p>
          ) : profileSummaryError && !profileSummary ? (
            <div className="dashboard-error">
              <p role="alert">Could not load your match summary: {profileSummaryError}</p>
              <ActionButton className="link" onClick={() => {
                setProfileSummaryError("");
                setProfileSummaryLoading(true);
                api.getPlayerProfile(session.token)
                  .then(setProfileSummary)
                  .catch((error) => setProfileSummaryError(error.message))
                  .finally(() => setProfileSummaryLoading(false));
              }}>
                Retry
              </ActionButton>
            </div>
          ) : profileSummary ? (
            <div className="dashboard-panel">
              <div className="dashboard-heading">
                <div className="dashboard-player">
                  <span className="avatar" aria-hidden="true">{profileInitials || "A"}</span>
                  <div>
                    <p className="eyebrow">YOUR PROGRESS</p>
                    <h2>Welcome back, {profileDisplayName}</h2>
                  </div>
                </div>
                <ActionButton className="link" onClick={openProfile}>View profile</ActionButton>
              </div>
              <div className="dashboard-stats">
                {[
                  ["Matches", profileSummary.stats.played],
                  ["Wins", profileSummary.stats.wins],
                  ["Draws", profileSummary.stats.draws],
                  ["Losses", profileSummary.stats.losses],
                  ["Win rate", `${profileSummary.stats.win_rate}%`],
                ].map(([label, value]) => (
                  <div className="dashboard-stat" key={label}>
                    <strong>{value}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              {profileSummary.recent_matches.length > 0 && (
                <div className="dashboard-recent">
                  <div className="dashboard-recent-heading">
                    <h3>Recently played</h3>
                    <ActionButton className="link" onClick={openProfile}>All results</ActionButton>
                  </div>
                  <div className="recent-match-grid">
                    {profileSummary.recent_matches.slice(0, 3).map((match) => (
                      <article className="recent-match-card" key={match.room_id}>
                        <div className="recent-match-art">
                          <img
                            src={GAME_ARTWORK[match.game_id]}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                        <div className="recent-match-info">
                          <strong>{match.game_name}</strong>
                          <span>{match.opponents.length ? match.opponents.join(", ") : "Practice match"}</span>
                        </div>
                        <span className={`profile-result ${match.result}`}>{match.result}</span>
                        <time dateTime={match.completed_at}>
                          {new Date(match.completed_at).toLocaleDateString()}
                        </time>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>
      )}

      {session && soloGameOpen && (
        soloGameId === "draughts" ? (
          <SoloDraughts
            token={session.token}
            username={session.username}
            displayName={session.display_name}
            rulebook={rulebooks.draughts}
            onClose={quitSoloGame}
          />
        ) : (
          <SoloGame
            token={session.token}
            gameId={soloGameId}
            username={session.username}
            rulebook={rulebooks[soloGameId]}
            onClose={quitSoloGame}
          />
        )
      )}

      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}

      {session && profileOpen && (
        <PlayerProfile
          token={session.token}
          initialProfile={profileSummary}
          initialProfileLoading={profileSummaryLoading}
          onProfileChange={setProfileSummary}
        />
      )}

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
          applicationLoading={hostApplicationLoading}
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

      <VirtualGamesWorkspace
        session={session}
        games={games}
        onLogin={() => setMode("signup")}
      />

      <section className="rooms-section" id="practice-rooms">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PLAY WITH OTHERS</p>
            <h2>Practice rooms</h2>
          </div>
          <div className="room-heading-actions">
            <p className="section-note">Free play is available; rooms may also offer an optional NGN stake.</p>
            <ActionButton className="link" onClick={() => reloadRooms().catch((err) => setNotice(err.message))}>
              {roomsLoading ? "Refreshing..." : "Refresh"}
            </ActionButton>
            {roomGameFilter !== "all" && (
              <ActionButton
                className="link"
                onClick={() => {
                  setSelectedGameFilter(null);
                  setRoomGameFilter("all");
                  setShowSelectedGameOptions(false);
                }}
              >
                Clear game filter
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
                setRoomGameFilter(e.target.value);
                setShowSelectedGameOptions(false);
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
            <label>
              Stake per player (NGN; 0 for free)
              <input
                type="number"
                min="0"
                step="0.01"
                value={roomStake}
                onChange={(event) => setRoomStake(event.target.value)}
              />
            </label>
            <p className="section-note">
              Stakes are reserved only when the room fills and the game starts. Ties are refunded; winners receive the pot less 10% of losing stakes.
            </p>
            <ActionButton className="btn" type="submit" loading={creatingRoom}>
              {creatingRoom ? "Creating..." : "Create room"}
            </ActionButton>
          </form>
        ) : (
          <p className="login-prompt">Log in or sign up to create a practice room and join other players.</p>
        )}
        <div className="room-filters" role="group" aria-label="Filter practice rooms">
          <label className="room-search">
            Search rooms
            <input
              type="search"
              value={roomSearch}
              onChange={(event) => setRoomSearch(event.target.value)}
              placeholder="Room name or host"
            />
          </label>
          <label>
            Game
            <select
              value={roomGameFilter}
              onChange={(event) => {
                setRoomGameFilter(event.target.value);
                setSelectedGameFilter(event.target.value === "all" ? null : event.target.value);
              }}
            >
              <option value="all">All games</option>
              {games.filter((game) => game.playable).map((game) => (
                <option key={game.id} value={game.id}>{game.name}</option>
              ))}
            </select>
          </label>
          <label>
            Availability
            <select
              value={roomAvailabilityFilter}
              onChange={(event) => setRoomAvailabilityFilter(event.target.value)}
            >
              <option value="all">All rooms</option>
              <option value="waiting">Waiting for players</option>
              <option value="full">Full</option>
              <option value="in-progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        </div>
        {roomsLoading && rooms.length === 0 && (
          <p className="login-prompt" role="status">Loading practice rooms...</p>
        )}
        {roomsError && (
          <div className="rooms-error">
            <p role="alert">Could not load practice rooms: {roomsError}</p>
            <ActionButton className="link" onClick={() => reloadRooms().catch((err) => setNotice(err.message))}>
              Try again
            </ActionButton>
          </div>
        )}
        {filteredRooms.length ? (
          <div className="grid room-grid">
            {filteredRooms.map((room) => {
              const availability = getRoomAvailability(room);
              const gameName = games.find((game) => game.id === room.game_id)?.name || room.game_id;
              return (
                <div className="card room-card" key={room.id}>
                  <div className="room-card-heading">
                    <h3>{room.name}</h3>
                    <span className={`room-status ${availability}`}>
                      {ROOM_AVAILABILITY_LABELS[availability]}
                    </span>
                  </div>
                  <div className="room-meta">
                    <span className="room-game-name">{gameName}</span>
                    <span>Hosted by <PlayerProfileLink username={room.host} /></span>
                  </div>
                  <p className="room-capacity">
                    <span aria-hidden="true">♟</span> {room.players} of {room.max_players} players
                  </p>
                  {room.stake_kobo > 0 && (
                    <p className="room-capacity">
                      Stake: {formatNaira(room.stake_kobo)} per player
                    </p>
                  )}
                  {rulebooks[room.game_id] && (
                    <details className="room-rules">
                      <summary>{rulebooks[room.game_id].title}</summary>
                      <p>{rulebooks[room.game_id].content}</p>
                    </details>
                  )}
                  {session && room.viewer_is_seated && (
                    room.game_status === "active" || room.game_status === "finished"
                  ) && (
                    <ActionButton className="btn room-join" onClick={() => openGame(room)}>
                      {room.game_status === "active" ? "Open Game" : "View Result"}
                    </ActionButton>
                  )}
                  {session && availability === "waiting" && !room.viewer_is_seated && (
                    <ActionButton
                      className="btn room-join"
                      onClick={() => joinRoom(room)}
                      disabled={busyRoom === room.id}
                    >
                      {busyRoom === room.id ? "Joining..." : "Join Room"}
                    </ActionButton>
                  )}
                  {session && room.viewer_is_seated && room.game_status === "not_started" && (
                    <p className="room-unavailable">
                      You’re in. Waiting for more players.
                    </p>
                  )}
                  {!session && availability === "waiting" && (
                    <p className="room-unavailable">Log in to join this room.</p>
                  )}
                  {availability === "full" && (
                    <p className="room-unavailable">This room is at capacity.</p>
                  )}
                  {availability === "in-progress" && !room.viewer_is_seated && (
                    <p className="room-unavailable">This game is in progress; new players cannot join.</p>
                  )}
                  {availability === "completed" && !room.viewer_is_seated && (
                    <p className="room-unavailable">Results are available to players in this room.</p>
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
              );
            })}
          </div>
        ) : !roomsLoading && !roomsError ? (
          <p className="empty-state">
            {rooms.length
              ? "No rooms match those filters. Try changing your search or availability."
              : selectedGame
                ? `No ${selectedGame.name} rooms yet. Create one above and invite your friends.`
                : "No practice rooms yet. Start one and invite your friends."}
          </p>
        ) : null}
      </section>

      {activeGame && (
        <section
          className="game-section"
          aria-label={`${activeGameName} game`}
        >
          <div className="game-toolbar">
            <div>
              <h2>{activeGameName}</h2>
              <p className={`game-connection ${gameConnectionStatus}`} role="status" aria-live="polite">
                <span aria-hidden="true" />
                {gameConnectionStatus === "connected"
                  ? "Live updates connected"
                  : gameConnectionStatus === "reconnecting"
                    ? "Reconnecting to live updates"
                    : "Connecting to live updates"}
              </p>
            </div>
            <div className="room-actions">
              <GameHelpButton
                gameId={activeGame.game_id}
                gameName={activeGameName}
                rulebook={rulebooks[activeGame.game_id]}
              />
              <ActionButton
                className="game-icon-button"
                aria-label="Quit game"
                title="Quit game"
                onClick={() => setConfirmQuitGame(true)}
              >
                <GameActionIcon action="quit" />
              </ActionButton>
            </div>
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
              <div className="board-tools">
                <RotateBoardButton
                  rotated={draughtsBoardRotated}
                  onClick={() => setDraughtsBoardRotated((rotated) => !rotated)}
                />
              </div>
              <BoardPlayerLabel
                name={draughtsBoardRotated
                  ? activeGame.player_display_names?.red || activeGame.players.red
                  : activeGame.player_display_names?.black || activeGame.players.black}
                username={draughtsBoardRotated
                  ? activeGame.players.red
                  : activeGame.players.black}
                side={draughtsBoardRotated ? "Red" : "Black"}
                isTurn={activeGame.state.turn_user_id === (
                  draughtsBoardRotated
                    ? activeGame.state.red_player_id
                    : activeGame.state.black_player_id
                )}
                gameActive={activeGame.state.status === "active"}
              />
              <div className="draughts-board" aria-label="Draughts board">
                {orientBoard180(activeGame.state.board, draughtsBoardRotated)
                  .flatMap((row, displayY) => row.map((piece, displayX) => {
                    const x = draughtsBoardRotated ? 7 - displayX : displayX;
                    const y = draughtsBoardRotated ? 7 - displayY : displayY;
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
                name={draughtsBoardRotated
                  ? activeGame.player_display_names?.black || activeGame.players.black
                  : activeGame.player_display_names?.red || activeGame.players.red}
                username={draughtsBoardRotated
                  ? activeGame.players.black
                  : activeGame.players.red}
                side={draughtsBoardRotated ? "Black" : "Red"}
                isTurn={activeGame.state.turn_user_id === (
                  draughtsBoardRotated
                    ? activeGame.state.black_player_id
                    : activeGame.state.red_player_id
                )}
                gameActive={activeGame.state.status === "active"}
              />
            </div>
            <div className="game-info card">
              <p>
                {activeGame.status === "finished"
                  ? activeGame.state.winner_user_id === activeGame.viewer.user_id
                    ? "You won!"
                    : "Match finished."
                  : activeGame.viewer.is_turn
                    ? "Your turn. Select one of your highlighted pieces, then a destination."
                    : `Waiting for ${activeGame.players[activeGame.state.turn_user_id === activeGame.state.red_player_id ? "red" : "black"]} to move.`}
              </p>
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
          {confirmQuitGame && (
            <ConfirmDialog
              title="Leave this game?"
              message="This closes the game view, but your room and match remain available. You can reopen the game from your practice rooms."
              confirmLabel="Leave game"
              onCancel={() => setConfirmQuitGame(false)}
              onConfirm={() => {
                setConfirmQuitGame(false);
                setActiveGame(null);
                setSelectedSquare(null);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
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
