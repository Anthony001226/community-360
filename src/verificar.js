const pool = require('./db');

(async () => {
  console.log('======================================================================');
  console.log('   1. CONTEO DE TABLAS EN AMAZON RDS PostgreSQL (DB: community360)');
  console.log('======================================================================');
  const conteos = await pool.query(`
    SELECT 'cat_plataformas' AS tabla, COUNT(*)::int AS total_registros FROM cat_plataformas
    UNION ALL SELECT 'cat_intereses', COUNT(*)::int FROM cat_intereses
    UNION ALL SELECT 'usuarios', COUNT(*)::int FROM usuarios
    UNION ALL SELECT 'ubicaciones_usuario', COUNT(*)::int FROM ubicaciones_usuario
    UNION ALL SELECT 'metricas_usuario', COUNT(*)::int FROM metricas_usuario
    UNION ALL SELECT 'administradores_sistema', COUNT(*)::int FROM administradores_sistema
    UNION ALL SELECT 'bitacora_etl', COUNT(*)::int FROM bitacora_etl
  `);
  console.table(conteos.rows);

  console.log('\n======================================================================');
  console.log('   2. AUDITORÍA DE PRIVACIDAD (consentimiento_datos = FALSE -> NULL)');
  console.log('======================================================================');
  const muestraPrivacidad = await pool.query(`
    SELECT u.id_usuario, u.alias, u.consentimiento_datos,
           ub.pais, ub.estado, ub.ciudad, ub.latitud, ub.longitud
    FROM usuarios u
    LEFT JOIN ubicaciones_usuario ub ON u.id_usuario = ub.id_usuario
    WHERE u.consentimiento_datos = FALSE
    ORDER BY u.id_usuario
    LIMIT 8
  `);
  console.table(muestraPrivacidad.rows);

  const validacionCero = await pool.query(`
    SELECT
      COUNT(*)::int AS total_usuarios_sin_consentimiento,
      COUNT(ub.id_ubicacion)::int AS ubicaciones_almacenadas_por_error
    FROM usuarios u
    LEFT JOIN ubicaciones_usuario ub ON u.id_usuario = ub.id_usuario
    WHERE u.consentimiento_datos = FALSE
  `);
  console.table(validacionCero.rows);

  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
