-- Índices aditivos para feat-026 y feat-028. No modifica datos existentes.
CREATE INDEX IF NOT EXISTS medidores_tipoMedidorId_idx ON medidores(tipoMedidorId);
CREATE INDEX IF NOT EXISTS tipos_medidor_activo_nombre_idx ON tipos_medidor(activo, nombre);
CREATE INDEX IF NOT EXISTS medidores_activo_instalacion_id_idx ON medidores(activo, instalacionId, id);
CREATE INDEX IF NOT EXISTS tipos_medidor_recurso_id_idx ON tipos_medidor(recurso, id);
-- Fechas históricas SQLite y nuevas ISO comparten la misma cronología.
CREATE INDEX IF NOT EXISTS lecturas_medidor_fecha_juliana_valor_idx
  ON lecturas(medidorId, julianday(fechaLectura) DESC, valor DESC);
