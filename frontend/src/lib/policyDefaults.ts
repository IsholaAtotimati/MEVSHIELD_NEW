const KEY = "mevshield-policy-defaults";

export type PolicyDefaults = {
  slippageBps: number;
  maxLoss: string;
  maxFee: string;
};

const FALLBACK: PolicyDefaults = {
  slippageBps: 50,
  maxLoss: "1000000",
  maxFee: "100000",
};

export function loadPolicyDefaults(): PolicyDefaults {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return FALLBACK;
    const parsed = JSON.parse(raw) as PolicyDefaults;
    return { ...FALLBACK, ...parsed };
  } catch {
    return FALLBACK;
  }
}

export function savePolicyDefaults(value: PolicyDefaults): void {
  localStorage.setItem(KEY, JSON.stringify(value));
}
