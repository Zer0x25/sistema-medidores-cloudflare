# ADR [Número]: [Título de la Decisión Arquitectónica]

- **Fecha:** YYYY-MM-DD
- **Estado:** Propuesto | Aceptado | Reemplazado | Obsoleto
- **Afecta a:** [Módulos, rutas o componentes de Cloudflare Workers/D1/KV/Assets afectados]

---

## 1. Contexto y Problema
[Describe el contexto, la necesidad técnica o de negocio, y las alternativas evaluadas. Explica qué problema se busca resolver y por qué es necesario fijar una decisión formal e inmutable.]

---

## 2. Decisión
[Detalla la decisión técnica adoptada de manera concisa y rigurosa.]

1. **[Punto principal de decisión 1]:** [Detalle de tecnologías, librerías o patrones].
2. **[Punto principal de decisión 2]:** [Reglas de persistencia en D1, transporte o validación Zod].
3. **[Punto principal de decisión 3]:** [Criterios de integración, cuotas Free Tier o separación modular].

---

## 3. Reglas Inmutables para Agentes de IA
[Directrices explícitas para gobernar el comportamiento de los modelos de lenguaje en este repositorio]

- **Obligaciones:** [Lo que el agente SIEMPRE debe hacer respecto a esta decisión].
- **Prohibiciones:** [Lo que el agente NUNCA debe sugerir ni implementar. Ej: prohibido dependencias de C++ nativas o full table scans en D1].

---

## 4. Consecuencias

### Positivas
- [Beneficio 1: Ej. Cero costo de infraestructura en Free Tier]
- [Beneficio 2: Ej. Verificación determinista en Quality Gate]

### Negativas / Trade-offs
- [Costo o limitación asumida: Ej. Límites de memoria y tiempo de CPU en V8 Isolates]
