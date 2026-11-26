import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import { verifyLudoProof } from "./fairness";

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
    </form>
  );
}

function PracticeRoomChat({ token, roomId }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let stopped = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await api.getPracticeRoomChat(token, roomId);
        if (!stopped) {
          setMessages((current) => {
            const lastCurrentId = current[current.length - 1]?.id;
            const lastReceivedId = result.messages[result.messages.length - 1]?.id;
            return current.length === result.messages.length && lastCurrentId === lastReceivedId
              ? current
              : result.messages;
          });
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
  }, [token, roomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  async function sendMessage(event) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    try {
      const message = await api.sendPracticeRoomChat(token, roomId, content);
      setMessages((current) => [...current, message].slice(-100));
      setDraft("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card chat-panel" aria-label="Match chat">
      <h3>Chat with players</h3>
      <div className="chat-messages" aria-live="polite" aria-relevant="additions">
        {messages.length ? messages.map((message) => (
          <div className="chat-message" key={message.id}>
            <div className="chat-message-heading">
              <strong>{message.username}</strong>
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
        <div ref={messagesEndRef} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <form className="chat-form" onSubmit={sendMessage}>
        <input
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
                <option value="ludo">Ludo</option>
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
          Rolls are committed before play. The server seed is revealed when the match ends.
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
              <h3>{players[player.color]}</h3>
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
          <span className={`whot-card ${state.discard_top.suit || "whot-wild"}`}>
            <strong>{state.discard_top.number}</strong>
            <small>{state.discard_top.suit || "WHOT"}</small>
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
            <strong>{players[player.user_id]}{player.user_id === viewer.user_id ? " (you)" : ""}</strong>
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
                      aria-label={`${card.suit || "Whot"} ${card.number}`}
                    >
                      <strong>{card.number}</strong>
                      <small>{card.suit || "WHOT"}</small>
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

export default function App() {
  const [session, setSession] = useState(null); // { token, username }
  const [mode, setMode] = useState(null); // "signup" | "login" | null
  const [games, setGames] = useState([]);
  const [rulebooks, setRulebooks] = useState({});
  const [rooms, setRooms] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [hostApplication, setHostApplication] = useState(null);
  const [breakReminderMinutes, setBreakReminderMinutes] = useState(60);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [nextReminderSeconds, setNextReminderSeconds] = useState(60 * 60);
  const [activeGame, setActiveGame] = useState(null);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [notice, setNotice] = useState("");
  const [roomName, setRoomName] = useState("");
  const [gameId, setGameId] = useState("draughts");
  const [selectedGameFilter, setSelectedGameFilter] = useState(null);
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

  const playerOptions = gameId === "draughts" ? [2] : [2, 3, 4];
  const displayedRooms = selectedGameFilter
    ? rooms.filter((room) => room.game_id === selectedGameFilter)
    : rooms;
  const selectedGame = games.find((game) => game.id === selectedGameFilter);
  const activeGamePlayer = activeGame
    ? activeGame.players[activeGame.viewer.side || activeGame.viewer.color]
    : null;

  function selectGame(game) {
    if (!game.playable) {
      setNotice(`${game.name} is coming soon.`);
      return;
    }
    setGameId(game.id);
    setMaxPlayers(2);
    setSelectedGameFilter(game.id);
    setNotice(
      session
        ? `${game.name} selected. Create a room or join an open room below.`
        : `Sign up or log in to play ${game.name}.`,
    );
    if (session) {
      document.getElementById("practice-rooms")?.scrollIntoView({ behavior: "smooth" });
    } else {
      setMode("signup");
    }
  }

  function takeBreak() {
    setActiveGame(null);
    setSelectedSquare(null);
    setNextReminderSeconds(activeSeconds + 10 * 60);
    setNotice("Game view closed for your break; you can return to the room whenever you’re ready.");
  }

  return (
    <div className="page">
      <nav>
        <span className="logo">Aus<b>Play</b></span>
        <div className="nav-links">
          {session ? (
            <>
              <span>{session.username}</span>
              <span className="role-badge">{session.role}</span>
              <ActionButton className="link" onClick={() => { setSession(null); setNotice(""); setActiveGame(null); }}>Log out</ActionButton>
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
              <p>{g.players} players</p>
              {g.playable && <span className="game-action">Create or join a practice room</span>}
            </div>
          ))}
        </div>
      </section>

      {mode && !session ? (
        <AuthForm
          mode={mode}
          onDone={(s) => { setSession({ ...s, role: s.role || "player" }); setMode(null); }}
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
              <ActionButton className="link" onClick={() => setSelectedGameFilter(null)}>
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
                <p>{games.find((game) => game.id === room.game_id)?.name || room.game_id} · Hosted by {room.host}</p>
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
          className="game-section"
          aria-label={`${activeGame.game_id === "ludo" ? "Ludo" : activeGame.game_id === "whot" ? "Whot" : "Draughts"} game`}
        >
          <div className="game-toolbar">
            <div>
              <p className="eyebrow">FREE PRACTICE MATCH</p>
              <h2>{activeGame.game_id === "ludo" ? "Ludo" : activeGame.game_id === "whot" ? "Whot" : "Draughts"}</h2>
            </div>
            <ActionButton className="link" onClick={() => { setActiveGame(null); setSelectedSquare(null); }}>
              Close game
            </ActionButton>
          </div>
          {activeGame.game_id === "ludo" ? (
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
          <PracticeRoomChat token={session.token} roomId={activeGame.room_id} />
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
        Draughts uses forward-moving men, short kings, and mandatory captures. Ludo uses
        server-rolled dice, exact finishing rolls, and safe squares. Whot uses a simple documented
        baseline ruleset. Real-money play, deposits, and prizes are not available.
      </footer>
    </div>
  );
}
