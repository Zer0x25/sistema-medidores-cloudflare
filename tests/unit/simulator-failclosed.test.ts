import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(__dirname, "..", "..", "public");

describe("Simulador de rol fail-closed (solo dev)", () => {
  it("roleSimulatorBar debe estar oculto por defecto en el HTML", () => {
    const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
    const tag = html.match(/<div[^>]*id="roleSimulatorBar"[^>]*>/)?.[0] || "";
    expect(tag).toContain("display: none");
  });

  it("mobile-simulator-section debe estar oculta por defecto en el HTML", () => {
    const html = readFileSync(join(PUBLIC, "index.html"), "utf8");
    const tag = html.match(/<div[^>]*class="mobile-simulator-section"[^>]*>/)?.[0] || "";
    expect(tag).toContain("display: none");
  });

  it("app.js solo debe revelar el simulador cuando devRoleSwitcher es true", () => {
    const js = readFileSync(join(PUBLIC, "app.js"), "utf8");
    expect(js).toContain("devRoleSwitcher");
    expect(js).toContain('roleSimulatorBar) roleSimulatorBar.style.display = "none"');
  });
});
