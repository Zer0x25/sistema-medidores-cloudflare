// ==============================================================================
// MEDIDORES APP CONTROLLER - ORQUESTACIÓN DE VISTA Y EVENTOS
// ADR 0002: Arquitectura del Frontend, Design System y Desacoplamiento de Lógica
// SPEC-005: Control de Acceso RBAC (Admin, Supervisor, Operador)
// ==============================================================================

let currentUser = null; // { id, email, nombre, rol }
let currentRoleTab = "admin";
let instalacionesCache = [];
let tiposMedidorCache = [];
let medidoresOperadorCache = [];
let systemConfig = {
  env: "development",
  features: { devRoleSwitcher: true },
};

let sessionSyncPromise = null;

// Inicialización del Ciclo de Vida
document.addEventListener("DOMContentLoaded", () => {
  inicializarApp();
});

async function cargarConfiguracionSistema() {
  try {
    const res = await window.api.config.get();
    if (res && res.features) {
      systemConfig = res;
    }
  } catch (err) {
    console.warn("No se pudo obtener /api/config, usando defaults de desarrollo:", err);
  }

  const roleSimulatorBar = document.getElementById("roleSimulatorBar");
  const mobileSimulatorSection = document.querySelector(".mobile-simulator-section");
  const loginDevBox = document.getElementById("loginDevQuickAccess");

  if (!systemConfig.features?.devRoleSwitcher) {
    if (roleSimulatorBar) roleSimulatorBar.style.display = "none";
    if (mobileSimulatorSection) mobileSimulatorSection.style.display = "none";
    if (loginDevBox) loginDevBox.style.display = "none";
  } else {
    if (roleSimulatorBar) roleSimulatorBar.style.display = "";
    if (mobileSimulatorSection) mobileSimulatorSection.style.display = "";
    if (loginDevBox) loginDevBox.style.display = "block";
  }
}

async function inicializarApp() {
  if (window.syncManager) {
    window.syncManager.init();
    window.syncManager.onSyncComplete(async () => {
      const select = document.getElementById("selectOperadorInstalacion");
      if (select && select.value) {
        await cargarMedidoresInstalacion(select.value);
      }
      if (currentRoleTab === "admin") {
        await cargarDashboard();
      }
    });
  }

  // Manejo Global de Expiración de Sesión (ADR 0009 / Hito 12 / ADR 0012)
  window.addEventListener("medidores:session-expired", () => {
    currentUser = null;
    mostrarPantallaLogin();
    window.Toast.warning("Tu sesión ha expirado. Por favor ingresa nuevamente.", "Sesión Expirada");
  });

  sessionSyncPromise = sincronizarSesionUsuario();
  await sessionSyncPromise;
  if (currentUser) {
    await cargarSelectsGlobales();
    if (currentUser.rol === "OPERADOR") {
      switchRole("operador");
    } else {
      await cargarDashboard();
    }
  }
}

// ------------------------------------------------------------------------------
// 1. GESTIÓN DE SESIÓN Y AUTENTICACIÓN (JWT & RBAC)
// ------------------------------------------------------------------------------
function mostrarPantallaLogin() {
  document.body.classList.add("not-authenticated");

  const views = document.querySelectorAll(".view-panel");
  views.forEach((v) => v.classList.remove("active"));

  const viewLogin = document.getElementById("viewLogin");
  if (viewLogin) viewLogin.classList.add("active");

  const passInput = document.getElementById("loginPassword");
  const errAlert = document.getElementById("loginErrorAlert");
  if (passInput) passInput.value = "";
  if (errAlert) errAlert.style.display = "none";
}

function mostrarAppPrincipal() {
  if (!currentUser) {
    mostrarPantallaLogin();
    return;
  }

  document.body.classList.remove("not-authenticated");

  const viewLogin = document.getElementById("viewLogin");
  if (viewLogin) viewLogin.classList.remove("active");

  if (currentUser?.rol === "OPERADOR") {
    switchRole("operador");
  } else {
    switchRole("admin");
  }
}

async function sincronizarSesionUsuario() {
  await cargarConfiguracionSistema();

  const token = window.api.getToken();
  if (token) {
    try {
      currentUser = await window.api.auth.me();
      mostrarAppPrincipal();
      aplicarPermisosUI();
      return;
    } catch {
      window.api.clearToken();
      currentUser = null;
    }
  }

  // Si no hay sesión o expiró:
  // En Staging/Prod (devRoleSwitcher === false), obligar a login sin auto-login
  if (!systemConfig.features?.devRoleSwitcher) {
    mostrarPantallaLogin();
    return;
  }

  // En Dev (devRoleSwitcher === true): si el usuario cerró sesión voluntariamente, mostrar login
  if (sessionStorage.getItem("user_logged_out") === "true") {
    mostrarPantallaLogin();
    return;
  }

  // En Dev: auto-login por defecto como Admin para agilidad
  try {
    const auth = await window.api.auth.login({
      email: "admin@medidores.cl",
      password: "demo1234",
    });
    currentUser = auth.usuario;
    mostrarAppPrincipal();
    aplicarPermisosUI();
  } catch {
    currentUser = {
      id: "demo-admin-id",
      email: "admin@medidores.cl",
      nombre: "Administrador Central",
      rol: "ADMIN",
    };
    mostrarAppPrincipal();
    aplicarPermisosUI();
  }
}

async function cerrarSesion() {
  window.api.auth.logout();
  currentUser = null;
  sessionStorage.setItem("user_logged_out", "true");
  mostrarPantallaLogin();
  window.Toast.info("Sesión finalizada correctamente.", "Autenticación");
}

async function handleLoginSubmit(e) {
  if (e) e.preventDefault();
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  const submitBtn = document.getElementById("btnLoginSubmit");
  const btnText = document.getElementById("btnLoginText");
  const btnSpinner = document.getElementById("btnLoginSpinner");
  const errAlert = document.getElementById("loginErrorAlert");
  const errMsg = document.getElementById("loginErrorMessage");

  if (!emailInput || !passwordInput) return;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    if (errAlert && errMsg) {
      errMsg.textContent = "Por favor ingrese su correo y contraseña.";
      errAlert.style.display = "flex";
    }
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (btnText) btnText.textContent = "Verificando...";
  if (btnSpinner) btnSpinner.style.display = "inline-block";
  if (errAlert) errAlert.style.display = "none";

  try {
    const res = await window.api.auth.login({ email, password });
    sessionStorage.removeItem("user_logged_out");
    currentUser = res.usuario;
    window.Toast.success(`Bienvenido/a, ${currentUser.nombre}`, "Inicio de Sesión");

    mostrarAppPrincipal();
    aplicarPermisosUI();
    await cargarSelectsGlobales();
    if (currentUser.rol === "OPERADOR") {
      switchRole("operador");
    } else {
      switchRole("admin");
      await cargarDashboard();
    }
  } catch (err) {
    if (errAlert && errMsg) {
      if (err.status === 401 || err.statusCode === 401) {
        errMsg.textContent = "Correo o contraseña incorrectos.";
      } else if (err.status === 429 || err.statusCode === 429) {
        errMsg.textContent = err.message || "Demasiados intentos. Por favor espere unos momentos.";
      } else {
        errMsg.textContent = err.message || "No se pudo conectar con el servidor.";
      }
      errAlert.style.display = "flex";
    }
    window.Toast.error(err.message || "Credenciales inválidas", "Error de Autenticación");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (btnText) btnText.textContent = "Ingresar al Sistema";
    if (btnSpinner) btnSpinner.style.display = "none";
  }
}

function autofillAndLogin(email, pass) {
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");
  if (emailInput) emailInput.value = email;
  if (passwordInput) passwordInput.value = pass;
  handleLoginSubmit();
}

function toggleLoginPasswordVisibility() {
  const input = document.getElementById("loginPassword");
  const btn = document.getElementById("btnTogglePassword");
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    if (btn) btn.textContent = "🔒";
  } else {
    input.type = "password";
    if (btn) btn.textContent = "👁️";
  }
}

/**
 * Conmuta rápidamente la sesión entre los 3 roles de prueba (ADMIN, SUPERVISOR, OPERADOR)
 */
async function loginComo(rol) {
  sessionStorage.removeItem("user_logged_out");
  const creds = {
    ADMIN: { email: "admin@medidores.cl", pass: "demo1234" },
    SUPERVISOR: { email: "supervisor@medidores.cl", pass: "demo1234" },
    OPERADOR: { email: "operador@medidores.cl", pass: "demo1234" },
  }[rol];

  if (!creds) return;

  try {
    const res = await window.api.auth.login({
      email: creds.email,
      password: creds.pass,
    });
    currentUser = res.usuario;
    window.Toast.success(`Sesión iniciada como ${currentUser.nombre} (${currentUser.rol})`, "Autenticación");

    mostrarAppPrincipal();
    aplicarPermisosUI();

    // Actualizar vista según el nuevo rol
    if (currentUser.rol === "OPERADOR") {
      switchRole("operador");
    } else {
      switchRole("admin");
      await cargarDashboard();
    }
    await cargarSelectsGlobales();
  } catch (err) {
    window.Toast.error(err.message, "Fallo de Inicio de Sesión");
  }
}

/**
 * Aplica las reglas visuales estrictas según el Rol:
 * - ADMIN: acceso global, crear instalación, crear medidor, crear tipo.
 * - SUPERVISOR: NO puede crear instalaciones ni tipos; SÍ puede crear medidores en sedes asignadas.
 * - OPERADOR: solo ingreso en terreno; sin dashboard ni altas de medidor/instalación.
 */
function aplicarPermisosUI() {
  if (!currentUser) return;

  // 1. Navbar: Usuario activo y badge de rol y botón de cambio de clave
  const userPill = document.getElementById("navUserPill");
  const mobileUserSection = document.getElementById("mobileUserSection");
  const roleBadgeClasses = {
    ADMIN: "badge-blue",
    SUPERVISOR: "badge-amber",
    OPERADOR: "badge-emerald",
  };

  if (userPill) {
    userPill.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">${currentUser.nombre}</span>
        <span class="badge ${roleBadgeClasses[currentUser.rol] || 'badge-muted'}">${currentUser.rol}</span>
        <button class="btn btn-outline btn-sm" id="btnOpenModalCambiarPassword" onclick="openModal('modalCambiarPassword')" title="Cambiar mi contraseña" style="padding: 0.2rem 0.5rem; font-size: 0.75rem;">
          🔑 Clave
        </button>
        <button class="btn btn-outline btn-sm" id="btnLogout" onclick="cerrarSesion()" title="Cerrar sesión" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; color: var(--status-danger, #ef4444);">
          🚪 Salir
        </button>
      </div>
    `;
  }

  if (mobileUserSection) {
    mobileUserSection.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem 0.85rem; background: var(--bg-surface); border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; flex-direction: column; gap: 0.2rem;">
            <span style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary);">${currentUser.nombre}</span>
            <span class="badge ${roleBadgeClasses[currentUser.rol] || 'badge-muted'}" style="width: fit-content;">${currentUser.rol}</span>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; width: 100%;">
          <button class="btn btn-outline btn-sm" id="btnOpenModalCambiarPasswordMobile" onclick="openModal('modalCambiarPassword'); window.closeMobileMenu();" title="Cambiar mi contraseña" style="min-height: 38px; flex: 1; justify-content: center;">
            🔑 Clave
          </button>
          <button class="btn btn-outline btn-sm" id="btnMobileLogout" onclick="cerrarSesion(); window.closeMobileMenu();" title="Cerrar sesión" style="min-height: 38px; flex: 1; justify-content: center; color: var(--status-danger, #ef4444);">
            🚪 Salir
          </button>
        </div>
      </div>
    `;
  }

  // 2. Selectores de rol rápido en navbar
  const btnRoleAdmin = document.getElementById("quickRoleAdmin");
  const btnRoleSupervisor = document.getElementById("quickRoleSupervisor");
  const btnRoleOperador = document.getElementById("quickRoleOperador");

  if (btnRoleAdmin) btnRoleAdmin.classList.toggle("active", currentUser.rol === "ADMIN");
  if (btnRoleSupervisor) btnRoleSupervisor.classList.toggle("active", currentUser.rol === "SUPERVISOR");
  if (btnRoleOperador) btnRoleOperador.classList.toggle("active", currentUser.rol === "OPERADOR");

  // 3. Botones de acción del Dashboard
  const btnNuevaInstalacion = document.getElementById("btnOpenModalInstalacion");
  const btnNuevoTipo = document.getElementById("btnOpenModalTipo");
  const btnNuevoMedidor = document.getElementById("btnOpenModalMedidor");
  const tabAdminBtn = document.getElementById("tabAdminBtn");
  const tabReportesBtn = document.getElementById("tabReportesBtn");
  const tabAlertasBtn = document.getElementById("tabAlertasBtn");
  const tabMantenimientoBtn = document.getElementById("tabMantenimientoBtn");
  const tabUsuariosBtn = document.getElementById("tabUsuariosBtn");
  const tabAuditoriaBtn = document.getElementById("tabAuditoriaBtn");
  const tabWebhooksBtn = document.getElementById("tabWebhooksBtn");
  const tabNotificacionesBtn = document.getElementById("tabNotificacionesBtn");
  const tabOperadorBtn = document.getElementById("tabOperadorBtn");

  if (btnNuevaInstalacion) {
    btnNuevaInstalacion.style.display = currentUser.rol === "ADMIN" ? "inline-flex" : "none";
  }

  if (btnNuevoTipo) {
    btnNuevoTipo.style.display = currentUser.rol === "ADMIN" ? "inline-flex" : "none";
  }

  if (btnNuevoMedidor) {
    btnNuevoMedidor.style.display = (currentUser.rol === "ADMIN" || currentUser.rol === "SUPERVISOR") ? "inline-flex" : "none";
  }

  const esOperador = currentUser.rol === "OPERADOR";
  if (tabAdminBtn) tabAdminBtn.style.display = esOperador ? "none" : "inline-flex";
  if (tabReportesBtn) tabReportesBtn.style.display = esOperador ? "none" : "inline-flex";
  if (tabAlertasBtn) tabAlertasBtn.style.display = esOperador ? "none" : "inline-flex";
  if (tabMantenimientoBtn) tabMantenimientoBtn.style.display = esOperador ? "none" : "inline-flex";
  if (tabUsuariosBtn) tabUsuariosBtn.style.display = currentUser.rol === "ADMIN" ? "inline-flex" : "none";
  if (tabAuditoriaBtn) tabAuditoriaBtn.style.display = currentUser.rol === "ADMIN" ? "inline-flex" : "none";
  if (tabWebhooksBtn) tabWebhooksBtn.style.display = currentUser.rol === "ADMIN" ? "inline-flex" : "none";
  if (tabNotificacionesBtn) tabNotificacionesBtn.style.display = (currentUser.rol === "ADMIN" || currentUser.rol === "SUPERVISOR") ? "inline-flex" : "none";
  if (tabOperadorBtn) tabOperadorBtn.style.display = "inline-flex";

  // Sincronizar botones de navegación en drawer móvil
  const mobileTabAdminBtn = document.getElementById("mobileTabAdminBtn");
  const mobileTabReportesBtn = document.getElementById("mobileTabReportesBtn");
  const mobileTabAlertasBtn = document.getElementById("mobileTabAlertasBtn");
  const mobileTabMantenimientoBtn = document.getElementById("mobileTabMantenimientoBtn");
  const mobileTabUsuariosBtn = document.getElementById("mobileTabUsuariosBtn");
  const mobileTabAuditoriaBtn = document.getElementById("mobileTabAuditoriaBtn");
  const mobileTabWebhooksBtn = document.getElementById("mobileTabWebhooksBtn");
  const mobileTabNotificacionesBtn = document.getElementById("mobileTabNotificacionesBtn");
  const mobileTabOperadorBtn = document.getElementById("mobileTabOperadorBtn");

  if (mobileTabAdminBtn) mobileTabAdminBtn.style.display = esOperador ? "none" : "flex";
  if (mobileTabReportesBtn) mobileTabReportesBtn.style.display = esOperador ? "none" : "flex";
  if (mobileTabAlertasBtn) mobileTabAlertasBtn.style.display = esOperador ? "none" : "flex";
  if (mobileTabMantenimientoBtn) mobileTabMantenimientoBtn.style.display = esOperador ? "none" : "flex";
  if (mobileTabUsuariosBtn) mobileTabUsuariosBtn.style.display = currentUser.rol === "ADMIN" ? "flex" : "none";
  if (mobileTabAuditoriaBtn) mobileTabAuditoriaBtn.style.display = currentUser.rol === "ADMIN" ? "flex" : "none";
  if (mobileTabWebhooksBtn) mobileTabWebhooksBtn.style.display = currentUser.rol === "ADMIN" ? "flex" : "none";
  if (mobileTabNotificacionesBtn) mobileTabNotificacionesBtn.style.display = (currentUser.rol === "ADMIN" || currentUser.rol === "SUPERVISOR") ? "flex" : "none";
  if (mobileTabOperadorBtn) mobileTabOperadorBtn.style.display = "flex";

  const mobileRoleAdmin = document.getElementById("mobileRoleAdmin");
  const mobileRoleSupervisor = document.getElementById("mobileRoleSupervisor");
  const mobileRoleOperador = document.getElementById("mobileRoleOperador");
  if (mobileRoleAdmin) mobileRoleAdmin.classList.toggle("active", currentUser.rol === "ADMIN");
  if (mobileRoleSupervisor) mobileRoleSupervisor.classList.toggle("active", currentUser.rol === "SUPERVISOR");
  if (mobileRoleOperador) mobileRoleOperador.classList.toggle("active", currentUser.rol === "OPERADOR");

  actualizarResumenAlertas();
}

// ------------------------------------------------------------------------------
// 2. NAVEGACIÓN Y CONMUTACIÓN DE PESTAÑAS (VISTAS)
// ------------------------------------------------------------------------------
async function switchRole(role) {
  if (sessionSyncPromise) {
    await sessionSyncPromise;
  }

  if (!currentUser) {
    mostrarPantallaLogin();
    return;
  }

  if (role !== "operador" && currentUser?.rol === "OPERADOR") {
    window.Toast.warning("El perfil OPERADOR solo tiene acceso al Modo Terreno.", "Permisos");
    return;
  }

  if (role === "usuarios" && currentUser?.rol !== "ADMIN") {
    window.Toast.warning("La gestión de usuarios está reservada para ADMIN.", "Permisos");
    return;
  }

  if (role === "auditoria" && currentUser?.rol !== "ADMIN") {
    window.Toast.warning("La pista de auditoría está reservada para ADMIN.", "Permisos");
    return;
  }

  if (role === "webhooks" && currentUser?.rol !== "ADMIN") {
    window.Toast.warning("La gestión de webhooks está reservada para ADMIN.", "Permisos");
    return;
  }

  if (role === "notificaciones" && currentUser?.rol !== "ADMIN" && currentUser?.rol !== "SUPERVISOR") {
    window.Toast.warning("La gestión de notificaciones está reservada para Administradores y Supervisores.", "Permisos");
    return;
  }

  currentRoleTab = role;
  const tabs = [
    document.getElementById("tabAdminBtn"),
    document.getElementById("tabReportesBtn"),
    document.getElementById("tabAlertasBtn"),
    document.getElementById("tabMantenimientoBtn"),
    document.getElementById("tabUsuariosBtn"),
    document.getElementById("tabAuditoriaBtn"),
    document.getElementById("tabWebhooksBtn"),
    document.getElementById("tabNotificacionesBtn"),
    document.getElementById("tabOperadorBtn"),
    document.getElementById("mobileTabAdminBtn"),
    document.getElementById("mobileTabReportesBtn"),
    document.getElementById("mobileTabAlertasBtn"),
    document.getElementById("mobileTabMantenimientoBtn"),
    document.getElementById("mobileTabUsuariosBtn"),
    document.getElementById("mobileTabAuditoriaBtn"),
    document.getElementById("mobileTabWebhooksBtn"),
    document.getElementById("mobileTabNotificacionesBtn"),
    document.getElementById("mobileTabOperadorBtn"),
  ];
  const views = [
    document.getElementById("viewLogin"),
    document.getElementById("viewAdmin"),
    document.getElementById("viewReportes"),
    document.getElementById("viewAlertas"),
    document.getElementById("viewMantenimiento"),
    document.getElementById("viewUsuarios"),
    document.getElementById("viewAuditoria"),
    document.getElementById("viewWebhooks"),
    document.getElementById("viewNotificaciones"),
    document.getElementById("viewOperador"),
  ];

  tabs.forEach((t) => t?.classList.remove("active"));
  views.forEach((v) => v?.classList.remove("active"));

  if (role === "admin") {
    document.getElementById("tabAdminBtn")?.classList.add("active");
    document.getElementById("mobileTabAdminBtn")?.classList.add("active");
    document.getElementById("viewAdmin")?.classList.add("active");
    cargarDashboard();
  } else if (role === "reportes") {
    document.getElementById("tabReportesBtn")?.classList.add("active");
    document.getElementById("mobileTabReportesBtn")?.classList.add("active");
    document.getElementById("viewReportes")?.classList.add("active");
    inicializarFiltrosReporte();
    cargarReporteConsumos();
    cargarFacturasReportes();
  } else if (role === "alertas") {
    document.getElementById("tabAlertasBtn")?.classList.add("active");
    document.getElementById("mobileTabAlertasBtn")?.classList.add("active");
    document.getElementById("viewAlertas")?.classList.add("active");
    cargarAlertasIncidentes();
    cargarReglasAlertas();
    actualizarResumenAlertas();
  } else if (role === "mantenimiento") {
    document.getElementById("tabMantenimientoBtn")?.classList.add("active");
    document.getElementById("mobileTabMantenimientoBtn")?.classList.add("active");
    document.getElementById("viewMantenimiento")?.classList.add("active");
    poblarSelectsMantenimiento();
    cargarMantenimientosBitacora();
  } else if (role === "usuarios") {
    document.getElementById("tabUsuariosBtn")?.classList.add("active");
    document.getElementById("mobileTabUsuariosBtn")?.classList.add("active");
    document.getElementById("viewUsuarios")?.classList.add("active");
    cargarUsuariosAdmin();
  } else if (role === "auditoria") {
    document.getElementById("tabAuditoriaBtn")?.classList.add("active");
    document.getElementById("mobileTabAuditoriaBtn")?.classList.add("active");
    document.getElementById("viewAuditoria")?.classList.add("active");
    cargarEventosAuditoria();
  } else if (role === "webhooks") {
    document.getElementById("tabWebhooksBtn")?.classList.add("active");
    document.getElementById("mobileTabWebhooksBtn")?.classList.add("active");
    document.getElementById("viewWebhooks")?.classList.add("active");
    cargarWebhooks();
  } else if (role === "notificaciones") {
    document.getElementById("tabNotificacionesBtn")?.classList.add("active");
    document.getElementById("mobileTabNotificacionesBtn")?.classList.add("active");
    document.getElementById("viewNotificaciones")?.classList.add("active");
    inicializarVistaNotificaciones();
  } else {
    document.getElementById("tabOperadorBtn")?.classList.add("active");
    document.getElementById("mobileTabOperadorBtn")?.classList.add("active");
    document.getElementById("viewOperador")?.classList.add("active");
    cargarSelectorOperador();
  }
}

// ------------------------------------------------------------------------------
// 3. DASHBOARD ADMINISTRATIVO / SUPERVISOR
// ------------------------------------------------------------------------------
async function cargarDashboard() {
  try {
    // 1. KPIs
    const kpis = await window.api.dashboard.getKpis();
    if (document.getElementById("kpiTotalInstalaciones")) {
      document.getElementById("kpiTotalInstalaciones").innerText = kpis.totalInstalaciones ?? 0;
    }
    if (document.getElementById("kpiTotalMedidores")) {
      document.getElementById("kpiTotalMedidores").innerText = kpis.totalMedidores ?? 0;
    }
    if (document.getElementById("kpiTotalLecturas")) {
      document.getElementById("kpiTotalLecturas").innerText = kpis.totalLecturas ?? 0;
    }

    const pillsContainer = document.getElementById("kpiRecursosPills");
    if (pillsContainer) {
      const entries = kpis.medidoresPorRecurso ? Object.entries(kpis.medidoresPorRecurso) : [];
      pillsContainer.innerHTML = entries
        .map(([rec, cant]) => `<span class="kpi-tag">${rec}: ${cant}</span>`)
        .join("");
    }

    // 2. Medidores Desatendidos (+24h)
    const desatendidos = await window.api.dashboard.getDesatendidos(24);
    document.getElementById("kpiTotalDesatendidos").innerText = desatendidos.length;
    document.getElementById("badgeCountDesatendidos").innerText = `${desatendidos.length} pendientes`;

    const listDesatendidos = document.getElementById("listaDesatendidos");
    if (desatendidos.length === 0) {
      listDesatendidos.innerHTML = '<div class="empty-state">✅ Todos los medidores activos están al día (menos de 24h).</div>';
    } else {
      listDesatendidos.innerHTML = desatendidos
        .map((d) => window.Components.createDesatendidoItem(d))
        .join("");
    }

    // 3. Consumos Netos por Instalación
    const consumos = await window.api.dashboard.getConsumos();
    const consumosContainer = document.getElementById("listaConsumos");
    if (consumos.length === 0) {
      consumosContainer.innerHTML = '<div class="empty-state">No hay consumos acumulados registrados aún.</div>';
    } else {
      consumosContainer.innerHTML = consumos
        .map((c) => window.Components.createConsumoCard(c))
        .join("");
    }

    // 4. Actividad Reciente de Telemetría
    const lecturas = await window.api.lecturas.getRecientes(8);
    const lecturasContainer = document.getElementById("listaActividadReciente");
    if (lecturas.length === 0) {
      lecturasContainer.innerHTML = '<div class="empty-state">No hay mediciones recientes registradas.</div>';
    } else {
      lecturasContainer.innerHTML = lecturas
        .map((lec) => window.Components.createActivityItem(lec))
        .join("");
    }
  } catch (err) {
    console.error("Error al cargar dashboard:", err);
    window.Toast.error(err.message, "Fallo al sincronizar Dashboard");
    const container = document.getElementById("listaActividadReciente");
    if (container && window.Components && typeof window.Components.renderErrorState === "function") {
      window.Components.renderErrorState(
        container,
        "No se pudo sincronizar el panel de telemetría con el servidor. Compruebe la conectividad.",
        () => cargarDashboard()
      );
    }
  }
}

// ------------------------------------------------------------------------------
// 4. MODO OPERADOR / TERRENO
// ------------------------------------------------------------------------------
async function cargarSelectorOperador() {
  try {
    const userId = currentUser ? currentUser.id : "demo-user";
    let instalaciones = [];

    // Si es ADMIN, puede inspeccionar cualquier sede
    if (currentUser?.rol === "ADMIN") {
      instalaciones = await window.api.instalaciones.getAll();
    } else {
      // SUPERVISOR y OPERADOR solo ven sus instalaciones asignadas
      instalaciones = await window.api.instalaciones.getByOperador(userId);
    }

    const select = document.getElementById("selectOperadorInstalacion");
    select.innerHTML = '<option value="">-- Selecciona una Instalación Asignada --</option>';

    instalaciones.forEach((inst) => {
      const opt = document.createElement("option");
      opt.value = inst.id;
      opt.textContent = `${inst.nombre} (${inst.direccion})`;
      select.appendChild(opt);
    });

    if (instalaciones.length > 0) {
      select.value = instalaciones[0].id;
      cargarMedidoresInstalacion(instalaciones[0].id);
    } else {
      document.getElementById("gridMedidoresOperador").innerHTML =
        '<div class="empty-state">No tienes instalaciones asignadas para este turno.</div>';
    }
  } catch (err) {
    window.Toast.error(err.message, "Error al cargar instalaciones asignadas");
  }
}

async function onOperadorInstalacionChange() {
  const select = document.getElementById("selectOperadorInstalacion");
  if (select.value) {
    await cargarMedidoresInstalacion(select.value);
  } else {
    document.getElementById("gridMedidoresOperador").innerHTML =
      '<div class="empty-state">Selecciona una instalación para ver los medidores a capturar.</div>';
  }
}

async function cargarMedidoresInstalacion(instalacionId) {
  try {
    const medidores = await window.api.medidores.getByInstalacion(instalacionId);
    medidoresOperadorCache = medidores;

    const grid = document.getElementById("gridMedidoresOperador");
    if (medidores.length === 0) {
      grid.innerHTML = '<div class="empty-state">No hay medidores físicos instalados en esta sede.</div>';
      return;
    }

    grid.innerHTML = medidores
      .map((m) => window.Components.createMeterCard(m))
      .join("");
  } catch (err) {
    window.Toast.error(err.message, "Error al cargar medidores");
  }
}

// ------------------------------------------------------------------------------
// 5. REGISTRO DE LECTURAS (Captura en Terreno)
// ------------------------------------------------------------------------------
function openModalLectura(medidorId) {
  const medidor = medidoresOperadorCache.find((m) => m.id === medidorId);
  if (!medidor) return;

  const tipo = medidor.tipoMedidor || {};
  document.getElementById("modalLecturaMedidorId").value = medidor.id;
  document.getElementById("modalLecturaCodigo").innerText = medidor.codigo;
  document.getElementById("modalLecturaTipo").innerText = `${tipo.nombre} (${tipo.recurso})`;
  document.getElementById("modalLecturaUbicacion").innerText = medidor.ubicacionInterna;
  document.getElementById("modalLecturaUnidad").innerText = tipo.unidadMedida || tipo.unidad || "";

  const valAnterior = medidor.ultimaLectura ? medidor.ultimaLectura.valor : null;
  document.getElementById("modalLecturaAnterior").innerText =
    valAnterior !== null ? `${window.Components.formatNumber(valAnterior)} ${tipo.unidadMedida || tipo.unidad || ""}` : "Sin lectura previa";

  const inputValor = document.getElementById("modalLecturaInputValor");
  inputValor.value = "";
  inputValor.placeholder = valAnterior !== null ? `Mínimo ${valAnterior}` : "Ej. 1250.5";
  inputValor.step = "any";

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById("modalLecturaInputFecha").value = now.toISOString().slice(0, 16);
  document.getElementById("modalLecturaObservaciones").value = "";

  window.Modal.open("modalLectura");
}

async function submitLectura(event) {
  event.preventDefault();

  const medidorId = document.getElementById("modalLecturaMedidorId").value;
  const valorRaw = document.getElementById("modalLecturaInputValor").value;
  const fechaRaw = document.getElementById("modalLecturaInputFecha").value;
  const obs = document.getElementById("modalLecturaObservaciones").value.trim();

  const valor = parseFloat(valorRaw);
  if (isNaN(valor)) {
    window.Toast.warning("Por favor ingresa un valor numérico válido.");
    return;
  }

  const payload = {
    medidorId,
    operadorId: currentUser ? currentUser.id : "demo-operator",
    valor,
    timestamp: new Date(fechaRaw).toISOString(),
    observaciones: obs || undefined,
  };

  // Si estamos explícitamente sin red (Modo Offline)
  if (window.syncManager && !window.syncManager.isOnline()) {
    window.syncManager.encolarLectura(payload);
    window.Modal.close("modalLectura");
    window.Toast.info(`Lectura de ${valor} guardada localmente (Modo Offline). Se sincronizará automáticamente al detectar red.`, "Guardado Local");
    return;
  }

  try {
    await window.api.lecturas.registrar(payload);
    window.Modal.close("modalLectura");
    window.Toast.success(`Lectura de ${valor} registrada exitosamente.`);

    const select = document.getElementById("selectOperadorInstalacion");
    if (select.value) {
      await cargarMedidoresInstalacion(select.value);
    }
    if (currentRoleTab === "admin") {
      await cargarDashboard();
    }
  } catch (err) {
    // Si la llamada falló por caída de red imprevista
    const isNetworkError =
      !window.navigator.onLine ||
      err.message?.includes("Failed to fetch") ||
      err.message?.includes("NetworkError") ||
      err.name === "TypeError";

    if (isNetworkError && window.syncManager) {
      window.syncManager.encolarLectura(payload);
      window.Modal.close("modalLectura");
      window.Toast.warning(`Sin respuesta del servidor. Lectura de ${valor} encolada localmente para sincronización.`, "Modo Offline");
      return;
    }

    window.Toast.error(err.message, "Validación Rechazada");
  }
}

// ------------------------------------------------------------------------------
// 6. ALTAS DE CATÁLOGO (Con Guardias de Permiso)
// ------------------------------------------------------------------------------
async function cargarSelectsGlobales() {
  try {
    // Si es SUPERVISOR, solo ve sus instalaciones asignadas en el dropdown de creación de medidor
    if (currentUser?.rol === "SUPERVISOR") {
      instalacionesCache = await window.api.instalaciones.getByOperador(currentUser.id);
    } else {
      instalacionesCache = await window.api.instalaciones.getAll();
    }

    tiposMedidorCache = await window.api.medidores.getTipos();

    const selInst = document.getElementById("selectMedidorInstalacion");
    if (selInst) {
      selInst.innerHTML = '<option value="">Selecciona instalación...</option>';
      instalacionesCache.forEach((i) => {
        selInst.innerHTML += `<option value="${i.id}">${i.nombre}</option>`;
      });
    }

    const selTipo = document.getElementById("selectMedidorTipo");
    if (selTipo) {
      selTipo.innerHTML = '<option value="">Selecciona tipo...</option>';
      tiposMedidorCache.forEach((t) => {
        selTipo.innerHTML += `<option value="${t.id}">${t.nombre} (${t.recurso} - ${t.unidadMedida})</option>`;
      });
    }
  } catch (err) {
    console.error("Error al cargar selects iniciales:", err);
  }
}

async function submitNuevaInstalacion(event) {
  event.preventDefault();
  if (currentUser?.rol !== "ADMIN") {
    window.Toast.error("Operación prohibida: El rol SUPERVISOR no tiene permiso para crear instalaciones.", "Acceso Denegado");
    return;
  }

  const nombre = document.getElementById("inputInstalacionNombre").value.trim();
  const ubicacion = document.getElementById("inputInstalacionDireccion").value.trim();

  try {
    await window.api.instalaciones.create({
      nombre,
      ubicacion,
    });

    window.Modal.close("modalInstalacion");
    event.target.reset();
    window.Toast.success(`Instalación «${nombre}» creada correctamente.`);
    await cargarSelectsGlobales();
    await cargarDashboard();
  } catch (err) {
    window.Toast.error(err.message, "Error al crear instalación");
  }
}

async function submitNuevoTipo(event) {
  event.preventDefault();
  const nombre = document.getElementById("inputTipoNombre").value.trim();
  const recurso = document.getElementById("selectTipoRecurso").value;
  const rawUnidad = document.getElementById("inputTipoUnidad").value.trim().toUpperCase();
  let unidad = rawUnidad;
  if (rawUnidad === "M3" || rawUnidad === "M³") unidad = "M3";
  else if (rawUnidad === "L" || rawUnidad === "LTS" || rawUnidad === "LITRO" || rawUnidad === "LITROS") unidad = "LITROS";
  else if (rawUnidad === "KWH" || rawUnidad === "KW/H") unidad = "KWH";
  else if (rawUnidad === "%" || rawUnidad === "PORCENTAJE") unidad = "PORCENTAJE";
  else if (!["LITROS", "M3", "KWH", "PORCENTAJE"].includes(rawUnidad)) unidad = "OTRO";

  const tipoMedicion = document.getElementById("selectTipoMedicion").value;

  try {
    await window.api.medidores.createTipo({
      nombre,
      recurso,
      unidad,
      tipoMedicion,
    });

    window.Modal.close("modalTipo");
    event.target.reset();
    window.Toast.success(`Tipo de medidor «${nombre}» creado.`);
    await cargarSelectsGlobales();
  } catch (err) {
    window.Toast.error(err.message, "Error al crear tipo");
  }
}

async function submitNuevoMedidor(event) {
  event.preventDefault();
  const instalacionId = document.getElementById("selectMedidorInstalacion").value;
  const tipoMedidorId = document.getElementById("selectMedidorTipo").value;
  const codigo = document.getElementById("inputMedidorCodigo").value.trim();
  const numeroSerie = document.getElementById("inputMedidorSerie").value.trim();
  const ubicacionInterna = document.getElementById("inputMedidorUbicacion").value.trim();

  try {
    await window.api.medidores.create({
      instalacionId,
      tipoMedidorId,
      codigo,
      numeroSerie: numeroSerie || undefined,
      ubicacionInterna,
    });

    window.Modal.close("modalMedidor");
    event.target.reset();
    window.Toast.success(`Medidor «${codigo}» dado de alta exitosamente.`);
    await cargarDashboard();
  } catch (err) {
    window.Toast.error(err.message, "Error al crear medidor");
  }
}

// ------------------------------------------------------------------------------
// 7. UTILIDAD DEMO & SEED
// ------------------------------------------------------------------------------
async function seedDemoData() {
  const btn = document.getElementById("btnSeedDemo");
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Poblando base de datos...";

  try {
    const result = await window.api.demo.seed();
    window.Toast.success(result.message || "Demostración poblada con éxito.");
    await sincronizarSesionUsuario();
    await cargarSelectsGlobales();
    await cargarDashboard();
    if (currentRoleTab === "operador") {
      await cargarSelectorOperador();
    }
  } catch (err) {
    window.Toast.error(err.message, "Error al cargar demo");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ------------------------------------------------------------------------------
// 8. GESTIÓN DE USUARIOS & CAMBIO DE CONTRASEÑA (SPEC-006)
// ------------------------------------------------------------------------------
let usuariosCache = [];

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function cargarUsuariosAdmin() {
  const tbody = document.getElementById("tbodyUsuarios");
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Cargando directorio de usuarios...</td></tr>';

  try {
    const usuarios = await window.api.usuarios.getAll();
    usuariosCache = usuarios;

    if (usuarios.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay usuarios registrados.</td></tr>';
      return;
    }

    const roleBadgeClasses = {
      ADMIN: "badge-blue",
      SUPERVISOR: "badge-amber",
      OPERADOR: "badge-emerald",
    };

    tbody.innerHTML = usuarios
      .map((u) => {
        const instalacionesBadges = (u.instalaciones && u.instalaciones.length > 0)
          ? u.instalaciones
              .map(
                (i) =>
                  `<span class="badge badge-muted" style="margin-right: 0.25rem; margin-bottom: 0.25rem; font-size: 0.75rem;">🏢 ${escapeHtml(
                    i.nombre
                  )}</span>`
              )
              .join("")
          : u.rol === "ADMIN"
          ? '<span style="font-size: 0.75rem; color: var(--text-muted);">Acceso Global</span>'
          : '<span style="font-size: 0.75rem; color: var(--status-warning);">Sin sedes asignadas</span>';

        const estadoBadge = u.activo
          ? '<span class="badge badge-emerald">Activo</span>'
          : '<span class="badge badge-muted">Inactivo</span>';

        return `
          <tr>
            <td data-label="Usuario">
              <div style="font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; word-break: break-word;">${escapeHtml(u.nombre)}</div>
            </td>
            <td data-label="Email" class="font-mono" style="font-size: 0.8rem; color: var(--text-secondary); overflow-wrap: anywhere; word-break: break-word;">${escapeHtml(u.email)}</td>
            <td data-label="Rol">
              <span class="badge ${roleBadgeClasses[u.rol] || 'badge-muted'}">${u.rol}</span>
            </td>
            <td data-label="Estado">${estadoBadge}</td>
            <td data-label="Instalaciones Asignadas" class="cell-stacked">
              <div class="badges-wrapper" style="display: flex; flex-wrap: wrap; gap: 0.35rem; width: 100%;">${instalacionesBadges}</div>
            </td>
            <td data-label="Acciones" class="table-actions" style="text-align: right; white-space: nowrap;">
              <button class="btn btn-outline btn-sm" onclick="abrirModalEditarUsuario('${u.id}')" title="Editar datos y sedes" style="margin-right: 0.35rem;">
                ✏️ Editar
              </button>
              <button class="btn btn-ghost btn-sm" onclick="abrirModalResetPassword('${u.id}')" title="Restablecer contraseña">
                🔄 Reset Clave
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color: var(--status-danger);">Error al cargar usuarios: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function submitCambiarPassword(event) {
  event.preventDefault();
  const passwordActual = document.getElementById("inputPasswordActual").value;
  const passwordNueva = document.getElementById("inputPasswordNueva").value;

  try {
    await window.api.auth.cambiarPassword({ passwordActual, passwordNueva });
    window.Toast.success("Contraseña actualizada exitosamente.", "Seguridad");
    document.getElementById("formCambiarPassword").reset();
    window.Modal.close("modalCambiarPassword");
  } catch (err) {
    window.Toast.error(err.message || "Error al actualizar contraseña", "Fallo");
  }
}

async function submitNuevoUsuario(event) {
  event.preventDefault();
  const nombre = document.getElementById("inputNuevoUsuarioNombre").value.trim();
  const email = document.getElementById("inputNuevoUsuarioEmail").value.trim();
  const password = document.getElementById("inputNuevoUsuarioPassword").value;
  const rol = document.getElementById("selectNuevoUsuarioRol").value;

  try {
    await window.api.usuarios.create({ nombre, email, password, rol });
    window.Toast.success(`Usuario «${nombre}» creado exitosamente.`, "Directorio");
    document.getElementById("formNuevoUsuario").reset();
    window.Modal.close("modalNuevoUsuario");
    await cargarUsuariosAdmin();
  } catch (err) {
    window.Toast.error(err.message || "Error al crear usuario", "Fallo");
  }
}

async function abrirModalEditarUsuario(usuarioId) {
  const usuario = usuariosCache.find((u) => u.id === usuarioId);
  if (!usuario) return;

  document.getElementById("editUsuarioId").value = usuario.id;
  document.getElementById("editUsuarioNombre").value = usuario.nombre;
  document.getElementById("editUsuarioRol").value = usuario.rol;
  document.getElementById("editUsuarioActivo").value = usuario.activo ? "true" : "false";

  // Checkboxes de instalaciones
  const listContainer = document.getElementById("editUsuarioInstalacionesList");
  const assignedIds = new Set((usuario.instalaciones || []).map((i) => i.id));

  listContainer.innerHTML = instalacionesCache
    .map(
      (inst) => `
      <label class="checklist-item">
        <input type="checkbox" name="editInstalacionCheck" value="${inst.id}" ${assignedIds.has(inst.id) ? "checked" : ""}>
        <span>${escapeHtml(inst.nombre)} <span style="font-size: 0.75rem; color: var(--text-muted);">(${escapeHtml(inst.ubicacion)})</span></span>
      </label>
    `
    )
    .join("");

  window.Modal.open("modalEditarUsuario");
}

async function submitEditarUsuario(event) {
  event.preventDefault();
  const id = document.getElementById("editUsuarioId").value;
  const nombre = document.getElementById("editUsuarioNombre").value.trim();
  const rol = document.getElementById("editUsuarioRol").value;
  const activo = document.getElementById("editUsuarioActivo").value === "true";

  const checkedCheckboxes = document.querySelectorAll('input[name="editInstalacionCheck"]:checked');
  const instalacionesIds = Array.from(checkedCheckboxes).map((cb) => cb.value);

  try {
    await window.api.usuarios.update(id, {
      nombre,
      rol,
      activo,
      instalacionesIds,
    });
    window.Toast.success("Usuario y asignaciones actualizados exitosamente.", "Directorio");
    window.Modal.close("modalEditarUsuario");
    await cargarUsuariosAdmin();

    if (currentUser?.id === id) {
      currentUser.nombre = nombre;
      currentUser.rol = rol;
      aplicarPermisosUI();
    }
  } catch (err) {
    window.Toast.error(err.message || "Error al actualizar usuario", "Fallo");
  }
}

function abrirModalResetPassword(usuarioId) {
  const usuario = usuariosCache.find((u) => u.id === usuarioId);
  if (!usuario) return;

  document.getElementById("resetUsuarioId").value = usuario.id;
  document.getElementById("resetUsuarioNombre").innerText = `${usuario.nombre} (${usuario.email})`;
  document.getElementById("formResetPassword").reset();
  window.Modal.open("modalResetPassword");
}

async function submitResetPassword(event) {
  event.preventDefault();
  const id = document.getElementById("resetUsuarioId").value;
  const passwordNueva = document.getElementById("resetPasswordNueva").value;

  try {
    await window.api.usuarios.resetPassword(id, { passwordNueva });
    window.Toast.success("Contraseña restablecida exitosamente.", "Seguridad");
    window.Modal.close("modalResetPassword");
  } catch (err) {
    window.Toast.error(err.message || "Error al restablecer contraseña", "Fallo");
  }
}

// ==============================================================================
// 5. FUNCIONALIDADES: REPORTES & CONCILIACIÓN DE FACTURAS (FEAT-007)
// ==============================================================================

function inicializarFiltrosReporte() {
  const selectSede = document.getElementById("filtroReporteSede");
  const selectFacturaSede = document.getElementById("facturaInstalacionId");
  if (selectSede && instalacionesCache.length > 0) {
    selectSede.innerHTML = `<option value="">Todas las sedes</option>` +
      instalacionesCache.map((i) => `<option value="${i.id}">${escapeHtml(i.nombre)}</option>`).join("");
  }
  if (selectFacturaSede && instalacionesCache.length > 0) {
    selectFacturaSede.innerHTML = instalacionesCache.map((i) => `<option value="${i.id}">${escapeHtml(i.nombre)}</option>`).join("");
  }

  const hoy = new Date();
  const hace30d = new Date(hoy.getTime() - 30 * 24 * 3600 * 1000);
  const inputIni = document.getElementById("filtroReporteInicio");
  const inputFin = document.getElementById("filtroReporteFin");
  if (inputIni && !inputIni.value) inputIni.value = hace30d.toISOString().split("T")[0];
  if (inputFin && !inputFin.value) inputFin.value = hoy.toISOString().split("T")[0];
}

async function cargarReporteConsumos() {
  const instalacionId = document.getElementById("filtroReporteSede")?.value || undefined;
  const recurso = document.getElementById("filtroReporteRecurso")?.value || undefined;
  const fechaInicio = document.getElementById("filtroReporteInicio")?.value;
  const fechaFin = document.getElementById("filtroReporteFin")?.value;

  if (!fechaInicio || !fechaFin) {
    window.Toast.warning("Debes seleccionar una fecha de inicio y fin.", "Filtros");
    return;
  }

  const tbody = document.getElementById("tbodyReporteConsumos");
  const badgeTotal = document.getElementById("badgeTotalReporteMedidores");
  tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Consultando consumos consolidados...</td></tr>`;

  try {
    const consumos = await window.api.reportes.getConsumos({
      instalacionId,
      recurso,
      fechaInicio: `${fechaInicio}T00:00:00.000Z`,
      fechaFin: `${fechaFin}T23:59:59.000Z`,
    });

    if (badgeTotal) badgeTotal.innerText = `${consumos.length} medidores`;

    if (consumos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No se registraron consumos ni variaciones para el período seleccionado.</td></tr>`;
      return;
    }

    tbody.innerHTML = consumos.map((c) => {
      const meta = getResourceMeta(c.recurso);
      return `
        <tr>
          <td data-label="Sede"><strong>${escapeHtml(c.instalacionNombre)}</strong></td>
          <td data-label="Medidor" class="font-mono">${escapeHtml(c.medidorCodigo)}</td>
          <td data-label="Recurso"><span class="badge ${meta.badgeClass}">${meta.icon} ${escapeHtml(c.recurso)}</span></td>
          <td data-label="Unidad"><span class="badge badge-muted">${escapeHtml(c.unidad)}</span></td>
          <td data-label="Lectura Inicial" style="text-align: right;" class="font-mono">${formatNumber(c.lecturaInicial)}</td>
          <td data-label="Lectura Final" style="text-align: right;" class="font-mono">${formatNumber(c.lecturaFinal)}</td>
          <td data-label="Consumo Neto" style="text-align: right;" class="font-mono"><strong style="color: var(--accent-primary); font-size: 1.05rem;">${formatNumber(c.consumoNeto)}</strong></td>
          <td data-label="Muestras" style="text-align: center;"><span class="badge badge-blue">${c.totalLecturas} lecturas</span></td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color: var(--status-danger);">Error al cargar reporte: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function exportarReporteCSV() {
  const instalacionId = document.getElementById("filtroReporteSede")?.value || "";
  const recurso = document.getElementById("filtroReporteRecurso")?.value || "";
  const fechaInicio = document.getElementById("filtroReporteInicio")?.value;
  const fechaFin = document.getElementById("filtroReporteFin")?.value;

  if (!fechaInicio || !fechaFin) {
    window.Toast.warning("Debes seleccionar una fecha de inicio y fin para exportar.", "Filtros");
    return;
  }

  const url = window.api.reportes.getCsvUrl({
    instalacionId: instalacionId || undefined,
    recurso: recurso || undefined,
    fechaInicio: `${fechaInicio}T00:00:00.000Z`,
    fechaFin: `${fechaFin}T23:59:59.000Z`,
  });

  const a = document.createElement("a");
  a.href = url;
  a.download = `reporte-consumo-${fechaInicio}-al-${fechaFin}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.Toast.success("Generando descarga del archivo CSV...", "Exportación");
}

async function cargarFacturasReportes() {
  const tbody = document.getElementById("tbodyReporteFacturas");
  tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Consultando auditoría de facturas...</td></tr>`;

  try {
    const facturas = await window.api.reportes.getFacturas();
    if (facturas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Aún no se han registrado facturas de servicios para conciliar.</td></tr>`;
      return;
    }

    tbody.innerHTML = facturas.map((f) => {
      const inst = instalacionesCache.find((i) => i.id === f.instalacionId);
      const meta = getResourceMeta(f.recurso);

      let estadoBadge = `<span class="badge badge-amber">PENDIENTE</span>`;
      if (f.estadoConciliacion === "CONCILIADO") {
        estadoBadge = `<span class="badge badge-emerald">✓ CONCILIADO (&le; 5%)</span>`;
      } else if (f.estadoConciliacion === "DISCREPANCIA") {
        estadoBadge = `<span class="badge badge-rose">⚠ DISCREPANCIA (&gt; 5%)</span>`;
      }

      const iniStr = new Date(f.periodoInicio).toLocaleDateString("es-CL");
      const finStr = new Date(f.periodoFin).toLocaleDateString("es-CL");

      return `
        <tr>
          <td data-label="N° Factura"><strong class="font-mono">${escapeHtml(f.numeroFactura || "S/N")}</strong></td>
          <td data-label="Sede">${escapeHtml(inst?.nombre || f.instalacionId.slice(0, 8))}</td>
          <td data-label="Recurso"><span class="badge ${meta.badgeClass}">${meta.icon} ${escapeHtml(f.recurso)}</span></td>
          <td data-label="Período" style="font-size: 0.85rem;">${iniStr} &rarr; ${finStr}</td>
          <td data-label="Facturado" style="text-align: right;" class="font-mono"><strong>${formatNumber(f.consumoFacturado)}</strong> ${escapeHtml(f.unidad)}</td>
          <td data-label="Medido" style="text-align: right;" class="font-mono">${f.consumoMedido !== null ? formatNumber(f.consumoMedido) : "--"} ${escapeHtml(f.unidad)}</td>
          <td data-label="Diferencia" style="text-align: right;" class="font-mono">${f.diferenciaConsumo !== null ? (f.diferenciaConsumo > 0 ? `+${formatNumber(f.diferenciaConsumo)}` : formatNumber(f.diferenciaConsumo)) : "--"}</td>
          <td data-label="% Desvío" style="text-align: right;" class="font-mono">${f.porcentajeDesvio !== null ? `${f.porcentajeDesvio > 0 ? `+${f.porcentajeDesvio}` : f.porcentajeDesvio}%` : "--"}</td>
          <td data-label="Estado">${estadoBadge}</td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color: var(--status-danger);">Error al cargar facturas: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function submitRegistrarFactura(event) {
  event.preventDefault();
  const instalacionId = document.getElementById("facturaInstalacionId").value;
  const recurso = document.getElementById("facturaRecurso").value;
  const numeroFactura = document.getElementById("facturaNumero").value;
  const periodoInicio = document.getElementById("facturaPeriodoInicio").value;
  const periodoFin = document.getElementById("facturaPeriodoFin").value;
  const consumoFacturado = parseFloat(document.getElementById("facturaConsumo").value);
  const unidad = document.getElementById("facturaUnidad").value;
  const montoTotalVal = document.getElementById("facturaMonto").value;
  const notas = document.getElementById("facturaNotas").value;

  try {
    const res = await window.api.reportes.registrarFactura({
      instalacionId,
      recurso,
      numeroFactura: numeroFactura || undefined,
      periodoInicio: `${periodoInicio}T00:00:00.000Z`,
      periodoFin: `${periodoFin}T23:59:59.000Z`,
      consumoFacturado,
      unidad,
      montoTotal: montoTotalVal ? parseFloat(montoTotalVal) : undefined,
      notas: notas || undefined,
    });

    window.Toast.success(
      `Factura registrada. Estado de conciliación: ${res.estadoConciliacion}`,
      "Conciliación"
    );
    window.Modal.close("modalRegistrarFactura");
    document.getElementById("formRegistrarFactura").reset();
    await cargarFacturasReportes();
  } catch (err) {
    window.Toast.error(err.message || "Error al registrar factura", "Fallo");
  }
}

// ==============================================================================
// 6. FUNCIONALIDADES: ALERTAS & ANOMALÍAS (FEAT-008)
// ==============================================================================

async function actualizarResumenAlertas() {
  try {
    const resumen = await window.api.alertas.getResumen();
    const elAbiertos = document.getElementById("kpiAlertasAbiertos");
    const elCriticos = document.getElementById("kpiAlertasCriticos");
    const elAdv = document.getElementById("kpiAlertasAdvertencias");
    const elRes = document.getElementById("kpiAlertasResueltos");
    const badgeNav = document.getElementById("navAlertasBadge");

    if (elAbiertos) elAbiertos.innerText = resumen.totalAbiertos;
    if (elCriticos) elCriticos.innerText = resumen.totalCriticos;
    if (elAdv) elAdv.innerText = resumen.totalAdvertencias;
    if (elRes) elRes.innerText = resumen.totalResueltos;

    if (badgeNav) {
      badgeNav.innerText = resumen.totalAbiertos;
      badgeNav.style.display = resumen.totalAbiertos > 0 ? "inline-block" : "none";
      badgeNav.className = resumen.totalCriticos > 0 ? "badge badge-rose" : "badge badge-amber";
    }
  } catch (e) {
    console.warn("No se pudo obtener resumen de alertas:", e);
  }
}

async function cargarAlertasIncidentes() {
  const tbody = document.getElementById("tbodyAlertasIncidentes");
  const estado = document.getElementById("filtroAlertasEstado")?.value || undefined;

  tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Consultando incidentes...</td></tr>`;

  try {
    const incidentes = await window.api.alertas.getIncidentes({ estado });
    if (incidentes.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">✓ No se registran anomalías ni incidentes con los filtros actuales.</td></tr>`;
      return;
    }

    tbody.innerHTML = incidentes.map((i) => {
      const severidadBadge = i.severidad === "CRITICAL"
        ? `<span class="badge badge-rose">🚨 CRITICAL</span>`
        : i.severidad === "WARNING"
          ? `<span class="badge badge-amber">⚠️ WARNING</span>`
          : `<span class="badge badge-blue">ℹ INFO</span>`;

      const estadoBadge = i.estado === "ABIERTO"
        ? `<span class="badge badge-rose">ABIERTO</span>`
        : i.estado === "EN_REVISION"
          ? `<span class="badge badge-amber">EN REVISIÓN</span>`
          : `<span class="badge badge-emerald">RESUELTO</span>`;

      const fechaStr = new Date(i.fechaDeteccion).toLocaleString("es-CL", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

      const btnAccion = i.estado !== "RESUELTO"
        ? `<button class="btn btn-outline btn-sm" onclick="abrirModalResolverIncidente('${i.id}', '${escapeHtml(i.mensaje)}', '${escapeHtml(i.medidorCodigo || '')}')">Atender</button>`
        : `<span style="font-size:0.75rem; color: var(--text-muted);">Cerrado</span>`;

      return `
        <tr>
          <td data-label="Fecha Detección" style="font-size: 0.85rem;">${fechaStr}</td>
          <td data-label="Sede"><strong>${escapeHtml(i.instalacionNombre || "--")}</strong></td>
          <td data-label="Medidor" class="font-mono">${escapeHtml(i.medidorCodigo || "--")}</td>
          <td data-label="Tipo Anomalía"><span class="badge badge-muted">${escapeHtml(i.tipo)}</span></td>
          <td data-label="Severidad">${severidadBadge}</td>
          <td data-label="Diagnóstico" class="cell-stacked" style="font-size: 0.85rem; width: 100%; overflow-wrap: anywhere; word-break: break-word;">${escapeHtml(i.mensaje)}</td>
          <td data-label="Estado">${estadoBadge}</td>
          <td data-label="Acción" class="table-actions" style="text-align: right;">${btnAccion}</td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color: var(--status-danger);">Error al cargar incidentes: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function evaluarAlertasEnVivo() {
  window.Toast.info("Ejecutando motor de evaluación de reglas...", "Diagnóstico");
  try {
    const res = await window.api.alertas.evaluar();
    if (res.totalNuevos > 0) {
      window.Toast.warning(
        `Se detectaron ${res.totalNuevos} nuevo(s) incidente(s) operativos.`,
        "Alertas Activas"
      );
    } else {
      window.Toast.success("Evaluación completa. No se hallaron nuevas anomalías.", "Diagnóstico");
    }
    await cargarAlertasIncidentes();
    await actualizarResumenAlertas();
  } catch (err) {
    window.Toast.error(err.message || "Error al evaluar alertas", "Fallo");
  }
}

function abrirModalResolverIncidente(id, mensaje, medidor) {
  document.getElementById("resolverIncidenteId").value = id;
  document.getElementById("resolverIncidenteMensaje").innerText = mensaje;
  document.getElementById("resolverIncidenteMeta").innerText = `Medidor: ${medidor}`;
  document.getElementById("formResolverIncidente").reset();
  window.Modal.open("modalResolverIncidente");
}

async function submitResolverIncidente(event) {
  event.preventDefault();
  const id = document.getElementById("resolverIncidenteId").value;
  const estado = document.getElementById("resolverEstado").value;
  const notasResolucion = document.getElementById("resolverNotas").value;

  try {
    await window.api.alertas.resolverIncidente(id, { estado, notasResolucion });
    window.Toast.success("Incidente actualizado exitosamente.", "Resolución");
    window.Modal.close("modalResolverIncidente");
    await cargarAlertasIncidentes();
    await actualizarResumenAlertas();
  } catch (err) {
    window.Toast.error(err.message || "Error al resolver incidente", "Fallo");
  }
}

async function cargarReglasAlertas() {
  const tbody = document.getElementById("tbodyReglasAlertas");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Consultando reglas configuradas...</td></tr>`;

  try {
    const reglas = await window.api.alertas.getReglas();
    if (reglas.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No hay reglas de alerta configuradas.</td></tr>`;
      return;
    }
    tbody.innerHTML = reglas.map((r) => `
      <tr>
        <td data-label="Regla"><strong>${escapeHtml(r.nombre)}</strong></td>
        <td data-label="Tipo"><span class="badge badge-muted">${escapeHtml(r.tipo)}</span></td>
        <td data-label="Recurso">${escapeHtml(r.recurso || "Todos")}</td>
        <td data-label="Umbral" class="font-mono">${r.umbralValor}</td>
        <td data-label="Estado">${r.activa ? `<span class="badge badge-emerald">Activa</span>` : `<span class="badge badge-muted">Inactiva</span>`}</td>
      </tr>
    `).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="color: var(--status-danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function submitCrearRegla(event) {
  event.preventDefault();
  const nombre = document.getElementById("reglaNombre").value;
  const tipo = document.getElementById("reglaTipo").value;
  const recurso = document.getElementById("reglaRecurso").value || undefined;
  const umbralValor = parseFloat(document.getElementById("reglaUmbral").value);

  try {
    await window.api.alertas.createRegla({
      nombre,
      tipo,
      recurso,
      umbralValor,
      activa: true,
    });
    window.Toast.success("Regla de alerta creada exitosamente.", "Configuración");
    document.getElementById("formCrearRegla").reset();
    await cargarReglasAlertas();
  } catch (err) {
    window.Toast.error(err.message || "Error al crear regla", "Fallo");
  }
}

// ==============================================================================
// 7. FUNCIONALIDADES: MANTENIMIENTO, CALIBRACIÓN & PRECINTOS (FEAT-009)
// ==============================================================================

let todosLosMedidoresCache = [];

async function poblarSelectsMantenimiento() {
  const selectModal = document.getElementById("mantMedidorId");
  const selectFicha = document.getElementById("selectFichaMedidor");

  const prevModalVal = selectModal?.value;
  const prevFichaVal = selectFicha?.value;

  try {
    // Cargar todos los medidores de todas las instalaciones
    todosLosMedidoresCache = [];
    for (const inst of instalacionesCache) {
      const medidores = await window.api.medidores.getByInstalacion(inst.id);
      todosLosMedidoresCache.push(
        ...medidores.map((m) => ({ ...m, instalacionNombre: inst.nombre }))
      );
    }

    const options = todosLosMedidoresCache.map(
      (m) => `<option value="${m.id}">${escapeHtml(m.codigo)} — ${escapeHtml(m.instalacionNombre)} (${m.activo ? 'Activo' : 'Baja'})</option>`
    ).join("");

    if (selectModal) {
      selectModal.innerHTML = `<option value="">Selecciona un medidor...</option>` + options;
      if (prevModalVal) selectModal.value = prevModalVal;
    }
    if (selectFicha) {
      selectFicha.innerHTML = `<option value="">Selecciona un medidor...</option>` + options;
      if (prevFichaVal) selectFicha.value = prevFichaVal;
    }
  } catch (e) {
    console.warn("Error poblando medidores de mantenimiento:", e);
  }
}

async function openModalRegistrarMantenimiento() {
  await poblarSelectsMantenimiento();
  const inputFecha = document.getElementById("mantFecha");
  if (inputFecha) {
    const ahora = new Date();
    ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
    inputFecha.value = ahora.toISOString().slice(0, 16);
  }
  onMantTipoChange();
  window.Modal.open("modalRegistrarMantenimiento");
}

function onMantMedidorChange() {
  const medidorId = document.getElementById("mantMedidorId")?.value;
  const medidor = todosLosMedidoresCache.find((m) => m.id === medidorId);
  const inputPrecintoAnt = document.getElementById("mantPrecintoAnt");
  if (medidor && inputPrecintoAnt) {
    inputPrecintoAnt.value = medidor.precintoActual || "";
  }
}

function onMantTipoChange() {
  const tipo = document.getElementById("mantTipo")?.value;
  const seccionPrecinto = document.getElementById("mantSeccionPrecinto");
  const seccionCalib = document.getElementById("mantSeccionCalibracion");
  const seccionBaja = document.getElementById("mantSeccionBaja");
  const groupNuevoCodigo = document.getElementById("mantGroupNuevoCodigo");

  if (seccionPrecinto) seccionPrecinto.style.display = (tipo === "CAMBIO_PRECINTO" || tipo === "CALIBRACION" || tipo === "INSPECCION") ? "grid" : "none";
  if (seccionCalib) seccionCalib.style.display = (tipo === "CALIBRACION") ? "grid" : "none";
  if (seccionBaja) seccionBaja.style.display = (tipo === "BAJA_TECNICA" || tipo === "REEMPLAZO_EQUIPO") ? "grid" : "none";
  if (groupNuevoCodigo) groupNuevoCodigo.style.display = (tipo === "REEMPLAZO_EQUIPO") ? "block" : "none";
}

async function submitRegistrarMantenimiento(event) {
  event.preventDefault();
  const medidorId = document.getElementById("mantMedidorId").value;
  const tipo = document.getElementById("mantTipo").value;
  const fechaMantenimiento = document.getElementById("mantFecha").value;
  const tecnicoResponsable = document.getElementById("mantTecnico").value;
  const numeroPrecintoAnterior = document.getElementById("mantPrecintoAnt")?.value || undefined;
  const numeroPrecintoNuevo = document.getElementById("mantPrecintoNuevo")?.value || undefined;
  const proximaCalibracion = document.getElementById("mantProxCalib")?.value || undefined;
  const certificadoCalibracion = document.getElementById("mantCertificado")?.value || undefined;
  const lecturaRetiroVal = document.getElementById("mantLecturaRetiro")?.value;
  const nuevoMedidorCodigo = document.getElementById("mantNuevoMedidorCodigo")?.value || undefined;
  const observaciones = document.getElementById("mantObservaciones")?.value || undefined;

  try {
    await window.api.mantenimiento.registrar({
      medidorId,
      tipo,
      fechaMantenimiento: `${fechaMantenimiento}:00.000Z`,
      tecnicoResponsable,
      numeroPrecintoAnterior,
      numeroPrecintoNuevo,
      proximaCalibracion: proximaCalibracion ? `${proximaCalibracion}T00:00:00.000Z` : undefined,
      certificadoCalibracion,
      lecturaRetiro: lecturaRetiroVal ? parseFloat(lecturaRetiroVal) : undefined,
      nuevoMedidorCodigo,
      observaciones,
    });

    window.Toast.success("Intervención registrada en bitácora exitosamente.", "Mantenimiento");
    window.Modal.close("modalRegistrarMantenimiento");
    document.getElementById("formRegistrarMantenimiento").reset();
    await cargarMantenimientosBitacora();
    await poblarSelectsMantenimiento();
  } catch (err) {
    window.Toast.error(err.message || "Error al registrar mantenimiento", "Fallo");
  }
}

async function cargarMantenimientosBitacora() {
  const tbody = document.getElementById("tbodyMantenimientosBitacora");
  tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Consultando bitácora de intervenciones...</td></tr>`;

  try {
    const list = await window.api.mantenimiento.getAll();
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state">No hay registros de mantenimiento ni calibración todavía.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((m) => {
      const fechaStr = new Date(m.fechaMantenimiento).toLocaleDateString("es-CL");
      const proxCalibStr = m.proximaCalibracion ? new Date(m.proximaCalibracion).toLocaleDateString("es-CL") : "--";

      let badgeTipo = `<span class="badge badge-muted">${escapeHtml(m.tipo)}</span>`;
      if (m.tipo === "CALIBRACION") badgeTipo = `<span class="badge badge-blue">🔬 CALIBRACIÓN</span>`;
      if (m.tipo === "CAMBIO_PRECINTO") badgeTipo = `<span class="badge badge-amber">🔒 PRECINTO</span>`;
      if (m.tipo === "REEMPLAZO_EQUIPO") badgeTipo = `<span class="badge badge-rose">🔄 REEMPLAZO</span>`;
      if (m.tipo === "BAJA_TECNICA") badgeTipo = `<span class="badge badge-rose">⛔ BAJA</span>`;

      return `
        <tr>
          <td data-label="Fecha">${fechaStr}</td>
          <td data-label="Medidor" class="font-mono"><strong>${escapeHtml(m.medidorCodigo || "--")}</strong></td>
          <td data-label="Sede">${escapeHtml(m.instalacionNombre || "--")}</td>
          <td data-label="Tipo Intervención">${badgeTipo}</td>
          <td data-label="Técnico">${escapeHtml(m.tecnicoResponsable)}</td>
          <td data-label="Precinto Ant." class="font-mono">${escapeHtml(m.numeroPrecintoAnterior || "--")}</td>
          <td data-label="Precinto Nuevo" class="font-mono"><strong style="color: var(--accent-primary);">${escapeHtml(m.numeroPrecintoNuevo || "--")}</strong></td>
          <td data-label="Próx. Calibración">${proxCalibStr}</td>
          <td data-label="Detalles" class="cell-stacked" style="font-size: 0.85rem; width: 100%;">
            <div style="width: 100%; overflow-wrap: anywhere; word-break: break-word;">
              ${m.certificadoCalibracion ? `Cert: <strong>${escapeHtml(m.certificadoCalibracion)}</strong><br>` : ""}
              ${m.nuevoMedidorCodigo ? `Reemplazo por: <strong>${escapeHtml(m.nuevoMedidorCodigo)}</strong><br>` : ""}
              ${escapeHtml(m.observaciones || "")}
            </div>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state" style="color: var(--status-danger);">Error al cargar bitácora: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function consultarFichaMedidor() {
  const medidorId = document.getElementById("selectFichaMedidor")?.value;
  const contenedor = document.getElementById("contenedorFichaMedidor");
  if (!medidorId) {
    contenedor.innerHTML = `<div class="empty-state">Selecciona un medidor para inspeccionar su ficha técnica y bitácora.</div>`;
    return;
  }

  contenedor.innerHTML = `<div class="empty-state">Cargando ficha del medidor...</div>`;

  try {
    const ficha = await window.api.mantenimiento.getFichaMedidor(medidorId);

    const ultimaCalibStr = ficha.fechaUltimaCalibracion
      ? new Date(ficha.fechaUltimaCalibracion).toLocaleDateString("es-CL")
      : "No registra";
    const proxCalibStr = ficha.fechaProximaCalibracion
      ? new Date(ficha.fechaProximaCalibracion).toLocaleDateString("es-CL")
      : "No programada";

    contenedor.innerHTML = `
      <div style="background: var(--bg-surface-hover); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--border-subtle); margin-bottom: 1.25rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem;">
          <div>
            <h3 style="font-size: 1.25rem; font-family: var(--font-mono); color: var(--text-primary); margin-bottom: 0.25rem;">
              ${escapeHtml(ficha.codigo)}
            </h3>
            <span style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(ficha.instalacionNombre)}</span>
          </div>
          <div>
            ${ficha.activo ? `<span class="badge badge-emerald">Activo en Terreno</span>` : `<span class="badge badge-rose">Dado de Baja / Inactivo</span>`}
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; border-top: 1px solid var(--border-subtle); padding-top: 1rem;">
          <div>
            <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Precinto de Seguridad Actual:</span>
            <strong class="font-mono" style="color: var(--accent-primary); font-size: 1rem;">${escapeHtml(ficha.precintoActual || "Sin precinto registrado")}</strong>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Última Calibración:</span>
            <strong>${ultimaCalibStr}</strong>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Próxima Calibración:</span>
            <strong>${proxCalibStr}</strong>
          </div>
          <div>
            <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Última Lectura Registrada:</span>
            <strong class="font-mono">${ficha.ultimaLecturaValor !== null ? formatNumber(ficha.ultimaLecturaValor) : "Sin lecturas"}</strong>
          </div>
        </div>
      </div>

      <h4 style="font-size: 0.95rem; margin-bottom: 0.5rem; color: var(--text-primary);">Historial de Intervenciones de este Medidor</h4>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Técnico</th>
              <th>Precinto Ant.</th>
              <th>Precinto Nuevo</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            ${ficha.historial.length === 0 ? `<tr><td colspan="6" class="empty-state">No registra intervenciones en bitácora.</td></tr>` : ficha.historial.map((h) => `
              <tr>
                <td data-label="Fecha">${new Date(h.fechaMantenimiento).toLocaleDateString("es-CL")}</td>
                <td data-label="Tipo"><span class="badge badge-muted">${escapeHtml(h.tipo)}</span></td>
                <td data-label="Técnico">${escapeHtml(h.tecnicoResponsable)}</td>
                <td data-label="Precinto Ant." class="font-mono">${escapeHtml(h.numeroPrecintoAnterior || "--")}</td>
                <td data-label="Precinto Nuevo" class="font-mono">${escapeHtml(h.numeroPrecintoNuevo || "--")}</td>
                <td data-label="Observaciones" class="cell-stacked" style="font-size: 0.85rem; width: 100%; overflow-wrap: anywhere; word-break: break-word;">${escapeHtml(h.observaciones || "--")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    contenedor.innerHTML = `<div class="empty-state" style="color: var(--status-danger);">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// Enlace global para el DOM HTML
window.getCurrentUser = () => currentUser;
window.switchRole = switchRole;
window.loginComo = loginComo;
window.handleLoginSubmit = handleLoginSubmit;
window.cerrarSesion = cerrarSesion;
window.autofillAndLogin = autofillAndLogin;
window.toggleLoginPasswordVisibility = toggleLoginPasswordVisibility;
window.mostrarPantallaLogin = mostrarPantallaLogin;
window.mostrarAppPrincipal = mostrarAppPrincipal;
window.openModal = (id) => window.Modal.open(id);
window.closeModal = (id) => window.Modal.close(id);
window.openModalLectura = openModalLectura;
window.submitLectura = submitLectura;
window.submitNuevaInstalacion = submitNuevaInstalacion;
window.submitNuevoTipo = submitNuevoTipo;
window.submitNuevoMedidor = submitNuevoMedidor;
window.seedDemoData = seedDemoData;
window.onOperadorInstalacionChange = onOperadorInstalacionChange;
window.cargarUsuariosAdmin = cargarUsuariosAdmin;
window.submitCambiarPassword = submitCambiarPassword;
window.submitNuevoUsuario = submitNuevoUsuario;
window.abrirModalEditarUsuario = abrirModalEditarUsuario;
window.submitEditarUsuario = submitEditarUsuario;
window.abrirModalResetPassword = abrirModalResetPassword;
window.submitResetPassword = submitResetPassword;

// Exports para feat-007, feat-008, feat-009
window.cargarReporteConsumos = cargarReporteConsumos;
window.exportarReporteCSV = exportarReporteCSV;
window.cargarFacturasReportes = cargarFacturasReportes;
window.submitRegistrarFactura = submitRegistrarFactura;

window.cargarAlertasIncidentes = cargarAlertasIncidentes;
window.evaluarAlertasEnVivo = evaluarAlertasEnVivo;
window.abrirModalResolverIncidente = abrirModalResolverIncidente;
window.submitResolverIncidente = submitResolverIncidente;
window.cargarReglasAlertas = cargarReglasAlertas;
window.submitCrearRegla = submitCrearRegla;
window.openModalConfigurarReglas = () => {
  window.Modal.open("modalConfigurarReglas");
  cargarReglasAlertas();
};

window.openModalRegistrarMantenimiento = openModalRegistrarMantenimiento;
window.onMantMedidorChange = onMantMedidorChange;
window.onMantTipoChange = onMantTipoChange;
window.submitRegistrarMantenimiento = submitRegistrarMantenimiento;
window.cargarMantenimientosBitacora = cargarMantenimientosBitacora;
window.consultarFichaMedidor = consultarFichaMedidor;

// ------------------------------------------------------------------------------
// 8. AUDITORÍA & TRAZABILIDAD INMUTABLE (HITO 8 / FEAT-011)
// ------------------------------------------------------------------------------
async function cargarEventosAuditoria() {
  const tbody = document.getElementById("tbodyAuditoria");
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Consultando bitácora de auditoría inmutable...</td></tr>';

  try {
    const accionFiltro = document.getElementById("filtroAuditoriaAccion")?.value || undefined;
    const eventos = await window.api.auditoria.getEventos({
      accion: accionFiltro,
      limit: 50,
    });

    if (!eventos || eventos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No se registran eventos de auditoría para los filtros seleccionados.</td></tr>';
      return;
    }

    const accionBadges = {
      CAMBIO_ROL: '<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.3);">🔄 Cambio de Rol</span>',
      RESET_PASSWORD_ADMIN: '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">🔑 Reset Clave</span>',
      BAJA_MEDIDOR: '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">⛔ Baja Medidor</span>',
      CAMBIO_PRECINTO: '<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);">🔒 Precinto</span>',
      LOGIN_FALLIDO: '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">⚠️ Login Fallido</span>',
    };

    tbody.innerHTML = eventos
      .map((e) => {
        const fecha = new Date(e.createdAt).toLocaleString("es-CL", { timeZone: "UTC" });
        const badge = accionBadges[e.accion] || `<span class="badge badge-muted">${escapeHtml(e.accion)}</span>`;
        let detallesHtml = "-";
        if (e.detalles) {
          try {
            detallesHtml = `<pre style="margin: 0; font-size: 0.75rem; white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere; font-family: var(--font-mono); max-width: 100%;">${escapeHtml(JSON.stringify(e.detalles, null, 1))}</pre>`;
          } catch {
            detallesHtml = escapeHtml(String(e.detalles));
          }
        }

        return `
          <tr>
            <td data-label="Fecha / Hora" style="font-size: 0.8rem; font-family: var(--font-mono);">${fecha} UTC</td>
            <td data-label="Acción">${badge}</td>
            <td data-label="Entidad"><span class="badge badge-muted">${escapeHtml(e.entidad)}</span></td>
            <td data-label="ID Referencia" class="font-mono" style="font-size: 0.85rem; color: var(--text-primary); overflow-wrap: anywhere; word-break: break-all;">${escapeHtml(e.entidadId)}</td>
            <td data-label="Detalles" class="cell-stacked" style="width: 100%; max-width: 100%; overflow: hidden;">
              <div style="width: 100%; max-width: 100%; overflow-x: auto;">
                ${detallesHtml}
              </div>
            </td>
            <td data-label="IP Origen" style="font-size: 0.8rem; font-family: var(--font-mono); color: var(--text-muted);">${escapeHtml(e.ip || "127.0.0.1")}</td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    console.error("Error al cargar auditoría:", error);
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color: var(--status-danger);">Error al cargar bitácora: ${escapeHtml(error.message)}</td></tr>`;
    window.Toast.error(error.message, "Auditoría");
  }
}

window.cargarEventosAuditoria = cargarEventosAuditoria;

async function ejecutarBackupSistema() {
  const btn = document.getElementById("btnGenerarBackup");
  if (btn) btn.disabled = true;
  try {
    window.Toast.info("Iniciando copia atómica en caliente de base de datos...", "Respaldo SQLite");
    const res = await window.api.admin.generarBackup();
    const tamanoKb = (res.tamanoBytes / 1024).toFixed(1);
    window.Toast.success(`Snapshot creado: ${res.archivo} (${tamanoKb} KB)`, "Respaldo Exitoso");
    await cargarEventosAuditoria();
  } catch (error) {
    console.error("Error al generar backup:", error);
    window.Toast.error(error.message || "Error al generar backup", "Fallo de Respaldo");
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.ejecutarBackupSistema = ejecutarBackupSistema;

// ------------------------------------------------------------------------------
// 9. INTEGRACIONES & WEBHOOKS (HITO 9 / FEAT-012)
// ------------------------------------------------------------------------------
function toggleEventosCheckboxes(masterCheckbox) {
  const checkboxes = document.querySelectorAll(".ev-item");
  checkboxes.forEach((cb) => {
    cb.disabled = masterCheckbox.checked;
    if (masterCheckbox.checked) cb.checked = false;
  });
}

async function cargarWebhooks() {
  const tbody = document.getElementById("tbodyWebhooks");
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Consultando endpoints registrados...</td></tr>';

  try {
    const list = await window.api.webhooks.getAll();
    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay endpoints de webhook configurados. Haga clic en "+ Nuevo Webhook" para agregar uno.</td></tr>';
      return;
    }

    tbody.innerHTML = list
      .map((w) => {
        const evs = Array.isArray(w.eventos) ? w.eventos : [w.eventos];
        const eventosBadges = evs
          .map((ev) => `<span class="badge badge-muted" style="margin-right: 4px; font-size: 0.75rem;">${escapeHtml(ev)}</span>`)
          .join("");

        const secretBadge = w.hasSecret
          ? '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🔒 HMAC Activo</span>'
          : '<span class="badge badge-muted" style="opacity: 0.7;">Sin Secreto</span>';

        const estadoBadge = w.activo
          ? '<span class="badge badge-success">Activo</span>'
          : '<span class="badge badge-amber">Pausado</span>';

        return `
          <tr>
            <td data-label="Descripción">
              <strong style="color: var(--text-primary); font-size: 0.9rem; overflow-wrap: anywhere; word-break: break-word;">${escapeHtml(w.descripcion)}</strong>
            </td>
            <td data-label="URL Endpoint" class="cell-stacked" style="font-family: var(--font-mono); font-size: 0.8rem; word-break: break-all; overflow-wrap: anywhere; width: 100%;">
              ${escapeHtml(w.url)}
            </td>
            <td data-label="Eventos" class="cell-stacked">
              <div class="badges-wrapper" style="display: flex; flex-wrap: wrap; gap: 0.25rem; width: 100%;">${eventosBadges}</div>
            </td>
            <td data-label="Secreto">${secretBadge}</td>
            <td data-label="Estado">${estadoBadge}</td>
            <td data-label="Acciones" class="table-actions" style="text-align: right; white-space: nowrap;">
              <button class="btn btn-sm btn-outline" onclick="probarWebhook('${w.id}')" title="Enviar Ping de prueba">
                ⚡ Test
              </button>
              <button class="btn btn-sm btn-secondary" onclick="verEntregasWebhook('${w.id}')" title="Ver historial de entregas">
                📋 Logs
              </button>
              <button class="btn btn-sm btn-outline" onclick="toggleActivoWebhook('${w.id}', ${w.activo})" title="${w.activo ? 'Pausar' : 'Activar'}">
                ${w.activo ? '⏸️' : '▶️'}
              </button>
              <button class="btn btn-sm btn-outline" style="color: var(--status-danger);" onclick="eliminarWebhook('${w.id}')" title="Eliminar endpoint">
                🗑️
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    console.error("Error al cargar webhooks:", error);
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color: var(--status-danger);">Error: ${escapeHtml(error.message)}</td></tr>`;
    window.Toast.error(error.message, "Webhooks");
  }
}

async function submitNuevoWebhook(event) {
  event.preventDefault();
  const url = document.getElementById("webhookUrl")?.value?.trim();
  const descripcion = document.getElementById("webhookDescripcion")?.value?.trim();
  const secret = document.getElementById("webhookSecret")?.value?.trim() || null;
  const evTodos = document.getElementById("evTodos")?.checked;

  let eventos = ["*"];
  if (!evTodos) {
    const checked = Array.from(document.querySelectorAll(".ev-item:checked")).map((cb) => cb.value);
    if (checked.length > 0) {
      eventos = checked;
    }
  }

  const btn = document.getElementById("btnGuardarWebhook");
  if (btn) btn.disabled = true;

  try {
    await window.api.webhooks.create({
      url,
      descripcion,
      secret,
      eventos,
      activo: true,
    });

    window.Toast.success(`Webhook «${descripcion}» registrado exitosamente.`, "Integraciones");
    closeModal("modalNuevoWebhook");
    document.getElementById("formNuevoWebhook")?.reset();
    cargarWebhooks();
  } catch (error) {
    console.error("Error al crear webhook:", error);
    window.Toast.error(error.message, "Error Webhook");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function probarWebhook(id) {
  window.Toast.info("Enviando ping de prueba al endpoint...", "Webhooks");
  try {
    const res = await window.api.webhooks.test(id);
    if (res.exitoso) {
      window.Toast.success(
        `Test exitoso: HTTP ${res.statusCode} en ${res.duracionMs}ms`,
        "Webhook OK"
      );
    } else {
      window.Toast.error(
        `Fallo de entrega (${res.statusCode || 'Sin respuesta'}): ${res.error || 'Desconocido'}`,
        "Fallo Webhook"
      );
    }
  } catch (error) {
    window.Toast.error(error.message, "Error al probar webhook");
  }
}

async function verEntregasWebhook(id) {
  openModal("modalEntregasWebhook");
  const tbody = document.getElementById("tbodyEntregasWebhook");
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Consultando entregas...</td></tr>';

  try {
    const entregas = await window.api.webhooks.getEntregas(id);
    if (!entregas || entregas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No se registran entregas recientes para este endpoint.</td></tr>';
      return;
    }

    tbody.innerHTML = entregas
      .map((e) => {
        const fecha = new Date(e.createdAt).toLocaleString("es-CL");
        const statusBadge = e.exitoso
          ? '<span class="badge badge-success">OK</span>'
          : '<span class="badge badge-danger">FALLO</span>';
        const codeText = e.statusCode ? `HTTP ${e.statusCode}` : "-";
        const duracionText = e.duracionMs != null ? `${e.duracionMs} ms` : "-";
        const errorText = e.error ? `<span style="color: var(--status-danger); font-size: 0.75rem;">${escapeHtml(e.error)}</span>` : '<span style="color: var(--text-muted);">-</span>';

        return `
          <tr>
            <td data-label="Fecha" style="font-size: 0.8rem; font-family: var(--font-mono);">${fecha}</td>
            <td data-label="Evento"><span class="badge badge-muted" style="font-size: 0.75rem;">${escapeHtml(e.evento)}</span></td>
            <td data-label="Estado">${statusBadge}</td>
            <td data-label="Código HTTP" class="font-mono" style="font-size: 0.85rem;">${codeText}</td>
            <td data-label="Duración" class="font-mono" style="font-size: 0.85rem;">${duracionText}</td>
            <td data-label="Resultado" class="cell-stacked" style="width: 100%; overflow-wrap: anywhere; word-break: break-word;">${errorText}</td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color: var(--status-danger);">Error: ${escapeHtml(error.message)}</td></tr>`;
  }
}

async function toggleActivoWebhook(id, activoActual) {
  try {
    await window.api.webhooks.update(id, { activo: !activoActual });
    window.Toast.info(`Webhook ${activoActual ? 'pausado' : 'activado'}.`, "Webhooks");
    cargarWebhooks();
  } catch (error) {
    window.Toast.error(error.message, "Error al actualizar estado");
  }
}

async function eliminarWebhook(id) {
  if (!confirm("¿Está seguro de eliminar este endpoint de webhook?")) return;
  try {
    await window.api.webhooks.delete(id);
    window.Toast.success("Endpoint de webhook eliminado.", "Webhooks");
    cargarWebhooks();
  } catch (error) {
    window.Toast.error(error.message, "Error al eliminar");
  }
}

async function evaluarCalibracionesWebhooks() {
  window.Toast.info("Evaluando calibraciones periódicas de medidores...", "Integraciones");
  try {
    const res = await window.api.webhooks.checkCalibraciones();
    window.Toast.success(
      `Evaluación completada: ${res.medidoresEvaluados} medidores analizados, ${res.eventosDespachados} eventos de aviso despachados.`,
      "Calibraciones & Webhooks"
    );
  } catch (error) {
    window.Toast.error(error.message, "Error al evaluar calibraciones");
  }
}

window.toggleEventosCheckboxes = toggleEventosCheckboxes;
window.cargarWebhooks = cargarWebhooks;
window.submitNuevoWebhook = submitNuevoWebhook;
window.probarWebhook = probarWebhook;
window.verEntregasWebhook = verEntregasWebhook;
window.toggleActivoWebhook = toggleActivoWebhook;
window.eliminarWebhook = eliminarWebhook;
window.evaluarCalibracionesWebhooks = evaluarCalibracionesWebhooks;

// ==============================================================================
// 12. NOTIFICACIONES MULTICANAL (TELEGRAM & WEB PUSH) (FEAT-014 / HITO 11)
// ==============================================================================

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

let pushSubscriptionActive = null;

async function inicializarVistaNotificaciones() {
  await actualizarEstadoWebPush();
  await cargarHistorialNotificaciones();
}

async function actualizarEstadoWebPush() {
  const badge = document.getElementById("badgePushStatus");
  const btnToggle = document.getElementById("btnTogglePush");
  const txtBtn = document.getElementById("txtBtnTogglePush");

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    if (badge) {
      badge.textContent = "No compatible";
      badge.className = "badge badge-gray";
    }
    if (btnToggle) btnToggle.disabled = true;
    if (txtBtn) txtBtn.textContent = "Web Push no soportado en este navegador";
    return;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    pushSubscriptionActive = sub;

    if (sub) {
      if (badge) {
        badge.textContent = "Activo en este equipo";
        badge.className = "badge badge-green";
      }
      if (btnToggle) {
        btnToggle.disabled = false;
        btnToggle.className = "btn btn-outline";
      }
      if (txtBtn) txtBtn.textContent = "Desactivar Notificaciones Push";
    } else {
      if (badge) {
        badge.textContent = "Inactivo";
        badge.className = "badge badge-amber";
      }
      if (btnToggle) {
        btnToggle.disabled = false;
        btnToggle.className = "btn btn-primary";
      }
      if (txtBtn) txtBtn.textContent = "Activar Notificaciones Web Push";
    }
  } catch (err) {
    console.error("Error verificando suscripción Web Push:", err);
  }
}

async function toggleWebPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    window.Toast.error("Este navegador no soporta la API de Web Push.", "Incompatible");
    return;
  }

  const btnToggle = document.getElementById("btnTogglePush");
  if (btnToggle) btnToggle.disabled = true;

  try {
    const reg = await navigator.serviceWorker.ready;
    const subActual = await reg.pushManager.getSubscription();

    if (subActual) {
      // Desuscribir
      const endpoint = subActual.endpoint;
      await subActual.unsubscribe();
      await window.api.notificaciones.unsubscribePush(endpoint);
      pushSubscriptionActive = null;
      window.Toast.info("Notificaciones Web Push desactivadas para este navegador.", "Web Push");
    } else {
      // Solicitar permisos al usuario
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        window.Toast.warning("Se denegó el permiso para mostrar notificaciones.", "Permiso Requerido");
        if (btnToggle) btnToggle.disabled = false;
        return;
      }

      // Obtener clave pública VAPID
      const { publicKey } = await window.api.notificaciones.getVapidPublicKey();
      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      // Crear suscripción W3C
      const nuevaSub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Registrar suscripción en el backend
      await window.api.notificaciones.subscribePush(nuevaSub.toJSON());
      pushSubscriptionActive = nuevaSub;
      window.Toast.success("¡Notificaciones Push activadas exitosamente!", "Web Push");
    }

    await actualizarEstadoWebPush();
  } catch (err) {
    window.Toast.error(err.message, "Error en Notificaciones Push");
  } finally {
    if (btnToggle) btnToggle.disabled = false;
  }
}

async function probarWebPush() {
  try {
    window.Toast.info("Despachando notificación Push sintética...", "Prueba Push");
    const res = await window.api.notificaciones.testPush("Alerta Sintética de Prueba", "El canal de Web Push de la PWA está operativo.");
    window.Toast.success(`Envío procesado: ${res.total} entrega(s) despachada(s).`, "Web Push");
    await cargarHistorialNotificaciones();
  } catch (err) {
    window.Toast.error(err.message, "Error al probar Push");
  }
}

async function probarTelegram() {
  const inputMsg = document.getElementById("inputTelegramMsg");
  const mensaje = inputMsg?.value?.trim() || "Prueba de conectividad del Bot de Telegram";

  try {
    window.Toast.info("Enviando mensaje de prueba a Telegram...", "Telegram Bot");
    const res = await window.api.notificaciones.testTelegram(mensaje);
    if (res.exitoso) {
      window.Toast.success("Mensaje entregado exitosamente al chat de Telegram.", "Telegram Bot");
    } else {
      window.Toast.warning(`Telegram no entregado: ${res.error || 'Código HTTP ' + res.statusCode}`, "Telegram Bot");
    }
    await cargarHistorialNotificaciones();
  } catch (err) {
    window.Toast.error(err.message, "Error al conectar con Telegram");
  }
}

async function cargarHistorialNotificaciones() {
  const tbody = document.getElementById("tbodyHistorialNotificaciones");
  if (!tbody) return;

  try {
    const items = await window.api.notificaciones.getHistorial(50);
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No hay registros de notificaciones emitidas aún.</td></tr>`;
      return;
    }

    tbody.innerHTML = items
      .map((item) => {
        const canalBadge =
          item.canal === "TELEGRAM"
            ? `<span class="badge" style="background: rgba(0, 136, 204, 0.15); color: #0088cc; font-weight: 600;">✈️ Telegram</span>`
            : `<span class="badge" style="background: rgba(147, 51, 234, 0.15); color: #9333ea; font-weight: 600;">📱 Web Push</span>`;

        const severidadBadge =
          item.severidad === "CRITICAL"
            ? `<span class="badge badge-red">CRITICAL</span>`
            : item.severidad === "WARNING"
            ? `<span class="badge badge-amber">WARNING</span>`
            : `<span class="badge badge-gray">${item.severidad}</span>`;

        const estadoBadge = item.exitoso
          ? `<span class="badge badge-green">EXITOSO (${item.statusCode || 200})</span>`
          : `<span class="badge badge-red" title="${item.error || ''}">FALLIDO (${item.statusCode || 'ERR'})</span>`;

        const fechaFormateada = new Date(item.createdAt).toLocaleString("es-CL");

        return `
          <tr>
            <td data-label="Canal">${canalBadge}</td>
            <td data-label="Evento"><code>${item.evento}</code></td>
            <td data-label="Destinatario" class="cell-stacked" style="overflow-wrap: anywhere; word-break: break-all; width: 100%;"><small>${escapeHtml(item.destinatario)}</small></td>
            <td data-label="Severidad">${severidadBadge}</td>
            <td data-label="Título" class="cell-stacked" style="overflow-wrap: anywhere; word-break: break-word; width: 100%;"><strong>${escapeHtml(item.titulo)}</strong></td>
            <td data-label="Estado">${estadoBadge}</td>
            <td data-label="Latencia">${item.duracionMs !== null ? item.duracionMs + ' ms' : '-'}</td>
            <td data-label="Fecha y Hora"><small class="text-secondary">${fechaFormateada}</small></td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state text-danger">Error cargando historial: ${err.message}</td></tr>`;
  }
}

window.inicializarVistaNotificaciones = inicializarVistaNotificaciones;
window.toggleWebPushSubscription = toggleWebPushSubscription;
window.probarWebPush = probarWebPush;
window.probarTelegram = probarTelegram;
window.cargarHistorialNotificaciones = cargarHistorialNotificaciones;


