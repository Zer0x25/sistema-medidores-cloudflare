// ==============================================================================
// MEDIDORES THEME ENGINE - GESTIÓN MODO CLARO / OSCURO
// ADR 0002: Arquitectura del Frontend, Design System y Desacoplamiento de Lógica
// ==============================================================================

const THEME_STORAGE_KEY = "medidores-theme";

class ThemeEngine {
  constructor() {
    this.currentTheme = "dark";
    this.mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  }

  init() {
    // 1. Resolver preferencia almacenada o del sistema
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      this.setTheme(savedTheme, false);
    } else {
      const preferred = this.mediaQuery.matches ? "dark" : "light";
      this.setTheme(preferred, false);
    }

    // 2. Escuchar cambios del sistema operativo si el usuario no forzó preferencia
    this.mediaQuery.addEventListener("change", (e) => {
      if (!localStorage.getItem(THEME_STORAGE_KEY)) {
        this.setTheme(e.matches ? "dark" : "light", false);
      }
    });
  }

  setTheme(theme, save = true) {
    this.currentTheme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;

    if (save) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    this.updateToggleUi();
  }

  toggle() {
    const nextTheme = this.currentTheme === "dark" ? "light" : "dark";
    this.setTheme(nextTheme, true);
    if (window.Toast) {
      window.Toast.info(
        nextTheme === "dark" ? "Modo Oscuro activado (Deep Slate)" : "Modo Claro activado (Crisp Studio)",
        "Apariencia"
      );
    }
  }

  updateToggleUi() {
    const btn = document.getElementById("themeToggleBtn");
    if (!btn) return;
    const isDark = this.currentTheme === "dark";
    btn.setAttribute("aria-label", isDark ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro");
    btn.setAttribute("title", isDark ? "Cambiar a Modo Claro" : "Cambiar a Modo Oscuro");
  }
}

window.Theme = new ThemeEngine();

// Auto-inicializar cuando el DOM esté disponible
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => window.Theme.init());
} else {
  window.Theme.init();
}
