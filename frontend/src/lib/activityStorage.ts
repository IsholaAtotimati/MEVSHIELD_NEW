import type { ActivityRow } from "./types";

const STORAGE_KEY = "mevshield-activity-v1";

export function loadStoredActivity(): ActivityRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActivityRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendActivity(row: ActivityRow): void {
  const existing = loadStoredActivity();
  const next = [row, ...existing.filter((item) => item.id !== row.id)].slice(
    0,
    200,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function activityToCsv(rows: ActivityRow[]): string {
  const header =
    "time,pair,amountIn,amountOut,minAmountOut,status,txHash,policyId";
  const lines = rows.map((row) =>
    [
      new Date(row.time).toISOString(),
      row.pair,
      row.amountIn,
      row.amountOut,
      row.minAmountOut,
      row.status,
      row.txHash ?? "",
      row.policyId ?? "",
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  );
  return [header, ...lines].join("\n");
}
