import assert from "node:assert/strict";

// Esta prueba muta datos: solo admite el Worker local de validación.
const base = new URL(process.env.API_BASE_URL || "http://127.0.0.1:8797");
assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Solo se permiten pruebas mutantes en localhost");
async function request(path, { token, method = "GET", body, status = 200 } = {}) {
  const res = await fetch(new URL(path, base), {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
  });
  const data = await res.json();
  assert.equal(res.status, status, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
await request("/readyz");
const seed = await request("/api/demo/seed", { method: "POST" });
assert(seed.seedData.instalaciones.length > 0);
const login = async (email) => (await request("/api/auth/login", { method: "POST", body: { email, password: "demo1234" } })).token;
const token = await login("admin@medidores.cl");
const supervisor = await login("supervisor@medidores.cl");
const operador = await login("operador@medidores.cl");
assert(token && supervisor && operador);
await request("/api/dashboard/series", { status: 401 });
await request("/api/dashboard/series", { token: operador, status: 403 });
await request("/api/dashboard/series?instalacionId=inst-02", { token: supervisor, status: 403 });
const scope = await request("/api/dashboard/series", { token: supervisor });
assert(scope.every((s) => s.instalacionId === "inst-01"));
assert.deepEqual(await request("/api/dashboard/series?medidorId=med-04", { token: supervisor }), []);
for (const query of ["limite=0", "limite=501", "recurso=INVALIDO", "fechaInicio=foo", "fechaInicio=2027-01-01&fechaFin=2026-01-01"]) {
  await request(`/api/dashboard/series?${query}`, { token, status: 400 });
}
const suffix = crypto.randomUUID().slice(0, 8);
const tipoBody = { nombre: `Tipo Sync A ${suffix}`, recurso: "AGUA", unidad: "M3", tipoMedicion: "ACUMULATIVO" };
await request("/api/tipos-medidor", { token: supervisor, method: "POST", body: tipoBody, status: 403 });
const tipoA = await request("/api/tipos-medidor", { token, method: "POST", body: tipoBody, status: 201 });
const tipoB = await request("/api/tipos-medidor", { token, method: "POST", body: { ...tipoBody, nombre: `Tipo Sync B ${suffix}`, multiplicador: 2 }, status: 201 });
const med = await request("/api/medidores", { token, method: "POST", status: 201, body: {
  codigo: `SYNC-${suffix}`, instalacionId: "inst-01", tipoMedidorId: tipoA.id, ubicacionInterna: "Sala de prueba temporal",
} });
assert.equal((await request(`/api/medidores/${med.id}`, { token })).tipoMedidorId, tipoA.id);
const fecha = Date.now() - 3000;
for (const [idx, valor] of [10, 20].entries()) {
  await request("/api/lecturas", { token, method: "POST", status: 201, body: { medidorId: med.id, valor, fechaLectura: new Date(fecha + idx * 1000).toISOString() } });
  const lectura = (await request(`/api/lecturas?medidorId=${med.id}`, { token }))[0];
  assert.equal(lectura.valor, valor);
  assert.equal(lectura.multiplicadorAplicado, 1);
}
const series = await request(`/api/dashboard/series?medidorId=${med.id}`, { token });
assert.deepEqual(series[0].puntos.map((p) => p.valor), [10, 20]);
assert.deepEqual((await request(`/api/dashboard/series?medidorId=${med.id}&limite=1`, { token }))[0].puntos.map((p) => p.valor), [20]);
for (const p of series[0].puntos) assert.equal(new Date(p.fecha).toISOString(), p.fecha);
assert(!/undefined|NaN|Invalid Date|\[object Object\]/.test(JSON.stringify(series)));
assert.equal((await request(`/api/tipos-medidor/${tipoA.id}`, { token, method: "PATCH", body: { nombre: "Bloqueado" }, status: 409 })).error, "TIPO_MEDIDOR_EN_USO");
await request(`/api/tipos-medidor/${tipoA.id}/archivar`, { token, method: "PATCH", status: 409 });
await request(`/api/tipos-medidor/${tipoA.id}`, { token, method: "DELETE", status: 422 });
await request(`/api/medidores/${med.id}`, { token, method: "PATCH", body: { tipoMedidorId: tipoB.id } });
assert.equal((await request(`/api/medidores/${med.id}`, { token })).tipoMedidorId, tipoB.id);
const history = await request(`/api/lecturas?medidorId=${med.id}`, { token });
assert.deepEqual(history.map((l) => l.multiplicadorAplicado), [1, 1]);
await request("/api/lecturas", { token, method: "POST", status: 201, body: { medidorId: med.id, valor: 15, fechaLectura: new Date(fecha + 2000).toISOString() } });
assert.equal((await request(`/api/lecturas?medidorId=${med.id}`, { token }))[0].valor, 30);
const nombre = `Editado ${suffix}`;
await request(`/api/tipos-medidor/${tipoA.id}`, { token, method: "PATCH", body: { nombre } });
assert.equal((await request(`/api/tipos-medidor/${tipoA.id}`, { token })).nombre, nombre);
await request(`/api/tipos-medidor/${tipoA.id}/archivar`, { token, method: "PATCH" });
assert((await request("/api/tipos-medidor?estado=archivados", { token })).some((t) => t.id === tipoA.id && !t.activo));
await request(`/api/tipos-medidor/${tipoA.id}/restaurar`, { token, method: "PATCH" });
assert.equal((await request(`/api/tipos-medidor/${tipoA.id}`, { token })).activo, true);
await request(`/api/tipos-medidor/${tipoA.id}`, { token, method: "DELETE" });
await request(`/api/tipos-medidor/${tipoA.id}`, { token, status: 404 });
console.log("Sync 026–028: permisos, filtros, cronología, roundtrip de tipos/lecturas y conservación de factores verificados en Wrangler local.");
