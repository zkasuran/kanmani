export const GROWING: string[];
export const APPEND_ONLY: string[];
export const SWEEP_STATE: string[];
export const BASE_ALLOWANCE: number;
export const PER_DAY_ALLOWANCE: number;
export const MAX_ALLOWANCE: number;
export const SWEEP_FLOOR: number;
export function allowance(ageDays: number): number;
export function driftVerdict(key: string, was: number, now: number, ageDays: number): { ok: boolean; within?: number };
