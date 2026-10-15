import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Exclusivo de desarrollo: nunca reutiliza secretos productivos ni imprime valores.
const output = process.argv[2] || ".dev.vars";
if (existsSync(output)) {
  console.log("Variables locales existentes conservadas.");
} else {
  const template = readFileSync(new URL("../.dev.vars.example", import.meta.url), "utf8");
  const content = template.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${randomBytes(48).toString("base64url")}"`);
  writeFileSync(output, content, { mode: 0o600, flag: "wx" });
  console.log("Variables locales creadas con una clave aleatoria privada.");
}
