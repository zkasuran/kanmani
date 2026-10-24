export const ALLOWED: { advisory: string; package: string; nodes: string[]; dependents: string[] }[];
export function evaluate(
  audit: { vulnerabilities?: Record<string, any> },
  minLevel?: number,
  allowed?: typeof ALLOWED,
): { ok: boolean; unexpected: { name: string; severity: string; why?: string }[]; accepted: { name: string; severity: string }[] };
