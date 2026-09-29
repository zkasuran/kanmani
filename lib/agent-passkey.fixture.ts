/**
 * A software authenticator that emits exactly what a browser's WebAuthn returns. Test fixture only.
 */
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";

export function softAuthenticator() {
  const sk = p256.utils.randomPrivateKey();
  const pub = p256.getPublicKey(sk, false);
  // SPKI header for id-ecPublicKey + prime256v1, then the 65-byte point: what getPublicKey() returns.
  const spki = new Uint8Array([...Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"), ...pub]);
  const get = (challenge: Uint8Array, flags = 0x05) => {
    const authenticatorData = new Uint8Array([...sha256(new TextEncoder().encode("kanmani.xyz")), flags, 0, 0, 0, 9]);
    const b64 = Buffer.from(challenge).toString("base64url");
    const clientDataJSON = new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: b64, origin: "https://kanmani.xyz", crossOrigin: false }));
    const digest = sha256(new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]));
    const signature = p256.sign(digest, sk, { prehash: false }).toDERRawBytes();
    return { authenticatorData, clientDataJSON, signature };
  };
  return { spki, pub, get };
}

