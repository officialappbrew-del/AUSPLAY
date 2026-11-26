const BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");

async function request(path, options = {}, token) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((issue) => {
        const field = Array.isArray(issue.loc) ? issue.loc.slice(1).join(".") : "";
        return `${field ? `${field}: ` : ""}${issue.msg || "Invalid input"}`;
      }).join("; ")
      : data.detail;
    throw new Error(typeof detail === "string" && detail ? detail : "Something went wrong");
  }
  return data;
}

export const register = (username, password, ageConfirmed) =>
  request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, age_confirmed: ageConfirmed }),
  });
export const login = (username, password) =>
  request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
export const getMe = (token) => request("/me", {}, token);
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
export const getPracticeGame = (token, roomId) =>
  request(`/rooms/${roomId}/game`, {}, token);
export const getPracticeRoomChat = (token, roomId) =>
  request(`/rooms/${roomId}/chat`, {}, token);
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
