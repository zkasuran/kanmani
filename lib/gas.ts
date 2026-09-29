/**
 * Whether an address can afford the transaction it is about to send, stated before it is sent.
 *
 * A registration cannot be relayed: the registry makes `msg.sender` the owner, so a relayer would own
 * the agent. The sender pays its own gas. A fresh passkey account starts with none. Finding that
 * out from a failed send is the worst place to learn it, so the studio asks first.
 *
 * The estimate is multiplied by a margin because gas price moves between estimate and send. Too
 * little margin fails the send. Too much only means asking for a little more than needed, which the
 * sender keeps.
 *
 * Pure, so the rule is tested. Balance and estimate are read by the caller.
 */

/** 1.5x: covers a base-fee rise between estimate and inclusion without asking for a lot extra. */
export const GAS_MARGIN_NUM = 3n;
export const GAS_MARGIN_DEN = 2n;

export type GasCheck =
  | { state: "enough"; needWei: bigint; haveWei: bigint }
  | { state: "short"; needWei: bigint; haveWei: bigint; shortWei: bigint }
  /** The balance or the estimate could not be read. Never treated as enough or as short. */
  | { state: "unknown"; reason: string };

export function gasCheck(haveWei: bigint | null, gasUnits: bigint | null, gasPriceWei: bigint | null, reason = "could not read"): GasCheck {
  if (haveWei === null || gasUnits === null || gasPriceWei === null) return { state: "unknown", reason };
  if (haveWei < 0n || gasUnits < 0n || gasPriceWei < 0n) return { state: "unknown", reason: "a negative reading" };
  const needWei = (gasUnits * gasPriceWei * GAS_MARGIN_NUM + GAS_MARGIN_DEN - 1n) / GAS_MARGIN_DEN;
  if (haveWei >= needWei) return { state: "enough", needWei, haveWei };
  return { state: "short", needWei, haveWei, shortWei: needWei - haveWei };
}

/**
 * Wei as a short decimal for display, cut rather than rounded so it never shows more than is held.
 * Keeps enough places that a small gas cost is not shown as zero.
 */
export function formatNative(wei: bigint, places = 6): string {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0");
  let cut = frac.slice(0, places).replace(/0+$/, "");
  // A nonzero amount below the shown precision gets more places rather than reading as 0.
  if (!cut && whole === 0n && v > 0n) {
    const first = frac.search(/[1-9]/);
    cut = frac.slice(0, first + 2).replace(/0+$/, "");
  }
  return `${neg ? "-" : ""}${whole}${cut ? `.${cut}` : ""}`;
}
