function hexToBytes(value) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("The fairness proof contains an invalid seed.");
  }
  return Uint8Array.from(value.match(/.{2}/g), (byte) => parseInt(byte, 16));
}

async function deriveDie(serverSeed, clientSeed, nonce) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(serverSeed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hashSpace = 1n << 256n;
  const limit = hashSpace - hashSpace % 6n;

  for (let attempt = 0; ; attempt += 1) {
    const message = encoder.encode(`${clientSeed}:${nonce}:${attempt}`);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
    const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const value = BigInt(`0x${hex}`);
    if (value < limit) return Number(value % 6n) + 1;
  }
}

export async function verifyLudoProof(proof) {
  if (!proof?.available || !proof.server_seed || !proof.server_seed_hash) return false;
  const commitment = new Uint8Array(
    await crypto.subtle.digest("SHA-256", hexToBytes(proof.server_seed)),
  );
  const commitmentHex = Array.from(commitment, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  if (commitmentHex !== proof.server_seed_hash) return false;

  for (const roll of proof.rolls) {
    if (!Number.isInteger(roll.nonce) || roll.nonce < 0) return false;
    hexToBytes(roll.client_seed);
    if (await deriveDie(proof.server_seed, roll.client_seed, roll.nonce) !== roll.value) {
      return false;
    }
  }
  return true;
}
