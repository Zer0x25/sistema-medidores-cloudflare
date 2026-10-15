# Sync Edge: feat-026, feat-027 y feat-028

Solicitud: migrar los cambios pendientes del repositorio principal a `deploy-cloudflare`.
Upstream de referencia: `cdd9d8241c68c64d25b70272e7b54957615f272c`.
Se mantienen Workers/Hono/D1/KV, IDs históricos y contratos públicos. Sin dependencias nuevas.

## Archivos editables autorizados
- `specs/sync-026-028-paridad-upstream.md`, `STATE.md`
- `src/index.ts`, `src/routes/health.ts`, `src/routes/demo.ts`
- `src/routes/medidores.ts`, `src/routes/dashboard.ts`, `src/schemas/sync.schema.ts`
- `migrations/0004_indices_tipos_series.sql`
- `public/app.js`, `public/app.css`, `public/index.html`, `public/js/api.js`
- `public/js/charts.js`, `public/js/sync-manager.js`, `public/sw.js`
- `tests/helpers/sqlite-d1.ts`, `tests/integration/sync-026-028.test.ts`
- `tests/integration/api.test.ts` (expectativa 401 sin sesión)
- `scripts/test-sync-026-028.mjs`

Protegidos: ADRs existentes, secretos, configuración de Wrangler, dependencias,
lockfile, datos remotos, repo padre y commits preexistentes.

## Contratos e invariantes
1. Tipos: GET detalle, listado `estado=activos|archivados|todos`; no ADMIN solo activos.
   PATCH edición, PATCH archivar/restaurar y DELETE solo ADMIN, incluyendo alias
   `/api/medidores/tipos`. Schema Zod para patch (nombre, recurso, unidad,
   tipoMedicion, multiplicador positivo, capacidadMaxima positiva o null).
   Tipos inexistentes: 404 TIPO_MEDIDOR_NOT_FOUND; nombres duplicados: 409
   TIPO_MEDIDOR_NOMBRE_DUPLICADO. Uso cuenta también medidores archivados:
   edición/archivado 409 TIPO_MEDIDOR_EN_USO, borrado 422
   TIPO_MEDIDOR_CON_MEDIDORES_NO_ELIMINABLE. Restauración conserva contrato upstream.
2. PATCH medidor admite tipoMedidorId existente y activo (404/422 tipados),
   auditando antes/después sin modificar lecturas ni multiplicadores históricos.
   Cambios nuevos de tipos y reasignación se guardan junto a su auditoría en
   `DB.batch` transaccional; incluir actor, IP y snapshot. Auditoría append-only.
3. `/api/config` permite simulador y seed solo development/test. Seed responde
   403 DEMO_SEED_DISABLED en staging/production/entorno desconocido o ausente,
   antes de cualquier SQL. El seed no elimina auditoría histórica.
   Seed local conserva aliases existentes y añade seedData (instalaciones,
   medidores, usuarios sin hashes). Probes públicos; frontend y SW alineados a feat-027.
4. GET `/api/dashboard/series`: Zod con IDs string no vacíos (máx 128,
   acepta IDs históricos de Edge y UUID), recurso enum, fechas coercibles,
   limite entero 1..500 default 100. Rango inverso: 400 RANGO_FECHAS_INVALIDO.
   Devuelve hasta 100 medidores activos visibles con puntos más recientes,
   orden ascendente por fecha/valor, incluyendo puntos vacíos; fecha ISO UTC.
   Filtros AND. Sin asignaciones: []; sede explícita ajena: 403
   INSTALACION_NO_ASIGNADA; medidor ajeno: []. Errores Zod 400 VALIDATION_ERROR.
   Sin sesión 401 UNAUTHORIZED; OPERADOR 403 FORBIDDEN. Mantener 404 API inexistente.
5. Perímetro: allowlist exacta, autenticación obligatoria en /api/*; se preserva
   sesión ante contraseña actual incorrecta. Tipos mutantes solo ADMIN;
   dashboard bloqueado para OPERADOR. No cambiar otras políticas de rol.
6. Frontend: portar los 7 archivos divergentes del padre (incluyendo charts.js), conservando app Vanilla y sin dependencias.
   Bump de caché y precarga de charts.js para instalaciones PWA previas.

## Presupuesto D1
- Migración solo aditiva de índices, sin tablas, borrados ni backfill.
- Índices medidores(tipoMedidorId), tipos_medidor(activo,nombre),
  medidores(activo,instalacionId,id), tipos_medidor(recurso,id),
  lecturas(medidorId,julianday(fechaLectura) DESC,valor DESC).
- Series: proyección explícita, LIMIT 100 medidores; lecturas indexadas por medidor
  y fecha, LIMIT <=500; batch de consultas en grupos de 25, sin scans globales.
- Validar SQL y roundtrip con SQLite real en memoria; completar con Wrangler local
  y persistencia temporal aislada. Pruebas remotas mutantes quedan fuera del alcance.

## Criterios de aceptación y verificación
- Fase roja registrada antes de implementar: rutas nuevas, RBAC, seed y filtros.
- Tipos: ciclo crear→bloquear→reasignar→editar→archivar→restaurar→eliminar;
  cada mutación comprobada con GET; auditoría y conservación del historial.
- Series: filtros, capado, orden/desempate, fechas mixtas SQLite/ISO,
  activos, medidor sin lecturas, scope vacío/ajeno, validación y no fuga.
- `./scripts/verify.sh` salida 0; `npm run test:contract` contra Wrangler local;
  `scripts/test-sync-026-028.mjs` contra servidor local aislado; empaquetado
  `wrangler deploy --dry-run`. Sin commit/push/despliegue salvo autorización.

## Evidencia de cierre local (2026-10-14)
- [x] Fase roja: 24 fallos y 4 aciertos iniciales con fixtures válidos; seedData
  adicional en rojo antes del cambio de respuesta.
- [x] Gate: 73/73 pruebas, tipos y lint correctos (salida 0).
- [x] SQLite real: fechas mixtas, filtros, límites, permisos y rollback de
  reasignación ante fallo de auditoría; EXPLAIN usa índice sin TEMP B-TREE.
- [x] D1 local: migraciones 0001–0004 sobre almacenamiento temporal, sin tocar
  `.wrangler/state` preexistente ni recursos remotos.
- [x] `API_BASE_URL=http://127.0.0.1:8797 npm run test:contract` y
  `API_BASE_URL=http://127.0.0.1:8797 node scripts/test-sync-026-028.mjs` en verde.
- [x] 7 E2E upstream (dashboard-graficos, tipos-gestion, pwa-offline-resiliencia)
  ejecutados contra Wrangler local mediante configuración temporal externa.
- [x] Navegador: 320/375/768/1440 px, scrollWidth <= viewport, canvas dibujados,
  buffers de errores vacíos. production local en 8798 oculta demo/simulador,
  muestra login y responde 403 al seed incluso sin tablas inicializadas.
- [x] `wrangler deploy --dry-run` salida 0.
- Publicación Git y despliegue remoto pendientes; no se exportaron ni importaron
  datos de producción. Los cuatro commits locales previos siguen intactos.

## Publicación autorizada (2026-10-14)
El usuario autorizó explícitamente commit, push y despliegue del repo Edge.
Destino: Worker `sistema-medidores-edge`, dominio `metric.zer0x.org`, D1
`sistema-medidores-db` (`6ea20176-bed0-44b1-8126-01d6a232e082`), cuenta
`8d7922f1717a73cfc2192baf0620ac2b`.
Secuencia: Quality Gate, respaldo remoto privado fuera del repo, commit/push,
únicamente migración aditiva 0004, despliegue y verificación remota de lectura.
No ejecutar seed ni suites remotas que creen entidades. Preservar la configuración
remota y los cuatro commits previos. Registrar versión y evidencia en STATE.
