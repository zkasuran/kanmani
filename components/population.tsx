/**
 * Where every checked document landed, drawn as one proportional field instead of four tiles and a bar.
 *
 * The population is dominated by documents that assert no payment at all (1,095 of 1,192), so a single
 * bar makes the part that matters, the 85 that do claim a payment, a sliver. This draws two rows: the
 * whole population, then the payment claims enlarged to full width, joined by a bracket so a reader sees
 * that the second row is a zoom of one segment of the first. Then the payment row splits the false
 * verdicts into mislabelled and nowhere, which is the correction the landing makes.
 *
 * Server-rendered, no motion, correct in any capture. Colour carries status only. Every segment has a
 * direct label so it reads without a legend and with colour removed.
 */

type Seg = { key: string; label: string; n: number; tone: "noclaim" | "true" | "brand" | "false" | "unknown" };

function Row({ segs, total, caption }: { segs: Seg[]; total: number; caption: string }) {
  const shown = segs.filter((x) => x.n > 0);
  return (
    <div className="pop__row">
      <div className="pop__caption">{caption}</div>
      <div className="pop__bar" role="img" aria-label={`${caption}: ${shown.map((x) => `${x.n} ${x.label}`).join(", ")}`}>
        {shown.map((x) => (
          <span key={x.key} className={`pop__seg pop__seg--${x.tone}`} style={{ flexGrow: x.n, flexBasis: 0 }} title={`${x.n.toLocaleString("en-US")} ${x.label}`} />
        ))}
      </div>
      <ul className="pop__labels">
        {shown.map((x) => (
          <li key={x.key}>
            <b className={`pop__n pop__n--${x.tone}`}>{x.n.toLocaleString("en-US")}</b> {x.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Population({
  noClaim,
  onNamed,
  elsewhere,
  nowhere,
  unknown,
  paymentOnly = false,
}: {
  noClaim: number;
  onNamed: number;
  elsewhere: number;
  nowhere: number;
  unknown: number;
  /** One agent's split. The corpus row adds nothing when nearly every checked claim is a payment claim. */
  paymentOnly?: boolean;
}) {
  const payment = onNamed + elsewhere + nowhere;
  const total = noClaim + payment + unknown;
  if (paymentOnly) {
    return (
      <figure className="pop">
        <Row
          caption={`${payment} payment claims`}
          total={payment}
          segs={[
            { key: "t", label: "on the chain they name", n: onNamed, tone: "true" },
            { key: "e", label: "real payment, wrong chain named", n: elsewhere, tone: "brand" },
            { key: "f", label: "on no chain we can read", n: nowhere, tone: "false" },
          ]}
        />
      </figure>
    );
  }
  return (
    <figure className="pop">
      <Row
        caption={`all ${total.toLocaleString("en-US")} checked documents`}
        total={total}
        segs={[
          { key: "nc", label: "assert no payment", n: noClaim, tone: "noclaim" },
          { key: "pc", label: "claim a payment", n: payment, tone: "brand" },
          { key: "uk", label: "could not check", n: unknown, tone: "unknown" },
        ]}
      />
      <div className="pop__zoom" aria-hidden="true">
        <span>the {payment} that claim a payment, enlarged</span>
      </div>
      <Row
        caption={`${payment} payment claims`}
        total={payment}
        segs={[
          { key: "t", label: "on the chain they name", n: onNamed, tone: "true" },
          { key: "e", label: "real payment, wrong chain named", n: elsewhere, tone: "brand" },
          { key: "f", label: "on no chain we can read", n: nowhere, tone: "false" },
        ]}
      />
    </figure>
  );
}
