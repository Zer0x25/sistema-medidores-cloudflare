// ==============================================================================
// MEDIDORES COMPONENT LIBRARY - FACTORIZACIÓN & REUTILIZACIÓN
// ADR 0002: Arquitectura del Frontend, Design System y Desacoplamiento de Lógica
// ==============================================================================

// ------------------------------------------------------------------------------
// 1. SISTEMA DE TOASTS (Notificaciones accesibles y efímeras)
// ------------------------------------------------------------------------------
class ToastManager {
  constructor() {
    this.container = null;
  }

  ensureContainer() {
    if (!this.container) {
      let el = document.getElementById("toastContainer");
      if (!el) {
        el = document.createElement("div");
        el.id = "toastContainer";
        el.className = "toast-container";
        document.body.appendChild(el);
      }
      this.container = el;
    }
    return this.container;
  }

  show(message, title = "", type = "info", duration = 4500) {
    const container = this.ensureContainer();
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const icons = {
      success: "✓",
      error: "✕",
      warning: "⚠",
      info: "ℹ",
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || "ℹ"}</div>
      <div class="toast-content">
        ${title ? `<div class="toast-title">${this.escape(title)}</div>` : ""}
        <div class="toast-desc">${this.escape(message)}</div>
      </div>
      <button class="btn-close" style="font-size: 1.1rem; padding: 0 0.25rem;" aria-label="Cerrar">&times;</button>
    `;

    const closeBtn = toast.querySelector(".btn-close");
    closeBtn.addEventListener("click", () => this.dismiss(toast));

    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }
  }

  dismiss(toast) {
    toast.classList.add("toast-hiding");
    setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast);
      }
    }, 250);
  }

  success(msg, title = "Éxito") { this.show(msg, title, "success"); }
  error(msg, title = "Error") { this.show(msg, title, "error", 6000); }
  warning(msg, title = "Atención") { this.show(msg, title, "warning", 5000); }
  info(msg, title = "") { this.show(msg, title, "info"); }

  escape(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
}

window.Toast = new ToastManager();

// ------------------------------------------------------------------------------
// 2. GESTIÓN UNIFICADA DE MODALES (ModalManager)
// ------------------------------------------------------------------------------
class ModalManager {
  constructor() {
    this.activeModal = null;
    this.initListeners();
  }

  initListeners() {
    // Cerrar al presionar tecla Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.activeModal) {
        this.close(this.activeModal.id);
      }
    });

    // Cerrar al hacer clic en el backdrop exterior
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) {
        this.close(e.target.id);
      }
    });
    // Inicializar data-state en modales existentes
    document.querySelectorAll(".modal-backdrop").forEach((m) => {
      if (!m.hasAttribute("data-state")) {
        m.setAttribute("data-state", m.classList.contains("open") ? "open" : "closed");
        m.setAttribute("aria-hidden", m.classList.contains("open") ? "false" : "true");
      }
    });
  }

  open(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("data-state", "open");
    modal.setAttribute("aria-hidden", "false");
    this.activeModal = modal;
    document.body.style.overflow = "hidden"; // Evitar scroll del fondo

    // Foco en el primer input accesible
    const firstInput = modal.querySelector("input, select, textarea");
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  close(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("data-state", "closed");
    modal.setAttribute("aria-hidden", "true");
    if (this.activeModal === modal) {
      this.activeModal = null;
    }
    document.body.style.overflow = "";
  }
}

window.Modal = new ModalManager();

// ------------------------------------------------------------------------------
// 3. FACTORÍA DE COMPONENTES ATÓMICOS (Presentación Pura)
// ------------------------------------------------------------------------------

/**
 * Resuelve el recurso y devuelve la clase semántica y el icono correspondiente.
 */
function getResourceMeta(recurso = "") {
  const norm = recurso.toLowerCase();
  if (norm.includes("agua")) {
    return { cssClass: "meter-water", badgeClass: "badge-water", icon: "💧", label: "Agua" };
  }
  if (norm.includes("electr") || norm.includes("luz") || norm.includes("energ")) {
    return { cssClass: "meter-elec", badgeClass: "badge-elec", icon: "⚡", label: "Electricidad" };
  }
  if (norm.includes("combust") || norm.includes("diesel") || norm.includes("petrol")) {
    return { cssClass: "meter-fuel", badgeClass: "badge-fuel", icon: "⛽", label: "Combustible" };
  }
  if (norm.includes("gas")) {
    return { cssClass: "meter-gas", badgeClass: "badge-gas", icon: "🔥", label: "Gas" };
  }
  return { cssClass: "meter-other", badgeClass: "badge-muted", icon: "⚙️", label: recurso || "General" };
}

/**
 * Parsea de manera segura cualquier fecha (ISO, SQLite 'YYYY-MM-DD HH:MM:SS', timestamp numérico, objeto Date).
 */
function parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === "number") {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === "string") {
    let cleaned = raw.trim();
    if (!cleaned) return null;
    // Si viene de SQLite como "YYYY-MM-DD HH:MM:SS", convertir espacio a 'T' y asumir UTC si no tiene timezone
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(cleaned)) {
      cleaned = cleaned.replace(" ", "T") + (cleaned.includes("Z") ? "" : "Z");
    }
    const d = new Date(cleaned);
    if (!isNaN(d.getTime())) return d;
    const fallback = new Date(raw);
    if (!isNaN(fallback.getTime())) return fallback;
  }
  return null;
}

/**
 * Formatea de forma segura fechas en formato chileno estándar sin arrojar 'Invalid Date'.
 */
function formatDate(raw, options = { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }, fallback = "--") {
  const d = parseDate(raw);
  if (!d) return fallback;
  try {
    return d.toLocaleString("es-CL", options);
  } catch (e) {
    return fallback;
  }
}

/**
 * Formatea valores numéricos con separador de miles y decimales estándar.
 */
function formatNumber(val, decimals = 2) {
  if (val === null || val === undefined) return "--";
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: Number.isInteger(val) ? 0 : 1,
    maximumFractionDigits: decimals,
  }).format(val);
}

/**
 * Ficha de Medidor Físico Reutilizable (Fase de Operador de Terreno / Catálogo)
 */
function createMeterCard(medidor) {
  const meta = getResourceMeta(medidor.tipoMedidor?.recurso);
  const tipo = medidor.tipoMedidor || {};
  const ultimaLectura = medidor.ultimaLectura;

  const lecturaValorFormatted = ultimaLectura
    ? formatNumber(ultimaLectura.valor)
    : "Sin lecturas";

  const rawFecha = ultimaLectura
    ? (ultimaLectura.fechaLectura || ultimaLectura.timestamp || ultimaLectura.fecha || ultimaLectura.createdAt)
    : null;

  const lecturaFechaFormatted = rawFecha
    ? formatDate(rawFecha, {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }, "Requiere registro inicial")
    : "Requiere registro inicial";

  return `
    <article class="meter-card ${meta.cssClass}" data-medidor-id="${medidor.id}">
      <div>
        <div class="meter-card-header">
          <div class="meter-card-ident">
            <span class="meter-code">${escapeHtml(medidor.codigo)}</span>
            <span class="meter-type-name">${escapeHtml(tipo.nombre || "Tipo no especificado")}</span>
          </div>
          <span class="badge ${meta.badgeClass}">
            ${meta.icon} ${escapeHtml(tipo.recurso || "Medidor")}
          </span>
        </div>

        <div class="meter-location">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          <span>${escapeHtml(medidor.ubicacionInterna)}</span>
        </div>

        <div class="meter-reading-box">
          <div class="reading-meta">
            <span class="reading-meta-label">Última Lectura Registrada</span>
            <span class="reading-meta-date">${lecturaFechaFormatted}</span>
          </div>
          <div class="reading-display">
            <span class="reading-value">${lecturaValorFormatted}</span>
            <span class="reading-unit">${escapeHtml(tipo.unidadMedida || tipo.unidad || "")}</span>
          </div>
        </div>
      </div>

      <button class="btn btn-primary" style="width: 100%;" onclick="openModalLectura('${medidor.id}')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Registrar Lectura
      </button>
    </article>
  `;
}

/**
 * Fila de Medidores Desatendidos (+24h)
 */
function createDesatendidoItem(d) {
  return `
    <div class="desatendido-item">
      <div>
        <h4>${escapeHtml(d.codigo)}</h4>
        <p>${escapeHtml(d.instalacionNombre)} &bull; ${escapeHtml(d.ubicacionInterna)}</p>
      </div>
      <div class="desatendido-delay">
        ${d.horasSinLectura !== null ? `+${d.horasSinLectura}h sin lectura` : "Sin lecturas"}
      </div>
    </div>
  `;
}

/**
 * Tarjeta de Consumo Neto por Instalación
 */
function createConsumoCard(c) {
  return `
    <div class="consumo-card">
      <div>
        <div class="consumo-facility">${escapeHtml(c.instalacionNombre)}</div>
        <span class="badge ${getResourceMeta(c.recurso).badgeClass}" style="margin-top: 0.25rem;">
          ${escapeHtml(c.recurso)}
        </span>
      </div>
      <div class="consumo-metrics">
        <span class="consumo-val">${formatNumber(c.consumoNeto)}</span>
        <span class="consumo-unit">${escapeHtml(c.unidadMedida)}</span>
      </div>
    </div>
  `;
}

/**
 * Fila de Actividad Reciente de Telemetría
 */
function createActivityItem(lec) {
  const meta = getResourceMeta(lec.medidor?.tipoMedidor?.recurso);
  const rawDate = lec.fechaLectura || lec.timestamp || lec.fecha || lec.createdAt;
  const fecha = formatDate(rawDate, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }, "--");

  return `
    <div class="activity-item">
      <div class="activity-icon" style="color: var(--meter-${meta.cssClass.replace('meter-', '')})">
        ${meta.icon}
      </div>
      <div class="activity-details">
        <div class="activity-title">${escapeHtml(lec.medidor?.codigo || "MED-???")}</div>
        <div class="activity-subtitle">${escapeHtml(lec.medidor?.instalacion?.nombre || "Instalación")} &bull; ${fecha}</div>
      </div>
      <div class="activity-value">
        ${formatNumber(lec.valor)} <span style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(lec.medidor?.tipoMedidor?.unidadMedida || "")}</span>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Crea el HTML para un estado visual de error recuperable (ADR 0009)
 */
function createErrorState(message, onRetryFnName = "") {
  return `
    <div class="empty-state error-recovery-state" data-testid="error-state" role="alert" style="text-align: center; padding: 2.5rem 1.5rem;">
      <div style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--color-danger, #ef4444);">
        ⚠️
      </div>
      <h4 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--text-main);">Error al cargar los datos</h4>
      <p style="margin: 0 0 1.25rem 0; font-size: 0.9rem; color: var(--text-muted); max-width: 400px; margin-inline: auto;">
        ${escapeHtml(message || "No se pudo establecer comunicación con el servidor. Verifique su red.")}
      </p>
      ${
        onRetryFnName
          ? `<button class="btn btn-secondary" data-testid="btn-retry" onclick="${escapeHtml(onRetryFnName)}()" style="display: inline-flex; align-items: center; gap: 0.5rem;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
              </svg>
              Reintentar
            </button>`
          : ""
      }
    </div>
  `;
}

function renderErrorState(container, message, onRetryCallback) {
  if (!container) return;
  const retryId = `retry-btn-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  container.innerHTML = `
    <div class="empty-state error-recovery-state" data-testid="error-state" role="alert" style="text-align: center; padding: 2.5rem 1.5rem;">
      <div style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--color-danger, #ef4444);">
        ⚠️
      </div>
      <h4 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--text-main);">Error al cargar los datos</h4>
      <p style="margin: 0 0 1.25rem 0; font-size: 0.9rem; color: var(--text-muted); max-width: 400px; margin-inline: auto;">
        ${escapeHtml(message || "No se pudo establecer comunicación con el servidor. Verifique su red.")}
      </p>
      ${
        onRetryCallback
          ? `<button id="${retryId}" data-testid="btn-retry" class="btn btn-secondary" style="display: inline-flex; align-items: center; gap: 0.5rem;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
              </svg>
              Reintentar
            </button>`
          : ""
      }
    </div>
  `;
  if (onRetryCallback) {
    const btn = document.getElementById(retryId);
    if (btn) btn.addEventListener("click", onRetryCallback);
  }
}

/**
 * Fila para la tabla de gestión de Instalaciones (ADMIN)
 */
function createInstalacionRow(inst) {
  const codigo = inst.codigo || "—";
  const activaBadge = inst.activa
    ? '<span class="badge badge-emerald">Activa</span>'
    : '<span class="badge badge-amber">Archivada</span>';

  const graciaBadge = inst.enPeriodoGracia
    ? `<span class="badge badge-blue" title="Editable / Borrable">⚡ ${inst.diasRestantesGracia ?? 30}d gracia</span>`
    : `<span class="badge badge-muted" title="Código inmutable">🔒 Cristalizado</span>`;

  return `
    <tr data-instalacion-id="${inst.id}">
      <td><span class="badge font-mono badge-blue">${escapeHtml(codigo)}</span></td>
      <td><strong>${escapeHtml(inst.nombre)}</strong></td>
      <td>${escapeHtml(inst.ubicacion || inst.direccion || "—")}</td>
      <td>${activaBadge}</td>
      <td>${graciaBadge}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-xs btn-outline" onclick="abrirModalEditarInstalacion('${inst.id}')" title="Editar instalación">
          ✏️ Editar
        </button>
        ${
          inst.activa
            ? `<button class="btn btn-xs btn-outline text-amber" onclick="archivarInstalacion('${inst.id}')" title="Archivar sede (Soft Delete)">📦 Archivar</button>`
            : `<button class="btn btn-xs btn-outline text-emerald" onclick="restaurarInstalacion('${inst.id}')" title="Restaurar sede">♻️ Restaurar</button>`
        }
        ${
          inst.enPeriodoGracia
            ? `<button class="btn btn-xs btn-danger" onclick="eliminarInstalacionFisica('${inst.id}')" title="Eliminar definitivamente (Marcha blanca)">🗑️ Eliminar</button>`
            : ""
        }
      </td>
    </tr>
  `;
}

/**
 * Fila para la tabla de gestión de Medidores (ADMIN)
 */
function createMedidorRow(medidor) {
  const tipo = medidor.tipoMedidor || {};
  const meta = getResourceMeta(tipo.recurso);
  const activoBadge = medidor.activo
    ? '<span class="badge badge-emerald">Activo</span>'
    : '<span class="badge badge-amber">Archivado</span>';

  const graciaBadge = medidor.enPeriodoGracia
    ? `<span class="badge badge-blue" title="Editable / Borrable">⚡ ${medidor.diasRestantesGracia ?? 30}d gracia</span>`
    : `<span class="badge badge-muted" title="Código inmutable">🔒 Cristalizado</span>`;

  const sedeNombre = medidor.instalacion?.nombre || "—";

  return `
    <tr data-medidor-id="${medidor.id}">
      <td><span class="badge font-mono ${meta.badgeClass}">${escapeHtml(medidor.codigo)}</span></td>
      <td>${escapeHtml(sedeNombre)}</td>
      <td>${meta.icon} ${escapeHtml(tipo.nombre || tipo.recurso || "—")}</td>
      <td>${escapeHtml(medidor.ubicacionInterna || "—")}</td>
      <td><span class="font-mono text-muted">${escapeHtml(medidor.numeroSerie || "—")}</span></td>
      <td>${activoBadge}</td>
      <td>${graciaBadge}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button class="btn btn-xs btn-outline" onclick="abrirModalEditarMedidor('${medidor.id}')" title="Editar medidor">
          ✏️ Editar
        </button>
        ${
          medidor.activo
            ? `<button class="btn btn-xs btn-outline text-amber" onclick="archivarMedidor('${medidor.id}')" title="Archivar medidor (Soft Delete)">📦 Archivar</button>`
            : `<button class="btn btn-xs btn-outline text-emerald" onclick="restaurarMedidor('${medidor.id}')" title="Restaurar medidor">♻️ Restaurar</button>`
        }
        ${
          medidor.enPeriodoGracia
            ? `<button class="btn btn-xs btn-danger" onclick="eliminarMedidorFisico('${medidor.id}')" title="Eliminar definitivamente (Marcha blanca)">🗑️ Eliminar</button>`
            : ""
        }
      </td>
    </tr>
  `;
}

// Exportar funciones a la ventana global
window.Components = {
  parseDate,
  formatDate,
  getResourceMeta,
  formatNumber,
  createMeterCard,
  createDesatendidoItem,
  createConsumoCard,
  createActivityItem,
  createErrorState,
  renderErrorState,
  createInstalacionRow,
  createMedidorRow,
};

// ------------------------------------------------------------------------------
// 8. CONTROLADOR DE MENÚ MÓVIL Y DRAWER ACCESIBLE (ADR 0010)
// ------------------------------------------------------------------------------
class MobileMenuManager {
  constructor() {
    this.initListeners();
  }

  toggle() {
    if (document.body.classList.contains("not-authenticated")) return;
    const drawer = document.getElementById("mobileMenuDrawer");
    if (drawer && drawer.classList.contains("open")) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    if (document.body.classList.contains("not-authenticated")) return;
    const drawer = document.getElementById("mobileMenuDrawer");
    const backdrop = document.getElementById("mobileDrawerBackdrop");
    const toggleBtn = document.getElementById("btnMobileMenuToggle");
    if (drawer) {
      drawer.classList.add("open");
      drawer.setAttribute("aria-hidden", "false");
    }
    if (backdrop) {
      backdrop.classList.add("open");
    }
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", "true");
    }
    document.body.style.overflow = "hidden";
  }

  close() {
    const drawer = document.getElementById("mobileMenuDrawer");
    const backdrop = document.getElementById("mobileDrawerBackdrop");
    const toggleBtn = document.getElementById("btnMobileMenuToggle");
    if (drawer) {
      drawer.classList.remove("open");
      drawer.setAttribute("aria-hidden", "true");
    }
    if (backdrop) {
      backdrop.classList.remove("open");
    }
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", "false");
    }
    document.body.style.overflow = "";
  }

  initListeners() {
    // Cerrar al pulsar Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.close();
      }
    });

    // Cerrar automáticamente si la ventana se amplía a desktop
    window.addEventListener("resize", () => {
      if (window.innerWidth >= 768) {
        this.close();
      }
    });
  }
}

window.MobileMenu = new MobileMenuManager();
window.toggleMobileMenu = () => window.MobileMenu.toggle();
window.openMobileMenu = () => window.MobileMenu.open();
window.closeMobileMenu = () => window.MobileMenu.close();

