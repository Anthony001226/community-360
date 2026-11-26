require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const {
  CreateTableCommand,
  DescribeTableCommand,
  waitUntilTableExists,
} = require('@aws-sdk/client-dynamodb');
const { BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const pool = require('./db');
const { dynamoClient, docClient } = require('./dynamo');

const ROOT_DIR = path.resolve(__dirname, '..');
const USUARIOS_CSV = path.join(ROOT_DIR, 'comunidad_virtual_usuarios.csv');
const INTERACCIONES_CSV = path.join(ROOT_DIR, 'comunidad_virtual_1000_interacciones.csv');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output_depurado');

function readCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(
        csv({
          mapHeaders: ({ header }) => header.trim().replace(/^\uFEFF/, ''),
        })
      )
      .on('data', (row) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

function convertDateDMYtoYMD(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }
  return trimmed;
}

function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function writeCsvFile(filePath, headers, rows) {
  const headerLine = headers.join(',');
  const lines = rows.map((row) =>
    headers.map((h) => escapeCsvValue(row[h])).join(',')
  );
  fs.writeFileSync(filePath, [headerLine, ...lines].join('\n'), 'utf8');
}

async function ensurePostgresDatabase() {
  const adminPool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 10000,
  });

  try {
    const targetDb = process.env.DB_NAME || 'community360';
    const check = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDb]
    );
    if (check.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE ${targetDb}`);
      console.log(`   [RDS] Base de datos "${targetDb}" creada exitosamente.`);
    } else {
      console.log(`   [RDS] Base de datos "${targetDb}" verificada (ya existe).`);
    }
  } finally {
    await adminPool.end();
  }
}

async function ensureDynamoTable(tableName, partitionKey) {
  try {
    const desc = await dynamoClient.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    if (desc.Table && desc.Table.TableStatus !== 'ACTIVE') {
      console.log(`   [DynamoDB] Esperando a que la tabla "${tableName}" esté ACTIVE...`);
      await waitUntilTableExists(
        { client: dynamoClient, maxWaitTime: 120 },
        { TableName: tableName }
      );
    }
    console.log(`   [DynamoDB] Tabla "${tableName}" disponible y ACTIVE.`);
  } catch (err) {
    if (err.name === 'ResourceNotFoundException') {
      console.log(`   [DynamoDB] Creando tabla "${tableName}" (PK: ${partitionKey})...`);
      await dynamoClient.send(
        new CreateTableCommand({
          TableName: tableName,
          AttributeDefinitions: [
            { AttributeName: partitionKey, AttributeType: 'S' },
          ],
          KeySchema: [{ AttributeName: partitionKey, KeyType: 'HASH' }],
          BillingMode: 'PAY_PER_REQUEST',
        })
      );
      await waitUntilTableExists(
        { client: dynamoClient, maxWaitTime: 120 },
        { TableName: tableName }
      );
      console.log(`   [DynamoDB] Tabla "${tableName}" creada y en estado ACTIVE.`);
    } else {
      throw err;
    }
  }
}

async function batchWriteDynamoItems(tableName, items) {
  const BATCH_SIZE = 25;
  let written = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    let requestItems = {
      [tableName]: chunk.map((item) => ({
        PutRequest: { Item: item },
      })),
    };

    while (
      requestItems[tableName] &&
      requestItems[tableName].length > 0
    ) {
      const resp = await docClient.send(
        new BatchWriteCommand({ RequestItems: requestItems })
      );
      const unprocessed =
        resp.UnprocessedItems && resp.UnprocessedItems[tableName]
          ? resp.UnprocessedItems[tableName]
          : [];
      written += requestItems[tableName].length - unprocessed.length;
      requestItems[tableName] = unprocessed;
      if (unprocessed.length > 0) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
  return written;
}

async function runETL() {
  const localOnly = process.argv.includes('--local-only');

  console.log('======================================================================');
  console.log('   COMMUNITY 360 - PIPELINE ETL FASE 2 (AUDITORÍA Y CARGA CLOUD)');
  console.log('======================================================================\n');

  const rawUsuarios = await readCsvFile(USUARIOS_CSV);
  const rawInteracciones = await readCsvFile(INTERACCIONES_CSV);

  const totalRecibidosUsuarios = rawUsuarios.length;
  const totalRecibidosInteracciones = rawInteracciones.length;
  const totalRecibidosGlobal = totalRecibidosUsuarios + totalRecibidosInteracciones;

  console.log(`[INICIO] Lectura de archivos fuente completada:`);
  console.log(`   - comunidad_virtual_usuarios.csv: ${totalRecibidosUsuarios} registros`);
  console.log(`   - comunidad_virtual_1000_interacciones.csv: ${totalRecibidosInteracciones} registros`);
  console.log(`   - Total registros recibidos: ${totalRecibidosGlobal}\n`);

  // =========================================================================
  // ETAPA 1: DEDUPLICACIÓN
  // =========================================================================
  const seenUserIds = new Set();
  const seenAliases = new Set();
  const seenUserExact = new Set();
  const usuariosDedup = [];
  let dupUsuarios = 0;

  for (const row of rawUsuarios) {
    const id = (row.id_usuario || '').trim();
    const alias = (row.alias || '').trim();
    const signature = JSON.stringify(row);

    if (
      !id ||
      seenUserIds.has(id) ||
      seenAliases.has(alias) ||
      seenUserExact.has(signature)
    ) {
      dupUsuarios++;
      continue;
    }
    seenUserIds.add(id);
    seenAliases.add(alias);
    seenUserExact.add(signature);
    usuariosDedup.push({ ...row });
  }

  const seenInteractionIds = new Set();
  const seenInteractionExact = new Set();
  const interaccionesDedup = [];
  let dupInteracciones = 0;

  for (const row of rawInteracciones) {
    const id = (row.id_interaccion || '').trim();
    const signature = JSON.stringify(row);

    if (
      !id ||
      seenInteractionIds.has(id) ||
      seenInteractionExact.has(signature)
    ) {
      dupInteracciones++;
      continue;
    }
    seenInteractionIds.add(id);
    seenInteractionExact.add(signature);
    interaccionesDedup.push({ ...row });
  }

  console.log(`[ETAPA 1] Deduplicación por llave (id_usuario, alias, id_interaccion) y fila exacta:`);
  console.log(`   - Usuarios únicos conservados: ${usuariosDedup.length} (duplicados eliminados: ${dupUsuarios})`);
  console.log(`   - Interacciones únicas conservadas: ${interaccionesDedup.length} (duplicados eliminados: ${dupInteracciones})\n`);

  // =========================================================================
  // ETAPA 2: NORMALIZACIÓN DE NULOS
  // =========================================================================
  let reaccionesTextoCorregido = 0;
  let etiquetasVaciasNormalizadas = 0;

  for (const item of interaccionesDedup) {
    const tipo = (item.tipo || '').trim();
    const textoRaw = (item.texto || '').trim();

    if (tipo === 'reaccion' && textoRaw === '') {
      item.texto = null;
      item.longitud_texto = 0;
      reaccionesTextoCorregido++;
    } else {
      item.texto = textoRaw === '' ? null : textoRaw;
    }

    const etiquetasRaw = (item.etiquetas || '').trim();
    if (etiquetasRaw === '') {
      item._etiquetas_vacias = true;
      item.etiquetas = [];
      etiquetasVaciasNormalizadas++;
    } else {
      item._etiquetas_vacias = false;
    }
  }

  console.log(`[ETAPA 2] Normalización de nulos en interacciones:`);
  console.log(`   - Reacciones sin texto normalizadas (texto = null, longitud_texto = 0): ${reaccionesTextoCorregido}`);
  console.log(`   - Campos de etiquetas vacías normalizados a []: ${etiquetasVaciasNormalizadas}\n`);

  // =========================================================================
  // ETAPA 3: ESTANDARIZACIÓN
  // =========================================================================
  let fechasEstandarizadas = 0;
  let etiquetasSeparadas = 0;

  for (const u of usuariosDedup) {
    u.fecha_ingreso = convertDateDMYtoYMD(u.fecha_ingreso);
    u.ultima_actividad = convertDateDMYtoYMD(u.ultima_actividad);
    fechasEstandarizadas += 2;
  }

  for (const item of interaccionesDedup) {
    if (!item._etiquetas_vacias && typeof item.etiquetas === 'string') {
      item.etiquetas = item.etiquetas
        .split('|')
        .map((t) => t.trim())
        .filter(Boolean);
      etiquetasSeparadas++;
    }
    delete item._etiquetas_vacias;
  }

  console.log(`[ETAPA 3] Estandarización de formatos (fechas ISO YYYY-MM-DD y listas de etiquetas):`);
  console.log(`   - Fechas de usuarios convertidas de DD/MM/YYYY a YYYY-MM-DD: ${fechasEstandarizadas} campos (${usuariosDedup.length} usuarios)`);
  console.log(`   - Interacciones con etiquetas separadas por "|" a List<String>: ${etiquetasSeparadas}\n`);

  // =========================================================================
  // ETAPA 4: VALIDACIÓN DE TIPOS
  // =========================================================================
  let artistasTrue = 0;
  let consentimientoTrue = 0;
  let consentimientoFalse = 0;

  for (const u of usuariosDedup) {
    const rawArtista = String(u.es_artista).trim().toLowerCase();
    u.es_artista = rawArtista === '1' || rawArtista === 'true' || rawArtista === 'si';
    if (u.es_artista) artistasTrue++;

    const rawConsent = String(u.consentimiento_datos).trim().toLowerCase();
    u.consentimiento_datos = rawConsent === 'si' || rawConsent === 'true' || rawConsent === '1';
    if (u.consentimiento_datos) {
      consentimientoTrue++;
    } else {
      consentimientoFalse++;
    }

    u.mensajes_30d = parseInt(u.mensajes_30d, 10) || 0;
    u.reacciones_30d = parseInt(u.reacciones_30d, 10) || 0;
    u.eventos_asistidos = parseInt(u.eventos_asistidos, 10) || 0;
    u.comisiones_compradas = parseInt(u.comisiones_compradas, 10) || 0;
    u.sentimiento_promedio = parseFloat(u.sentimiento_promedio);
    if (Number.isNaN(u.sentimiento_promedio)) u.sentimiento_promedio = 0.0;

    u.latitud =
      u.latitud !== '' && u.latitud !== null && u.latitud !== undefined
        ? parseFloat(u.latitud)
        : null;
    u.longitud =
      u.longitud !== '' && u.longitud !== null && u.longitud !== undefined
        ? parseFloat(u.longitud)
        : null;
    if (Number.isNaN(u.latitud)) u.latitud = null;
    if (Number.isNaN(u.longitud)) u.longitud = null;
  }

  for (const item of interaccionesDedup) {
    item.sentimiento = parseFloat(item.sentimiento);
    if (Number.isNaN(item.sentimiento)) item.sentimiento = 0.0;
    item.longitud_texto =
      item.texto === null ? 0 : parseInt(item.longitud_texto, 10) || 0;
    item.reacciones_recibidas = parseInt(item.reacciones_recibidas, 10) || 0;
  }

  console.log(`[ETAPA 4] Validación y conversión de tipos de datos:`);
  console.log(`   - Usuarios validados: ${usuariosDedup.length} (es_artista=true: ${artistasTrue}, consentimiento=true: ${consentimientoTrue}, consentimiento=false: ${consentimientoFalse})`);
  console.log(`   - Interacciones validadas (enteros y decimales de sentimiento): ${interaccionesDedup.length}\n`);

  // =========================================================================
  // ETAPA 5: INTEGRIDAD REFERENCIAL
  // =========================================================================
  const padronUsuariosMap = new Map();
  for (const u of usuariosDedup) {
    padronUsuariosMap.set(u.id_usuario, u);
  }

  const interaccionesValidas = [];
  const interaccionesCuarentena = [];
  const fechaDeteccion = new Date().toISOString();

  for (const item of interaccionesDedup) {
    if (padronUsuariosMap.has(item.id_usuario)) {
      interaccionesValidas.push(item);
    } else {
      interaccionesCuarentena.push({
        id_cuarentena: uuidv4(),
        id_interaccion: item.id_interaccion,
        id_usuario_huerfano: item.id_usuario,
        motivo_rechazo: `Integridad referencial fallida: id_usuario '${item.id_usuario}' no existe en el padrón de usuarios válidos`,
        fecha_deteccion: fechaDeteccion,
        registro_original: { ...item },
      });
    }
  }

  console.log(`[ETAPA 5] Verificación de integridad referencial (interacciones vs padrón de usuarios):`);
  console.log(`   - Interacciones válidas (con usuario existente): ${interaccionesValidas.length}`);
  console.log(`   - Interacciones huérfanas enviadas a cuarentena: ${interaccionesCuarentena.length}\n`);

  // =========================================================================
  // ETAPA 6: PRIVACIDAD (consentimiento_datos === false)
  // =========================================================================
  const usuariosLimpios = [];
  const ubicacionesLimpias = [];
  let usuariosUbicacionExcluida = 0;

  for (const u of usuariosDedup) {
    if (!u.consentimiento_datos) {
      usuariosUbicacionExcluida++;
      u.pais = null;
      u.estado = null;
      u.ciudad = null;
      u.latitud = null;
      u.longitud = null;
      u.zona_horaria = null;
    } else {
      ubicacionesLimpias.push({
        id_usuario: u.id_usuario,
        pais: u.pais || null,
        estado: u.estado || null,
        ciudad: u.ciudad || null,
        latitud: u.latitud,
        longitud: u.longitud,
        zona_horaria: u.zona_horaria || null,
      });
    }

    usuariosLimpios.push(u);
  }

  let interaccionesUbicacionOmitidaPorPrivacidad = 0;
  const interaccionesLimpiasDynamo = interaccionesValidas.map((item) => {
    const usuario = padronUsuariosMap.get(item.id_usuario);
    const tieneConsentimiento = usuario && usuario.consentimiento_datos === true;

    let ubicacionObj = null;
    if (!tieneConsentimiento) {
      interaccionesUbicacionOmitidaPorPrivacidad++;
      ubicacionObj = null;
    } else if (item.pais || item.estado || item.ciudad) {
      ubicacionObj = {
        pais: item.pais || null,
        estado: item.estado || null,
        ciudad: item.ciudad || null,
      };
    }

    return {
      id_interaccion: item.id_interaccion,
      id_usuario: item.id_usuario,
      timestamp: item.timestamp,
      canal: item.canal,
      tipo: item.tipo,
      texto: item.texto,
      tema: item.tema,
      sentimiento: item.sentimiento,
      idioma: item.idioma,
      dispositivo: item.dispositivo,
      longitud_texto: item.longitud_texto,
      reacciones_recibidas: item.reacciones_recibidas,
      etiquetas: item.etiquetas,
      ubicacion: ubicacionObj,
    };
  });

  console.log(`[ETAPA 6] Aplicación de política de privacidad (consentimiento_datos === false):`);
  console.log(`   - Usuarios sin consentimiento con ubicación suprimida: ${usuariosUbicacionExcluida}`);
  console.log(`   - Usuarios con consentimiento aptos para tabla ubicaciones_usuario: ${ubicacionesLimpias.length}`);
  console.log(`   - Interacciones válidas con ubicacion=null por usuario sin consentimiento: ${interaccionesUbicacionOmitidaPorPrivacidad}\n`);

  // =========================================================================
  // ETAPA 7: EXPORTACIÓN LOCAL DEPURADA
  // =========================================================================
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const headersUsuariosLimpios = [
    'id_usuario',
    'alias',
    'fecha_ingreso',
    'rango_edad',
    'especie_fursona',
    'interes_principal',
    'plataforma_principal',
    'es_artista',
    'mensajes_30d',
    'reacciones_30d',
    'eventos_asistidos',
    'comisiones_compradas',
    'sentimiento_promedio',
    'ultima_actividad',
    'estatus',
    'consentimiento_datos',
  ];

  const headersUbicacionesLimpias = [
    'id_usuario',
    'pais',
    'estado',
    'ciudad',
    'latitud',
    'longitud',
    'zona_horaria',
  ];

  const pathUsuariosCsv = path.join(OUTPUT_DIR, 'usuarios_limpios.csv');
  const pathUbicacionesCsv = path.join(OUTPUT_DIR, 'ubicaciones_limpias.csv');
  const pathInteraccionesJson = path.join(OUTPUT_DIR, 'interacciones_limpias.json');
  const pathCuarentenaJson = path.join(OUTPUT_DIR, 'interacciones_cuarentena.json');

  writeCsvFile(pathUsuariosCsv, headersUsuariosLimpios, usuariosLimpios);
  writeCsvFile(pathUbicacionesCsv, headersUbicacionesLimpias, ubicacionesLimpias);
  fs.writeFileSync(
    pathInteraccionesJson,
    JSON.stringify(interaccionesLimpiasDynamo, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    pathCuarentenaJson,
    JSON.stringify(interaccionesCuarentena, null, 2),
    'utf8'
  );

  console.log(`[ETAPA 7] Exportación local depurada en /output_depurado:`);
  console.log(`   - usuarios_limpios.csv (${usuariosLimpios.length} filas)`);
  console.log(`   - ubicaciones_limpias.csv (${ubicacionesLimpias.length} filas)`);
  console.log(`   - interacciones_limpias.json (${interaccionesLimpiasDynamo.length} ítems)`);
  console.log(`   - interacciones_cuarentena.json (${interaccionesCuarentena.length} ítems)\n`);

  if (localOnly) {
    console.log(`[MODO LOCAL] Flag --local-only detectado. Se omite la Etapa 8 (Carga en la nube).`);
    await pool.end();
    return;
  }

  // =========================================================================
  // ETAPA 8: CARGA EN LA NUBE (PostgreSQL RDS + Amazon DynamoDB)
  // =========================================================================
  console.log(`[ETAPA 8] Iniciando carga en la nube (Amazon RDS PostgreSQL + Amazon DynamoDB)...`);

  // 8.1 Asegurar que la base de datos community360 exista en RDS
  await ensurePostgresDatabase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crear las 7 tablas normalizadas en PostgreSQL
    await client.query(`
      CREATE TABLE IF NOT EXISTS cat_plataformas (
        id_plataforma SERIAL PRIMARY KEY,
        nombre VARCHAR(100) UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cat_intereses (
        id_interes SERIAL PRIMARY KEY,
        nombre VARCHAR(100) UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usuarios (
        id_usuario VARCHAR(20) PRIMARY KEY,
        alias VARCHAR(100) UNIQUE NOT NULL,
        fecha_ingreso DATE NOT NULL,
        rango_edad VARCHAR(20),
        especie_fursona VARCHAR(50),
        id_interes INT REFERENCES cat_intereses(id_interes),
        id_plataforma INT REFERENCES cat_plataformas(id_plataforma),
        es_artista BOOLEAN DEFAULT FALSE,
        ultima_actividad DATE,
        estatus VARCHAR(30),
        consentimiento_datos BOOLEAN NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ubicaciones_usuario (
        id_ubicacion SERIAL PRIMARY KEY,
        id_usuario VARCHAR(20) UNIQUE NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        pais VARCHAR(100),
        estado VARCHAR(100),
        ciudad VARCHAR(100),
        latitud NUMERIC(10, 6),
        longitud NUMERIC(10, 6),
        zona_horaria VARCHAR(100)
      );

      CREATE TABLE IF NOT EXISTS metricas_usuario (
        id_metrica SERIAL PRIMARY KEY,
        id_usuario VARCHAR(20) UNIQUE NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        mensajes_30d INT DEFAULT 0,
        reacciones_30d INT DEFAULT 0,
        eventos_asistidos INT DEFAULT 0,
        comisiones_compradas INT DEFAULT 0,
        sentimiento_promedio NUMERIC(6, 3) DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS administradores_sistema (
        id_admin SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        nombre_completo VARCHAR(120) NOT NULL,
        email VARCHAR(120) UNIQUE NOT NULL,
        rol VARCHAR(50) DEFAULT 'superadmin',
        activo BOOLEAN DEFAULT TRUE,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bitacora_etl (
        id_ejecucion SERIAL PRIMARY KEY,
        fecha_ejecucion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        registros_recibidos INT NOT NULL,
        registros_aceptados INT NOT NULL,
        registros_transformados INT NOT NULL,
        registros_rechazados INT NOT NULL,
        observaciones TEXT
      );
    `);

    // Catálogos únicos
    const plataformasSet = new Set(
      usuariosLimpios.map((u) => u.plataforma_principal).filter(Boolean)
    );
    const interesesSet = new Set(
      usuariosLimpios.map((u) => u.interes_principal).filter(Boolean)
    );

    const plataformaIdMap = new Map();
    for (const nombre of plataformasSet) {
      const res = await client.query(
        `INSERT INTO cat_plataformas (nombre) VALUES ($1)
         ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
         RETURNING id_plataforma`,
        [nombre]
      );
      plataformaIdMap.set(nombre, res.rows[0].id_plataforma);
    }

    const interesIdMap = new Map();
    for (const nombre of interesesSet) {
      const res = await client.query(
        `INSERT INTO cat_intereses (nombre) VALUES ($1)
         ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
         RETURNING id_interes`,
        [nombre]
      );
      interesIdMap.set(nombre, res.rows[0].id_interes);
    }

    // Insertar usuarios y métricas
    for (const u of usuariosLimpios) {
      const idInteres = interesIdMap.get(u.interes_principal) || null;
      const idPlataforma = plataformaIdMap.get(u.plataforma_principal) || null;

      await client.query(
        `INSERT INTO usuarios (
          id_usuario, alias, fecha_ingreso, rango_edad, especie_fursona,
          id_interes, id_plataforma, es_artista, ultima_actividad, estatus, consentimiento_datos
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id_usuario) DO UPDATE SET
          alias = EXCLUDED.alias,
          fecha_ingreso = EXCLUDED.fecha_ingreso,
          rango_edad = EXCLUDED.rango_edad,
          especie_fursona = EXCLUDED.especie_fursona,
          id_interes = EXCLUDED.id_interes,
          id_plataforma = EXCLUDED.id_plataforma,
          es_artista = EXCLUDED.es_artista,
          ultima_actividad = EXCLUDED.ultima_actividad,
          estatus = EXCLUDED.estatus,
          consentimiento_datos = EXCLUDED.consentimiento_datos`,
        [
          u.id_usuario,
          u.alias,
          u.fecha_ingreso,
          u.rango_edad,
          u.especie_fursona,
          idInteres,
          idPlataforma,
          u.es_artista,
          u.ultima_actividad,
          u.estatus,
          u.consentimiento_datos,
        ]
      );

      await client.query(
        `INSERT INTO metricas_usuario (
          id_usuario, mensajes_30d, reacciones_30d, eventos_asistidos, comisiones_compradas, sentimiento_promedio
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id_usuario) DO UPDATE SET
          mensajes_30d = EXCLUDED.mensajes_30d,
          reacciones_30d = EXCLUDED.reacciones_30d,
          eventos_asistidos = EXCLUDED.eventos_asistidos,
          comisiones_compradas = EXCLUDED.comisiones_compradas,
          sentimiento_promedio = EXCLUDED.sentimiento_promedio`,
        [
          u.id_usuario,
          u.mensajes_30d,
          u.reacciones_30d,
          u.eventos_asistidos,
          u.comisiones_compradas,
          u.sentimiento_promedio,
        ]
      );
    }

    // Asegurar que no existan ubicaciones de usuarios sin consentimiento y cargar las válidas
    await client.query(
      `DELETE FROM ubicaciones_usuario WHERE id_usuario IN (
        SELECT id_usuario FROM usuarios WHERE consentimiento_datos = FALSE
      )`
    );

    for (const ub of ubicacionesLimpias) {
      await client.query(
        `INSERT INTO ubicaciones_usuario (
          id_usuario, pais, estado, ciudad, latitud, longitud, zona_horaria
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (id_usuario) DO UPDATE SET
          pais = EXCLUDED.pais,
          estado = EXCLUDED.estado,
          ciudad = EXCLUDED.ciudad,
          latitud = EXCLUDED.latitud,
          longitud = EXCLUDED.longitud,
          zona_horaria = EXCLUDED.zona_horaria`,
        [
          ub.id_usuario,
          ub.pais,
          ub.estado,
          ub.ciudad,
          ub.latitud,
          ub.longitud,
          ub.zona_horaria,
        ]
      );
    }

    // Semilla de administrador del sistema
    await client.query(
      `INSERT INTO administradores_sistema (username, nombre_completo, email, rol, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (username) DO NOTHING`,
      ['admin_c360', 'Administrador Community 360', 'admin@community360.org', 'superadmin']
    );

    // Registro en bitacora_etl
    const registrosRecibidos = totalRecibidosGlobal;
    const registrosAceptados = usuariosLimpios.length + interaccionesLimpiasDynamo.length;
    const registrosTransformados =
      usuariosLimpios.length +
      reaccionesTextoCorregido +
      etiquetasVaciasNormalizadas +
      etiquetasSeparadas;
    const registrosRechazados =
      dupUsuarios + dupInteracciones + interaccionesCuarentena.length;

    await client.query(
      `INSERT INTO bitacora_etl (
        registros_recibidos, registros_aceptados, registros_transformados, registros_rechazados, observaciones
      ) VALUES ($1, $2, $3, $4, $5)`,
      [
        registrosRecibidos,
        registrosAceptados,
        registrosTransformados,
        registrosRechazados,
        `Usuarios cargados: ${usuariosLimpios.length}, Ubicaciones (con consentimiento): ${ubicacionesLimpias.length}, Interacciones válidas: ${interaccionesLimpiasDynamo.length}, Interacciones en cuarentena: ${interaccionesCuarentena.length}`,
      ]
    );

    await client.query('COMMIT');
    console.log(`   [RDS PostgreSQL] Carga transaccional completada con éxito:`);
    console.log(`      - cat_plataformas: ${plataformaIdMap.size} registros`);
    console.log(`      - cat_intereses: ${interesIdMap.size} registros`);
    console.log(`      - usuarios: ${usuariosLimpios.length} registros`);
    console.log(`      - ubicaciones_usuario: ${ubicacionesLimpias.length} registros (171 omitidos por privacidad)`);
    console.log(`      - metricas_usuario: ${usuariosLimpios.length} registros`);
    console.log(`      - administradores_sistema: verificado`);
    console.log(`      - bitacora_etl: ejecución registrada (recibidos=${registrosRecibidos}, aceptados=${registrosAceptados}, transformados=${registrosTransformados}, rechazados=${registrosRechazados})`);
  } catch (pgErr) {
    await client.query('ROLLBACK');
    throw pgErr;
  } finally {
    client.release();
  }

  // 8.2 Carga en Amazon DynamoDB
  await ensureDynamoTable('interacciones', 'id_interaccion');
  await ensureDynamoTable('interacciones_cuarentena', 'id_cuarentena');

  const insertedValid = await batchWriteDynamoItems(
    'interacciones',
    interaccionesLimpiasDynamo
  );
  console.log(`   [DynamoDB] Tabla "interacciones": ${insertedValid} ítems cargados.`);

  const insertedQuarantine = await batchWriteDynamoItems(
    'interacciones_cuarentena',
    interaccionesCuarentena
  );
  console.log(`   [DynamoDB] Tabla "interacciones_cuarentena": ${insertedQuarantine} ítems huérfanos cargados.\n`);

  console.log('======================================================================');
  console.log('   PROCESO ETL FASE 2 FINALIZADO EXITOSAMENTE');
  console.log('======================================================================');

  await pool.end();
}

runETL().catch(async (err) => {
  console.error('\n[ERROR CRÍTICO EN ETL]:', err.message);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
