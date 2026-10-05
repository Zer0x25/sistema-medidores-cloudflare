import crypto from "node:crypto";
import { promisify } from "node:util";
import type { AuthUser } from "./types.js";

const scryptAsync = promisify(crypto.scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const keyBuffer = Buffer.from(keyHex, "hex");

  try {
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    if (derivedKey.length !== keyBuffer.length) return false;
    return crypto.timingSafeEqual(derivedKey, keyBuffer);
  } catch {
    return false;
  }
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function signJwt(payload: AuthUser, secret: string, expiresInSeconds = 28800): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const headerEncoded = base64url(JSON.stringify(header));
  const payloadEncoded = base64url(JSON.stringify(fullPayload));
  const dataToSign = `${headerEncoded}.${payloadEncoded}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(dataToSign)
    .digest();

  const signatureEncoded = base64url(signature);
  return `${dataToSign}.${signatureEncoded}`;
}

export function verifyJwt(token: string, secret: string): AuthUser {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Token JWT malformado");
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
  const dataToSign = `${headerEncoded}.${payloadEncoded}`;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(dataToSign)
    .digest();

  const expectedSignatureEncoded = base64url(expectedSignature);

  if (signatureEncoded !== expectedSignatureEncoded) {
    throw new Error("Firma JWT inválida");
  }

  const payloadJson = Buffer.from(payloadEncoded, "base64url").toString("utf8");
  const parsed = JSON.parse(payloadJson);

  const now = Math.floor(Date.now() / 1000);
  if (parsed.exp && parsed.exp < now) {
    throw new Error("Token JWT expirado");
  }

  return {
    id: parsed.id,
    email: parsed.email,
    nombre: parsed.nombre,
    rol: parsed.rol,
  };
}
