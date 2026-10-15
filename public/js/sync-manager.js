/**
 * SyncManager - Gestor de Sincronización Resiliente Fuera de Línea (PWA / Offline-First)
 * Permite capturar lecturas en terreno sin cobertura, almacenarlas localmente y
 * sincronizarlas en lote con el backend al recuperar conectividad con retroceso exponencial.
 * ADR 0009 / Hito 12: Production Hardening
 */
class SyncManager {
  constructor() {
    this.storageKey = "medidores_offline_queue";
    this.isSyncing = false;
    this.onSyncCompleteCallbacks = [];
    this.reintentosFallidos = 0;
    this.baseDelayMs = 2000;
    this.maxDelayMs = 60000;
    this.retryTimeoutId = null;
    this.proximoReintentoTimestamp = null;
    // Healthcheck real frontend -> backend (feat-027)
    // backendOnline: true = /readyz 200, false = sin servidor/degradado, null = aún sin verificar
    this.backendOnline = null;
    this.backendDegradado = false;
    this.lastHealthLatencyMs = null;
    this.healthCheckIntervalMs = 30000;
    this.healthCheckTimerId = null;
    this.healthCheckInFlight = false;
  }

  init() {
    // Registrar listeners de red
    window.addEventListener("online", () => {
      this.cancelarReintentos();
      this.actualizarUI();
      if (window.Toast) {
        window.Toast.info("Conexión a internet restablecida. Verificando servidor...", "Conectado");
      }
      void this.verificarSaludBackend();
      this.sincronizar();
    });

    window.addEventListener("offline", () => {
      this.cancelarReintentos();
      this.actualizarUI();
      if (window.Toast) {
        window.Toast.warning("Sin conexión de red. Las lecturas se guardarán localmente.", "Modo Desconectado");
      }
    });

    // Registrar Service Worker si el navegador lo soporta
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .then((reg) => {
            console.log("[PWA] Service Worker registrado con éxito en ámbito:", reg.scope);
          })
          .catch((err) => {
            console.warn("[PWA] No se pudo registrar Service Worker:", err);
          });
      });
    }

    // Actualización inicial de la interfaz
    this.actualizarUI();

    // Clic en el badge fuerza re-verificación inmediata (diagnóstico manual)
    const badgeInicial = document.getElementById("networkStatusBadge");
    if (badgeInicial && !badgeInicial.dataset.healthClickBound) {
      badgeInicial.dataset.healthClickBound = "true";
      badgeInicial.style.cursor = "pointer";
      badgeInicial.addEventListener("click", () => {
        void this.verificarSaludBackend();
      });
    }

    // Healthcheck real contra el backend (feat-027) + polling cada 30s
    void this.verificarSaludBackend();
    this.iniciarVerificacionPeriodica();

    // Si al iniciar estamos en línea y hay pendientes, sincronizar
    if (this.isOnline() && this.contarPendientes() > 0) {
      setTimeout(() => this.sincronizar(), 1500);
    }
  }

  iniciarVerificacionPeriodica() {
    if (this.healthCheckTimerId) {
      clearInterval(this.healthCheckTimerId);
      this.healthCheckTimerId = null;
    }
    this.healthCheckTimerId = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void this.verificarSaludBackend();
    }, this.healthCheckIntervalMs);
  }

  /**
   * Verifica conectividad real con el backend vía GET /readyz (público, sin auth).
   * No emite Toasts: solo actualiza el badge. Timeout 5s con AbortController.
   */
  async verificarSaludBackend() {
    if (!this.isOnline()) {
      this.actualizarUI();
      return { ok: false, motivo: "OFFLINE_LOCAL" };
    }
    if (this.healthCheckInFlight) return { ok: this.backendOnline === true };
    this.healthCheckInFlight = true;
    try {
      let status = 0;
      let latenciaMs = null;
      if (window.api && window.api.salud && typeof window.api.salud.verificarReadyz === "function") {
        const res = await window.api.salud.verificarReadyz(5000);
        status = res.status;
        latenciaMs = res.latenciaMs;
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const inicio = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        try {
          const res = await fetch("/readyz", { method: "GET", signal: controller.signal, cache: "no-store" });
          status = res.status;
          const fin = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
          latenciaMs = Math.round(fin - inicio);
        } finally {
          clearTimeout(timer);
        }
      }
      this.lastHealthLatencyMs = latenciaMs;
      if (status === 200) {
        this.backendOnline = true;
        this.backendDegradado = false;
      } else if (status === 503) {
        this.backendOnline = false;
        this.backendDegradado = true;
      } else {
        this.backendOnline = false;
        this.backendDegradado = false;
      }
      return { ok: this.backendOnline === true, status, latenciaMs };
    } catch (err) {
      // Sin respuesta del backend con red local OK => "Sin servidor" (no es Modo Offline)
      if (this.isOnline()) {
        this.backendOnline = false;
        this.backendDegradado = false;
        this.lastHealthLatencyMs = null;
      }
      const motivo = err && err.name === "AbortError" ? "timeout 5s" : (err && err.message ? err.message : "fetch fallido");
      console.warn(`[SyncManager] Healthcheck /readyz falló (${motivo}).`);
      return { ok: false, motivo };
    } finally {
      this.healthCheckInFlight = false;
      this.actualizarUI();
    }
  }

  getEstadoConexion() {
    return {
      redLocal: this.isOnline(),
      backendOnline: this.backendOnline,
      backendDegradado: this.backendDegradado,
      latenciaMs: this.lastHealthLatencyMs,
    };
  }

  isOnline() {
    return navigator.onLine;
  }

  onSyncComplete(callback) {
    if (typeof callback === "function") {
      this.onSyncCompleteCallbacks.push(callback);
    }
  }

  obtenerCola() {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  guardarCola(cola) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(cola));
      this.actualizarUI();
    } catch (err) {
      console.error("[SyncManager] Error guardando cola en localStorage:", err);
    }
  }

  contarPendientes() {
    const cola = this.obtenerCola();
    return cola.filter((item) => item.status !== "SYNCED").length;
  }

  encolarLectura(payload, medidorEtiqueta = "") {
    const localId = `offline-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const nuevoItem = {
      localId,
      medidorId: payload.medidorId,
      medidorEtiqueta: medidorEtiqueta || payload.medidorId,
      operadorId: payload.operadorId,
      valor: payload.valor,
      fechaLectura: payload.fechaLectura || payload.timestamp || new Date().toISOString(),
      notas: payload.notas || payload.observaciones || "",
      status: "PENDING",
      timestampGuardado: new Date().toISOString(),
      intentos: 0,
    };

    const cola = this.obtenerCola();
    cola.push(nuevoItem);
    this.guardarCola(cola);

    return nuevoItem;
  }

  programarReintentoExponencial() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    if (!this.isOnline() || this.contarPendientes() === 0) return;

    // Backoff exponencial con jitter: Math.min(60s, base * 2^intentos) * (1 ± 0.15)
    const exponente = Math.min(this.reintentosFallidos, 5);
    const delayBase = Math.min(this.maxDelayMs, this.baseDelayMs * Math.pow(2, exponente));
    const jitter = 1 + (Math.random() * 0.3 - 0.15);
    const delay = Math.round(delayBase * jitter);

    console.log(`[SyncManager] Programando reintento en ${Math.round(delay / 1000)}s (intento #${this.reintentosFallidos})`);

    this.proximoReintentoTimestamp = Date.now() + delay;
    this.actualizarUI();

    this.retryTimeoutId = setTimeout(() => {
      this.retryTimeoutId = null;
      this.proximoReintentoTimestamp = null;
      if (this.isOnline() && this.contarPendientes() > 0) {
        this.sincronizar();
      }
    }, delay);
  }

  cancelarReintentos() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
      this.retryTimeoutId = null;
    }
    this.proximoReintentoTimestamp = null;
    this.reintentosFallidos = 0;
  }

  async sincronizar() {
    if (this.isSyncing) return;
    if (!this.isOnline()) {
      if (window.Toast) {
        window.Toast.warning("No hay conexión a internet para sincronizar.");
      }
      return;
    }

    let cola = this.obtenerCola();
    const pendientes = cola.filter((item) => item.status !== "SYNCED");
    if (pendientes.length === 0) {
      this.cancelarReintentos();
      return;
    }

    this.isSyncing = true;
    this.actualizarUI();

    try {
      const payloadBatch = {
        lecturas: pendientes.map((item) => ({
          localId: item.localId,
          medidorId: item.medidorId,
          operadorId: item.operadorId,
          valor: item.valor,
          fechaLectura: item.fechaLectura,
          notas: item.notas || undefined,
        })),
      };

      const res = await window.api.lecturas.sincronizarLote(payloadBatch);

      // Éxito en transporte: backend alcanzable + resetear backoff
      this.backendOnline = true;
      this.backendDegradado = false;
      this.reintentosFallidos = 0;
      this.cancelarReintentos();

      // Procesar resultados del lote
      const mapResultados = new Map(res.results.map((r) => [r.localId, r]));

      cola = cola.filter((item) => {
        const resultado = mapResultados.get(item.localId);
        if (resultado && resultado.status === "SYNCED") {
          // Remover de la cola local porque ya está en base de datos
          return false;
        }
        if (resultado && resultado.status === "REJECTED") {
          item.status = "REJECTED";
          item.errorMsg = resultado.error?.message || "Rechazado por validación";
          item.intentos = (item.intentos || 0) + 1;
        }
        return true;
      });

      this.guardarCola(cola);

      if (window.Toast) {
        if (res.syncedCount > 0 && res.rejectedCount === 0) {
          window.Toast.success(`Sincronización completa: ${res.syncedCount} lectura(s) registradas en el servidor.`);
        } else if (res.syncedCount > 0 && res.rejectedCount > 0) {
          window.Toast.warning(`${res.syncedCount} sincronizadas, ${res.rejectedCount} rechazada(s) por validación.`);
        } else if (res.rejectedCount > 0) {
          window.Toast.error(`${res.rejectedCount} lectura(s) no pudieron sincronizarse.`);
        }
      }

      // Notificar a observadores para refrescar pantallas
      this.onSyncCompleteCallbacks.forEach((cb) => {
        try {
          cb(res);
        } catch (e) {
          console.error("[SyncManager] Error en callback de sincronización:", e);
        }
      });
    } catch (err) {
      console.warn("[SyncManager] Error de red o servidor al sincronizar lote:", err);
      // Si hay red local pero el lote falló por transporte, marcar backend inalcanzable
      const esFalloTransporte =
        !err || err.status === 0 || err.code === "NETWORK_ERROR" || err.name === "TypeError";
      if (esFalloTransporte && this.isOnline()) {
        this.backendOnline = false;
        this.backendDegradado = false;
      }
      this.reintentosFallidos = (this.reintentosFallidos || 0) + 1;
      this.programarReintentoExponencial();
      if (window.Toast) {
        window.Toast.error("Fallo temporal de conexión al sincronizar lote. Reintento automático programado.");
      }
    } finally {
      this.isSyncing = false;
      this.actualizarUI();
    }
  }

  descartarRechazadas() {
    let cola = this.obtenerCola();
    cola = cola.filter((item) => item.status !== "REJECTED");
    this.guardarCola(cola);
    if (window.Toast) {
      window.Toast.info("Lecturas rechazadas descartadas de la cola.");
    }
  }

  actualizarUI() {
    // 1. Badge de conectividad con healthcheck real (feat-027)
    const badgeRed = document.getElementById("networkStatusBadge");
    if (badgeRed) {
      if (!this.isOnline()) {
        badgeRed.className = "network-badge offline";
        badgeRed.innerHTML = `<span class="network-dot"></span><span>Modo Offline</span>`;
        badgeRed.title = "Sin conexión de red: las lecturas se guardan localmente";
        badgeRed.dataset.backend = "offline-local";
      } else if (this.backendOnline === false) {
        badgeRed.className = "network-badge degraded";
        if (this.backendDegradado) {
          badgeRed.innerHTML = `<span class="network-dot"></span><span>Servidor degradado</span>`;
          badgeRed.title = "Servidor responde pero base de datos no lista (/readyz 503)";
          badgeRed.dataset.backend = "degraded";
        } else {
          badgeRed.innerHTML = `<span class="network-dot"></span><span>Sin servidor</span>`;
          badgeRed.title = "Red local OK pero sin respuesta del backend (/readyz)";
          badgeRed.dataset.backend = "unreachable";
        }
      } else {
        badgeRed.className = "network-badge online";
        badgeRed.innerHTML = `<span class="network-dot"></span><span>En línea</span>`;
        badgeRed.title = this.lastHealthLatencyMs !== null && this.lastHealthLatencyMs !== undefined
          ? `Conectado al servidor (${this.lastHealthLatencyMs} ms)`
          : "Conexión activa con el servidor";
        badgeRed.dataset.backend = this.backendOnline === true ? "online" : "online-pending";
      }
    }

    // 2. Botón / Badge de pendientes
    const btnSync = document.getElementById("syncQueueBtn");
    const badgePendientes = document.getElementById("syncQueueCount");
    const count = this.contarPendientes();

    if (btnSync && badgePendientes) {
      if (count > 0) {
        btnSync.style.display = "inline-flex";
        badgePendientes.textContent = count;
        if (this.isSyncing) {
          btnSync.classList.add("loading");
          btnSync.setAttribute("disabled", "true");
        } else {
          btnSync.classList.remove("loading");
          btnSync.removeAttribute("disabled");
          if (this.proximoReintentoTimestamp) {
            const segundos = Math.max(1, Math.round((this.proximoReintentoTimestamp - Date.now()) / 1000));
            btnSync.title = `Reintentando en ${segundos}s... Haz clic para forzar sincronización ahora.`;
          } else {
            btnSync.title = "Sincronizar lecturas pendientes con el servidor";
          }
        }
      } else {
        btnSync.style.display = "none";
      }
    }
  }
}

// Exportar singleton global para el frontend
window.syncManager = new SyncManager();
