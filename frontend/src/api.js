const DEFAULT_API_URL = import.meta.env.PROD
  ? "https://ausplay.onrender.com"
  : `http://${window.location.hostname}:8000`;
const BASE = (import.meta.env.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");

async function request(path, options = {}, token) {
  const headers = {
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(BASE + path, {
    ...options,
    credentials: "include",
    headers: { ...headers, ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((issue) => {
        const field = Array.isArray(issue.loc) ? issue.loc.slice(1).join(".") : "";
        return `${field ? `${field}: ` : ""}${issue.msg || "Invalid input"}`;
      }).join("; ")
      : data.detail;
    const error = new Error(
      typeof detail === "string" && detail ? detail : "Something went wrong",
    );
    error.status = res.status;
    throw error;
  }
  return data;
}

export const register = (username, password, ageConfirmed) =>
  request("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      age_confirmed: ageConfirmed,
    }),
  });
export const login = (username, password) =>
  request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
export const logout = (token) => request("/auth/logout", { method: "POST" }, token);
export const getMe = (token) => request("/me", {}, token);
export const getPlayerProfile = (token) => request("/me/profile", {}, token);
export const getPublicPlayerProfile = (username) =>
  request(`/players/${encodeURIComponent(username)}/profile`);
export const updatePlayerProfile = (token, displayName, email) =>
  request("/me/profile", {
    method: "PUT",
    body: JSON.stringify({ display_name: displayName, email }),
  }, token);
export const resendEmailVerification = (token) =>
  request("/me/email-verification", { method: "POST" }, token);
export const verifyEmail = (token) =>
  request("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
export const requestPasswordReset = (email) =>
  request("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
export const completePasswordReset = (token, password) =>
  request("/auth/password-reset/complete", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
export const getGames = () => request("/games");
export const getRulebooks = () => request("/rules");
export const getResponsiblePlaySettings = (token) =>
  request("/responsible-play/settings", {}, token);
export const saveResponsiblePlaySettings = (token, breakReminderMinutes) =>
  request("/responsible-play/settings", {
    method: "PUT",
    body: JSON.stringify({ break_reminder_minutes: breakReminderMinutes }),
  }, token);
export const getRooms = (token) => request("/rooms", {}, token);
export const createPracticeRoom = (token, room) =>
  request("/rooms", { method: "POST", body: JSON.stringify(room) }, token);
export const joinPracticeRoom = (token, roomId) =>
  request(`/rooms/${roomId}/join`, { method: "POST" }, token);
export const getVirtualGames = (token) => request("/virtual-games", {}, token);
export const placeVirtualBet = (token, roundId, bet) =>
  request(`/virtual-games/rounds/${roundId}/bets`, {
    method: "POST",
    body: JSON.stringify(bet),
  }, token);
export const getVirtualGamesCatalogue = () => request("/virtual-games/catalogue");
export const initializeWalletDeposit = (token, deposit) =>
  request("/wallet/deposits", {
    method: "POST",
    body: JSON.stringify(deposit),
  }, token);
export const verifyWalletDeposit = (token, reference) =>
  request(`/wallet/deposits/${encodeURIComponent(reference)}/verify`, {
    method: "POST",
  }, token);
export const getPaystackBanks = (token) => request("/payments/paystack/banks", {}, token);
export const requestWalletWithdrawal = (token, withdrawal) =>
  request("/wallet/withdrawals", {
    method: "POST",
    body: JSON.stringify(withdrawal),
  }, token);
export const getAdminWalletTopups = (token) => request("/admin/wallet/topups", {}, token);
export const createAdminWalletTopup = (token, topup) =>
  request("/admin/wallet/topups", {
    method: "POST",
    body: JSON.stringify(topup),
  }, token);
export const getAdminWalletWithdrawals = (token) =>
  request("/admin/wallet/withdrawals", {}, token);
export const finalizeWalletWithdrawal = (token, withdrawalId, otp) =>
  request(`/admin/wallet/withdrawals/${withdrawalId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ otp }),
  }, token);
export const getPracticeGame = (token, roomId) =>
  request(`/rooms/${roomId}/game`, {}, token);
export const getPracticeRoomChat = (token, roomId, before) =>
  request(`/rooms/${roomId}/chat${before ? `?before=${before}` : ""}`, {}, token);
export const sendPracticeRoomChat = (token, roomId, content) =>
  request(`/rooms/${roomId}/chat`, {
    method: "POST",
    body: JSON.stringify({ content }),
  }, token);
export const connectRoomUpdates = (token, roomId) => {
  const socket = new WebSocket(`${WS_BASE}/ws/rooms/${roomId}`);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ token }));
  }, { once: true });
  return socket;
};
export const submitDraughtsMove = (token, roomId, move) =>
  request(`/rooms/${roomId}/moves`, {
    method: "POST",
    body: JSON.stringify(move),
  }, token);
export const submitChessMove = (token, roomId, uci) =>
  request(`/rooms/${roomId}/chess/moves`, {
    method: "POST",
    body: JSON.stringify({ uci }),
  }, token);
export const submitGolfScore = (token, roomId, strokes) =>
  request(`/rooms/${roomId}/golf/scores`, {
    method: "POST",
    body: JSON.stringify({ strokes }),
  }, token);
export const submitPoloScore = (token, roomId, goals) =>
  request(`/rooms/${roomId}/polo/scores`, {
    method: "POST",
    body: JSON.stringify({ goals }),
  }, token);
export const submitSnookerFrameScore = (token, roomId, breakPoints) =>
  request(`/rooms/${roomId}/snooker/scores`, {
    method: "POST",
    body: JSON.stringify({ break_points: breakPoints }),
  }, token);
export const getSoloDraughtsProgress = (token) =>
  request("/solo/draughts/progress", {}, token);
export const completeSoloDraughtsLevel = (token, level) =>
  request("/solo/draughts/progress/complete", {
    method: "POST",
    body: JSON.stringify({ level }),
  }, token);
export const getSoloGameProgress = (token, gameId) =>
  request(`/solo/${gameId}/progress`, {}, token);
export const getCurrentSoloGame = (token, gameId) =>
  request(`/solo/${gameId}/current`, {}, token);
export const startSoloGame = (token, gameId, level) =>
  request(`/solo/${gameId}/sessions`, {
    method: "POST",
    body: JSON.stringify({ level }),
  }, token);
export const submitSoloGameAction = (token, gameId, sessionId, action) =>
  request(`/solo/${gameId}/sessions/${sessionId}/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  }, token);
export const rollLudoDie = (token, roomId) =>
  request(`/rooms/${roomId}/roll`, {
    method: "POST",
    body: JSON.stringify({ client_seed: createClientSeed() }),
  }, token);
export const moveLudoToken = (token, roomId, tokenIndex) =>
  request(`/rooms/${roomId}/tokens/move`, {
    method: "POST",
    body: JSON.stringify({ token_index: tokenIndex }),
  }, token);
export const playWhotCard = (token, roomId, cardId, chosenSuit) =>
  request(`/rooms/${roomId}/cards/play`, {
    method: "POST",
    body: JSON.stringify({ card_id: cardId, chosen_suit: chosenSuit }),
  }, token);
export const drawWhotCard = (token, roomId) =>
  request(`/rooms/${roomId}/cards/draw`, { method: "POST" }, token);
export const getWallet = (token) => request("/wallet", {}, token);
export const getMyHostApplication = (token) =>
  request("/host/applications/me", {}, token);
export const requestHostRole = (token, motivation) =>
  request("/host/applications", {
    method: "POST",
    body: JSON.stringify({ motivation }),
  }, token);
export const proposeRulebook = (token, proposal) =>
  request("/rules/proposals", {
    method: "POST",
    body: JSON.stringify(proposal),
  }, token);
export const getAdminHostApplications = (token) =>
  request("/admin/host-applications", {}, token);
export const reviewHostApplication = (token, applicationId, decision, note) =>
  request(`/admin/host-applications/${applicationId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  }, token);
export const getAdminRuleProposals = (token) =>
  request("/admin/rule-proposals", {}, token);
export const reviewRuleProposal = (token, proposalId, decision, note) =>
  request(`/admin/rule-proposals/${proposalId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  }, token);
export const submitModerationReport = (token, report) =>
  request("/reports", {
    method: "POST",
    body: JSON.stringify(report),
  }, token);
export const getAdminReports = (token) => request("/admin/reports", {}, token);
export const getMyGameDispute = (token, roomId) =>
  request(`/rooms/${roomId}/disputes/me`, {}, token);
export const submitGameDispute = (token, roomId, details) =>
  request(`/rooms/${roomId}/disputes`, {
    method: "POST",
    body: JSON.stringify({ details }),
  }, token);
export const getAdminDisputes = (token) => request("/admin/disputes", {}, token);
export const reviewGameDispute = (token, disputeId, decision, resolution) =>
  request(`/admin/disputes/${disputeId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, resolution }),
  }, token);
export const reviewModerationReport = (token, reportId, decision, resolution) =>
  request(`/admin/reports/${reportId}/review`, {
    method: "POST",
    body: JSON.stringify({ decision, resolution }),
  }, token);

function createClientSeed() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random seed generation is unavailable in this browser.");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
