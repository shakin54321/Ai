import nacl from "tweetnacl";

export function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKeyHex: string,
): boolean {
  try {
    const message = new TextEncoder().encode(timestamp + body);
    const sig = hexToBytes(signature);
    const publicKey = hexToBytes(publicKeyHex);
    return nacl.sign.detached.verify(message, sig, publicKey);
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex");
  }
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}
