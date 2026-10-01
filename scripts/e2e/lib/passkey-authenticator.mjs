/**
 * One Chrome virtual authenticator with PRF on, driven over raw CDP.
 *
 * Mera's whole account layer is the WebAuthn PRF extension, so the suites that exercise it need an
 * authenticator that evaluates `prf`. Playwright's first-class `browserContext.credentials` carries
 * no PRF field, so this uses the CDP WebAuthn domain directly, which does.
 *
 * This is the shared contract named in the Mera specs. The stateless suite (1.4) and the cross-device
 * suite (2.1) both import it and neither forks it. First writer owns, the others import. Do not change
 * these signatures without changing both callers.
 *
 * The options below are load-bearing. `hasPrf` turns on the extension Mera requests, `ctap2_1` is the
 * CTAP version hmac-secret needs, `internal` is the platform-authenticator (synced-passkey) shape and
 * `isUserVerified` plus `automaticPresenceSimulation` mean the ceremony never waits on a human gesture.
 */

/** The exact authenticator shape both suites must send, so PRF actually turns on. */
export const PRF_AUTHENTICATOR_OPTIONS = {
  protocol: "ctap2",
  ctap2Version: "ctap2_1",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
  hasPrf: true,
  hasHmacSecret: true,
};

/** Enable the WebAuthn domain and add one PRF-capable virtual authenticator to this page's context. */
export async function addPrfAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: PRF_AUTHENTICATOR_OPTIONS,
  });
  return { cdp, authenticatorId };
}

/** Read back the one discoverable credential, so a second authenticator can be seeded with it. */
export async function getCredential(cdp, authenticatorId) {
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  return credentials[0] ?? null;
}

/** Inject a credential into an authenticator. */
export async function addCredential(cdp, authenticatorId, cred) {
  await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: cred });
}

/**
 * Add a PRF authenticator to a fresh page then inject a credential into it, for the second device.
 *
 * Note the known limit, proven from the Chromium source: the exported credential carries no PRF
 * secret, so a fresh authenticator seeded this way derives a DIFFERENT PRF output. The cross-device
 * suite probes this first and falls back to the offline determinism vector plus the live clip rather
 * than reporting a cross-context pass the probe did not produce.
 */
export async function cloneCredentialTo(pageB, cred) {
  const { cdp, authenticatorId } = await addPrfAuthenticator(pageB);
  await addCredential(cdp, authenticatorId, cred);
  return { cdp, authenticatorId };
}

/** Drop every credential, so each loop iteration starts with no passkey and sign-in is unambiguous. */
export async function clearCredentials(cdp, authenticatorId) {
  await cdp.send("WebAuthn.clearCredentials", { authenticatorId });
}
