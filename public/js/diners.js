// Diners (party size) persistence — local-only because the backend has no field for it.
// Keyed by orden id so it survives reloads but resets when the orden closes.

const PREFIX = 'pos.diners:';

export function getDiners(ordenId) {
  if (!ordenId) return null;
  const v = localStorage.getItem(PREFIX + ordenId);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function setDiners(ordenId, n) {
  if (!ordenId) return;
  const num = Math.max(1, Math.min(20, Math.floor(Number(n) || 0)));
  localStorage.setItem(PREFIX + ordenId, String(num));
}

export function clearDiners(ordenId) {
  if (!ordenId) return;
  localStorage.removeItem(PREFIX + ordenId);
}
