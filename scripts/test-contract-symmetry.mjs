// ==============================================================================
// TEST AUTOMATIZADO: SIMETRÍA DE CONTRATO Y PREVENCIÓN DE LEAKS EN UI
// Valida que los datos escritos se entreguen simétricamente y que ninguna
// plantilla o componente renderice 'undefined', 'null', 'NaN' o 'Invalid Date'.
// ==============================================================================

const isRemote = process.argv.includes("--remote");
const BASE_URL = process.env.API_BASE_URL || (isRemote ? "https://metric.zer0x.org" : "http://127.0.0.1:8787");
const FORBIDDEN_STRINGS = ["undefined", "null", "NaN", "Invalid Date", "[object Object]"];

function assertNoLeak(text, context) {
  if (typeof text !== "string") {
    text = String(text);
  }
  for (const forbidden of FORBIDDEN_STRINGS) {
    if (text.includes(forbidden)) {
      throw new Error(`[LEAK DETECTADO en ${context}]: La salida contiene '${forbidden}' -> "${text}"`);
    }
  }
}

async function run() {
  console.log(`\n🧪 INICIANDO TEST DE SIMETRÍA DE CONTRATO contra ${BASE_URL}...`);
  if (!isRemote && !process.env.API_BASE_URL) {
    console.log(`   (Modo LOCAL por defecto. Usa '--remote' o API_BASE_URL para apuntar a producción)\n`);
  }

  // 0. Verificación preliminar de conectividad (Health Check)
  try {
    const pingRes = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    if (!pingRes.ok) {
      console.warn(`⚠️ Advertencia: /healthz respondió HTTP ${pingRes.status}`);
    }
  } catch (pingErr) {
    if (!isRemote) {
      console.error(`\n❌ Error de Conexión: No se pudo contactar ${BASE_URL}`);
      console.error(`   Asegúrate de tener corriendo el servidor local en otra terminal:`);
      console.error(`   👉 npm run dev\n`);
      console.error(`   O para probar contra la nube en producción:`);
      console.error(`   👉 npm run test:contract:remote\n`);
      process.exit(1);
    }
    throw pingErr;
  }

  // 1. Autenticación como Admin
  console.log("1️⃣ Autenticando usuario ADMIN...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@medidores.cl", password: "demo1234" }),
  });
  if (!loginRes.ok) throw new Error(`Fallo de login: HTTP ${loginRes.status}`);
  const { token } = await loginRes.json();
  const authHeaders = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  console.log("   ✓ Token JWT obtenido correctamente.");

  // 2. Creación de Instalación
  const testInstInput = {
    nombre: `Sede Test Contrato ${Date.now()}`,
    ubicacion: "Av. Las Industrias 7800, San Bernardo",
  };
  console.log(`2️⃣ Creando Instalación: "${testInstInput.nombre}"...`);
  const createInstRes = await fetch(`${BASE_URL}/api/instalaciones`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(testInstInput),
  });
  if (!createInstRes.ok) throw new Error(`Error creando instalacion: HTTP ${createInstRes.status}`);
  const instCreated = await createInstRes.json();

  // Simetría inmediata en POST
  if (instCreated.nombre !== testInstInput.nombre) {
    throw new Error(`Asimetría en nombre: enviado "${testInstInput.nombre}", recibido "${instCreated.nombre}"`);
  }
  if (!instCreated.ubicacion || !instCreated.direccion) {
    throw new Error(`Asimetría en dirección/ubicación: faltan propiedades en objeto devuelto.`);
  }

  // 3. Verificación de Entrega en GET /api/instalaciones
  console.log("   🔍 Verificando lectura de instalaciones...");
  const listInstRes = await fetch(`${BASE_URL}/api/instalaciones`, { headers: authHeaders });
  const instalaciones = await listInstRes.json();
  const foundInst = instalaciones.find((i) => i.id === instCreated.id);
  if (!foundInst) throw new Error("La instalación creada no aparece en el listado GET.");

  // Simulación de renderizado del <select> de la interfaz
  const renderedInstOption = `${foundInst.nombre} (${foundInst.ubicacion || foundInst.direccion})`;
  console.log(`   📋 Render en select de UI: "${renderedInstOption}"`);
  assertNoLeak(renderedInstOption, "Select de Instalaciones");

  // 4. Creación de Tipo de Medidor
  const testTipoInput = {
    nombre: `Tipo Sensor Test ${Date.now()}`,
    recurso: "GAS",
    unidad: "M3",
    tipoMedicion: "ACUMULATIVO",
  };
  console.log(`\n3️⃣ Creando Tipo de Medidor: "${testTipoInput.nombre}"...`);
  const createTipoRes = await fetch(`${BASE_URL}/api/tipos-medidor`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(testTipoInput),
  });
  if (!createTipoRes.ok) throw new Error(`Error creando tipo de medidor: HTTP ${createTipoRes.status}`);
  const tipoCreated = await createTipoRes.json();

  const listTiposRes = await fetch(`${BASE_URL}/api/tipos-medidor`, { headers: authHeaders });
  const tipos = await listTiposRes.json();
  const foundTipo = tipos.find((t) => t.id === tipoCreated.id);
  if (!foundTipo) throw new Error("El tipo creado no aparece en el listado GET.");

  // Simulación de renderizado del dropdown de tipos en UI
  const u = foundTipo.unidadMedida || foundTipo.unidad || "";
  const renderedTipoOption = `${foundTipo.nombre} (${foundTipo.recurso}${u ? " - " + u : ""})`;
  console.log(`   📋 Render en select de tipos: "${renderedTipoOption}"`);
  assertNoLeak(renderedTipoOption, "Select de Tipos de Medidor");

  // 5. Creación de Medidor Físico
  const testMedidorInput = {
    instalacionId: foundInst.id,
    tipoMedidorId: foundTipo.id,
    codigo: `MED-TEST-${Date.now().toString().slice(-4)}`,
    numeroSerie: `SN-TEST-${Date.now().toString().slice(-6)}`,
    ubicacionInterna: "Sector Calderas B-1",
    precintoActual: "PREC-10020",
  };
  console.log(`\n4️⃣ Creando Medidor: "${testMedidorInput.codigo}"...`);
  const createMedRes = await fetch(`${BASE_URL}/api/medidores`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(testMedidorInput),
  });
  if (!createMedRes.ok) throw new Error(`Error creando medidor: HTTP ${createMedRes.status}`);
  const medCreated = await createMedRes.json();

  // 6. Registro de Lectura y Verificación de Fechas
  const testLecturaInput = {
    medidorId: medCreated.id,
    valor: 450.25,
    timestamp: new Date().toISOString(),
    observaciones: "Lectura de prueba para verificar simetría y fechas",
  };
  console.log(`\n5️⃣ Registrando Lectura inicial: ${testLecturaInput.valor} ${foundTipo.unidad}...`);
  const createLecRes = await fetch(`${BASE_URL}/api/lecturas`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(testLecturaInput),
  });
  if (!createLecRes.ok) throw new Error(`Error registrando lectura: HTTP ${createLecRes.status}`);
  const lecCreated = await createLecRes.json();

  // 7. Verificación de Entrega en Consulta de Medidores
  console.log("   🔍 Verificando entrega en ficha de medidor...");
  const getMedRes = await fetch(`${BASE_URL}/api/medidores?instalacionId=${foundInst.id}`, { headers: authHeaders });
  const medidores = await getMedRes.json();
  const foundMed = medidores.find((m) => m.id === medCreated.id);
  if (!foundMed) throw new Error("El medidor no aparece en el listado por instalación.");

  const ult = foundMed.ultimaLectura;
  if (!ult) throw new Error("El medidor no reporta 'ultimaLectura' tras el registro.");

  // Comprobar simetría de campos de fecha
  const rawDate = ult.fechaLectura || ult.timestamp || ult.fecha;
  if (!rawDate) throw new Error("La última lectura no contiene ninguna propiedad de fecha.");

  const d = new Date(rawDate);
  if (isNaN(d.getTime())) {
    throw new Error(`La fecha entregada '${rawDate}' es inválida.`);
  }

  const renderedCardDate = d.toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  console.log(`   📋 Render en tarjeta de medidor (fecha): "${renderedCardDate}"`);
  console.log(`   📋 Render en tarjeta de medidor (valor): "${ult.valor} ${foundMed.tipoMedidor.unidadMedida}"`);

  assertNoLeak(renderedCardDate, "Fecha de Tarjeta de Medidor");
  assertNoLeak(`${ult.valor} ${foundMed.tipoMedidor.unidadMedida}`, "Valor y Unidad de Tarjeta");

  // 8. Creación de Usuario, Asignación de Instalación y Verificación Roundtrip (Read-After-Write)
  const testUserEmail = `operador-roundtrip-${Date.now()}@medidores.cl`;
  console.log(`\n6️⃣ Creando Usuario Operador: "${testUserEmail}"...`);
  const createUserRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      email: testUserEmail,
      nombre: "Operador Verificación Persistencia",
      password: "passwordTemporal123!",
      rol: "OPERADOR",
    }),
  });
  if (!createUserRes.ok) throw new Error(`Error creando usuario: HTTP ${createUserRes.status}`);
  const userCreatedData = await createUserRes.json();
  const createdUserId = userCreatedData.usuario?.id || userCreatedData.id;
  if (!createdUserId) throw new Error("La respuesta de registro no contiene ID de usuario.");

  console.log(`   🔍 Asignando instalación «${foundInst.nombre}» al usuario creado...`);
  const patchUserRes = await fetch(`${BASE_URL}/api/usuarios/${createdUserId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      instalacionesIds: [foundInst.id],
    }),
  });
  if (!patchUserRes.ok) throw new Error(`Error asignando instalación: HTTP ${patchUserRes.status}`);

  console.log("   🔍 Verificando que la asignación se mantenga en GET /api/usuarios...");
  const listUsersRes = await fetch(`${BASE_URL}/api/usuarios`, { headers: authHeaders });
  if (!listUsersRes.ok) throw new Error(`Error listando usuarios: HTTP ${listUsersRes.status}`);
  const usersList = await listUsersRes.json();
  const foundUser = usersList.find((u) => u.id === createdUserId);
  if (!foundUser) throw new Error("El usuario recién creado no aparece en GET /api/usuarios.");

  if (!Array.isArray(foundUser.instalaciones) || !foundUser.instalaciones.some((i) => i.id === foundInst.id)) {
    throw new Error(`[BUG DE PERSISTENCIA DETECTADO]: La instalación no fue asignada o no se mantiene en GET /api/usuarios. Instalaciones recibidas: ${JSON.stringify(foundUser.instalaciones)}`);
  }
  console.log("   ✓ Instalación asignada persistida y verificada exitosamente en GET /api/usuarios.");

  // Comprobar que en GET /api/instalaciones/operador/:usuarioId la sede esté presente
  const getInstOpRes = await fetch(`${BASE_URL}/api/instalaciones/operador/${createdUserId}`, { headers: authHeaders });
  if (getInstOpRes.ok) {
    const instOpList = await getInstOpRes.json();
    if (!instOpList.some((i) => i.id === foundInst.id)) {
      throw new Error("La instalación no aparece en GET /api/instalaciones/operador/:usuarioId");
    }
    console.log("   ✓ Instalación verificada en GET /api/instalaciones/operador/:usuarioId.");
  }

  // Simulación de renderizado del badge en UI
  const renderedBadge = `🏢 ${foundUser.instalaciones[0].nombre}`;
  console.log(`   📋 Render en badge de usuario: "${renderedBadge}"`);
  assertNoLeak(renderedBadge, "Badge Instalación Asignada");

  // Desasignación y verificación de que se remueva (roundtrip inverso)
  console.log("   🔍 Desasignando instalación...");
  const patchClearRes = await fetch(`${BASE_URL}/api/usuarios/${createdUserId}`, {
    method: "PATCH",
    headers: authHeaders,
    body: JSON.stringify({
      instalacionesIds: [],
    }),
  });
  if (!patchClearRes.ok) throw new Error(`Error desasignando instalación: HTTP ${patchClearRes.status}`);

  const listUsersAfterRes = await fetch(`${BASE_URL}/api/usuarios`, { headers: authHeaders });
  const usersAfterList = await listUsersAfterRes.json();
  const foundUserAfter = usersAfterList.find((u) => u.id === createdUserId);
  if (foundUserAfter.instalaciones && foundUserAfter.instalaciones.length > 0) {
    throw new Error("[BUG DE PERSISTENCIA DETECTADO]: La desasignación no se mantuvo en base de datos.");
  }
  console.log("   ✓ Desasignación confirmada (0 sedes asignadas).");

  console.log("\n==================================================================");
  console.log("🎉 ¡TEST DE SIMETRÍA EXITOSO! Cero leaks de 'undefined', 'null', 'NaN' o 'Invalid Date'.");
  console.log("==================================================================\n");
}

run().catch((err) => {
  console.error("\n❌ TEST FALLIDO:", err.message);
  process.exit(1);
});
