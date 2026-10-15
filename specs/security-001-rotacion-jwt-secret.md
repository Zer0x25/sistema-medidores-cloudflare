# security-001: retirar y rotar JWT_SECRET versionado

Solicitud explícita: cerrar el pendiente de seguridad de JWT_SECRET tras publicar
la sincronización Edge. Se autoriza implementar, publicar en el repo Edge y
rotar/desplegar en el Worker productivo existente. La rotación invalida sesiones.
No cambia el algoritmo JWT, las contraseñas, roles, rutas ni datos de negocio.
Compatible con ADR 0000 y ADR 0003; no añade bindings ni arquitectura.

## Archivos editables autorizados
- `specs/security-001-rotacion-jwt-secret.md`, `STATE.md`
- `wrangler.jsonc`, `worker-configuration.d.ts` (solo generación Wrangler)
- `.dev.vars.example`, `.dev.vars` (ignorado, clave local independiente)
- `scripts/create-local-secrets.mjs`, `scripts/setup-local.sh`, `scripts/verify.sh`
- `tests/unit/jwt-secret-config.test.ts`

Protegidos: ADRs existentes, código de dominio/autenticación, dependencias,
repo padre, D1/KV/datos de negocio e historia Git existente.

## Contrato y controles
- `vars` no contiene JWT_SECRET. En producción el binding existente pasa de
  plain_text a secret_text con una clave criptográfica aleatoria nueva de 48 bytes.
- No se imprimen valores ni tokens. Los materiales temporales quedan fuera del
  repo, en directorio 0700 y archivos 0600, y se eliminan al concluir.
- Retirar el antiguo valor también de ejemplo y bootstrap; plantilla con marcador
  no operativo. Cada `.dev.vars` nuevo recibe una clave independiente con
  `node:crypto.randomBytes(48)`, permisos 0600, sin sobrescribir archivos existentes.
- Conservar las variables locales no secretas (NODE_ENV, LOG_LEVEL, expiración):
  no activar secrets.required que excluiría estas variables de .dev.vars en Wrangler.
- Usar `wrangler deploy --secrets-file` para publicar configuración y secreto juntos;
  conservar los demás bindings/vars. Deploys posteriores preservan secretos.
- Regenerar tipos: JWT_SECRET debe ser string, nunca un valor literal sensible.
- Obtener token válido mediante login antes de rotar; después debe recibir 401
  UNAUTHORIZED; login nuevo y consulta privada deben seguir funcionando.
- La clave antigua permanece en historia Git, retirada e inválida en producción.
  No se reescribe historia ni se borran versiones sin petición específica.

## Verificación (TDD)
- Fase roja: configuración sin JWT_SECRET, generador local único/privado/idempotente,
  bootstrap y gate sin copias de claves estáticas.
- HTTP: token firmado con clave anterior rechazado con 401; nuevo token 200.
- Quality Gate completo, empaquetado dry-run y comprobación de archivos versionados.
- Remoto: binding secret_text (sin exponer valor), probes 200, token anterior 401,
  login/token nuevos válidos, repo limpio y sincronizado al terminar.
