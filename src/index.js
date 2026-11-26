require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const {
  ScanCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');

const pool = require('./db');
const { docClient } = require('./dynamo');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = Number(process.env.PORT) || 3000;
const AUTH_SECRET = process.env.AUTH_SECRET || 'community360_utmetropolitana_secret_2026';

// =========================================================================
// UTILIDADES DE AUTENTICACIÓN (Hash scrypt + Token HMAC sin dependencias)
// =========================================================================
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

async function ensureTeacherAccount() {
  try {
    await pool.query(`
      ALTER TABLE administradores_sistema
      ADD COLUMN IF NOT EXISTS password_hash TEXT;
    `);
    const hash = hashPassword('lizandr0_reye$');
    await pool.query(
      `INSERT INTO administradores_sistema (username, nombre_completo, email, rol, activo, password_hash)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       ON CONFLICT (username) DO UPDATE SET
         email = EXCLUDED.email,
         activo = TRUE,
         password_hash = EXCLUDED.password_hash`,
      [
        'lizandro.reyes',
        'Lizandro Reyes (Docente Evaluador)',
        'lizandro.reyes@utmetropolitana.edu.mx',
        'docente_evaluador',
        hash,
      ]
    );
    console.log('[AUTH] Usuario docente "lizandro.reyes" verificado en administradores_sistema.');
  } catch (err) {
    console.warn('[AUTH] No se pudo verificar usuario docente en RDS al iniciar:', err.message);
  }
}

// =========================================================================
// UTILIDADES DE CONSULTA Y CÁLCULO ANALÍTICO (RDS + DynamoDB)
// =========================================================================
async function scanAllInteractions() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const resp = await docClient.send(
      new ScanCommand({
        TableName: 'interacciones',
        ExclusiveStartKey,
      })
    );
    if (resp.Items) items.push(...resp.Items);
    ExclusiveStartKey = resp.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function computeDashboardSnapshot() {
  // 1. Métricas de usuarios desde Amazon RDS PostgreSQL
  const [rdsStatsRes, estatusRes] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total_usuarios,
        COUNT(*) FILTER (WHERE u.estatus = 'activo')::int AS activos,
        COUNT(*) FILTER (WHERE u.estatus = 'en_riesgo')::int AS en_riesgo,
        COUNT(*) FILTER (WHERE u.consentimiento_datos = TRUE)::int AS con_consentimiento,
        COUNT(*) FILTER (WHERE u.es_artista = TRUE)::int AS total_artistas,
        COALESCE(SUM(m.mensajes_30d), 0)::int AS sum_mensajes_30d,
        COALESCE(SUM(m.reacciones_30d), 0)::int AS sum_reacciones_30d,
        COALESCE(SUM(m.comisiones_compradas), 0)::int AS sum_comisiones
      FROM usuarios u
      LEFT JOIN metricas_usuario m ON u.id_usuario = m.id_usuario
    `),
    pool.query(`
      SELECT estatus, COUNT(*)::int AS total
      FROM usuarios
      GROUP BY estatus
      ORDER BY total DESC
    `),
  ]);

  const st = rdsStatsRes.rows[0];
  const totalU = st.total_usuarios || 1;
  const totalArtistas = st.total_artistas || 1;

  // 2. Interacciones desde Amazon DynamoDB
  const interactions = await scanAllInteractions();
  const totalI = interactions.length;

  let sumSentimiento = 0;
  const canalMap = new Map();
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));

  for (const item of interactions) {
    const s = Number(item.sentimiento);
    if (!Number.isNaN(s)) sumSentimiento += s;

    const canal = item.canal || 'Otro';
    canalMap.set(canal, (canalMap.get(canal) || 0) + 1);

    if (item.timestamp) {
      const dt = new Date(item.timestamp);
      if (!Number.isNaN(dt.getTime())) {
        const dayIdx = (dt.getUTCDay() + 6) % 7; // 0=Lun .. 6=Dom
        const hourIdx = dt.getUTCHours();
        heat[dayIdx][hourIdx]++;
      }
    }
  }

  const kpis = {
    total_usuarios: st.total_usuarios,
    total_interacciones: totalI,
    activos_pct: Number(((st.activos / totalU) * 100).toFixed(2)),
    riesgo_pct: Number(((st.en_riesgo / totalU) * 100).toFixed(2)),
    consentimiento_pct: Number(((st.con_consentimiento / totalU) * 100).toFixed(2)),
    sentimiento_prom: totalI > 0 ? Number((sumSentimiento / totalI).toFixed(3)) : 0,
    engagement: Number(((st.sum_mensajes_30d + st.sum_reacciones_30d) / totalU).toFixed(2)),
    comisiones_por_artista: Number((st.sum_comisiones / totalArtistas).toFixed(2)),
  };

  const canales = Array.from(canalMap.entries())
    .map(([canal, total]) => ({ canal, total }))
    .sort((a, b) => b.total - a.total);

  const recientes = [...interactions]
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .slice(0, 6);

  return {
    kpis,
    canales,
    estatus: estatusRes.rows,
    heat,
    recientes,
  };
}

async function broadcastDashboardUpdate(eventType, detail) {
  try {
    const snapshot = await computeDashboardSnapshot();
    io.emit('dashboard_actualizado', {
      eventType,
      detail,
      ...snapshot,
    });
  } catch (err) {
    console.error('[WS] Error al emitir actualización:', err.message);
  }
}

// =========================================================================
// ENDPOINTS DE AUTENTICACIÓN
// =========================================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, usuario, email, password } = req.body || {};
    const loginId = String(identifier || usuario || email || '').trim().toLowerCase();

    if (!loginId || !password) {
      return res.status(400).json({ error: 'Debes proporcionar usuario/correo y contraseña.' });
    }

    const result = await pool.query(
      `SELECT id_admin, username, nombre_completo, email, rol, activo, password_hash
       FROM administradores_sistema
       WHERE LOWER(username) = $1 OR LOWER(email) = $1
       LIMIT 1`,
      [loginId]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const admin = result.rows[0];
    if (!admin.activo) {
      return res.status(403).json({ error: 'Cuenta deshabilitada.' });
    }

    if (!verifyPassword(String(password), admin.password_hash)) {
      return res.status(401).json({ error: 'Credenciales inválidas.' });
    }

    const token = signToken({
      id_admin: admin.id_admin,
      username: admin.username,
      email: admin.email,
      rol: admin.rol,
      exp: Date.now() + 12 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      token,
      user: {
        username: admin.username,
        nombre_completo: admin.nombre_completo,
        email: admin.email,
        rol: admin.rol,
      },
    });
  } catch (err) {
    console.error('[POST /api/auth/login]', err.message);
    return res.status(500).json({ error: 'Error interno al autenticar.' });
  }
});

app.get('/api/auth/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  return res.status(200).json({ user: payload });
});

// =========================================================================
// ENDPOINTS REST HISTÓRICOS Y ANALÍTICOS (Fase 4 y Fase 6B)
// =========================================================================
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok', rds: 'connected', dynamo: 'ready' });
  } catch (err) {
    res.status(500).json({ status: 'error', detail: err.message });
  }
});

app.get('/api/kpis', async (_req, res) => {
  try {
    const snap = await computeDashboardSnapshot();
    res.status(200).json(snap.kpis);
  } catch (err) {
    res.status(500).json({ error: 'Error al calcular KPIs', detail: err.message });
  }
});

app.get('/api/interacciones/por-canal', async (_req, res) => {
  try {
    const snap = await computeDashboardSnapshot();
    res.status(200).json(snap.canales);
  } catch (err) {
    res.status(500).json({ error: 'Error al agrupar canales', detail: err.message });
  }
});

app.get('/api/usuarios/por-estatus', async (_req, res) => {
  try {
    const snap = await computeDashboardSnapshot();
    res.status(200).json(snap.estatus);
  } catch (err) {
    res.status(500).json({ error: 'Error al agrupar estatus', detail: err.message });
  }
});

app.get('/api/heatmap', async (_req, res) => {
  try {
    const snap = await computeDashboardSnapshot();
    res.status(200).json(snap.heat);
  } catch (err) {
    res.status(500).json({ error: 'Error al generar mapa de calor', detail: err.message });
  }
});

app.get('/api/dashboard', async (_req, res) => {
  try {
    const snap = await computeDashboardSnapshot();
    res.status(200).json(snap);
  } catch (err) {
    res.status(500).json({ error: 'Error al cargar dashboard', detail: err.message });
  }
});

app.get('/api/usuarios', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const result = await pool.query(
      `SELECT u.id_usuario, u.alias, u.fecha_ingreso, u.rango_edad, u.especie_fursona,
              p.nombre AS plataforma, i.nombre AS interes, u.es_artista, u.estatus,
              u.consentimiento_datos, m.mensajes_30d, m.reacciones_30d, m.sentimiento_promedio,
              ub.pais, ub.estado, ub.ciudad
       FROM usuarios u
       LEFT JOIN cat_plataformas p ON u.id_plataforma = p.id_plataforma
       LEFT JOIN cat_intereses i ON u.id_interes = i.id_interes
       LEFT JOIN metricas_usuario m ON u.id_usuario = m.id_usuario
       LEFT JOIN ubicaciones_usuario ub ON u.id_usuario = ub.id_usuario
       ORDER BY u.id_usuario ASC
       LIMIT $1`,
      [limit]
    );
    res.status(200).json({ total: result.rowCount, data: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar usuarios', detail: err.message });
  }
});

app.get('/api/bitacora', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM bitacora_etl ORDER BY id_ejecucion DESC');
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar bitácora ETL', detail: err.message });
  }
});

// =========================================================================
// CRUD DE INTERACCIONES (Amazon DynamoDB + WebSockets hacia Dashboard)
// =========================================================================
app.get('/api/interacciones', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const items = await scanAllInteractions();
    items.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    res.status(200).json({ total: items.length, data: items.slice(0, limit) });
  } catch (err) {
    res.status(500).json({ error: 'Error al listar interacciones', detail: err.message });
  }
});

app.get('/api/interacciones/:id', async (req, res) => {
  try {
    const resp = await docClient.send(
      new GetCommand({
        TableName: 'interacciones',
        Key: { id_interaccion: req.params.id },
      })
    );
    if (!resp.Item) {
      return res.status(404).json({ error: `Interacción '${req.params.id}' no encontrada.` });
    }
    return res.status(200).json(resp.Item);
  } catch (err) {
    return res.status(500).json({ error: 'Error al consultar interacción', detail: err.message });
  }
});

app.post('/api/interacciones', async (req, res) => {
  try {
    const body = req.body || {};
    const id_interaccion =
      body.id_interaccion && String(body.id_interaccion).trim()
        ? String(body.id_interaccion).trim()
        : `I${Date.now().toString().slice(-7)}`;
    const id_usuario = String(body.id_usuario || '').trim();
    const canal = String(body.canal || '').trim();
    const tipo = String(body.tipo || '').trim();
    const tema = String(body.tema || 'general').trim();
    const sentimiento = Number(body.sentimiento);

    if (!id_usuario || !canal || !tipo) {
      return res.status(400).json({
        error: 'Campos obligatorios faltantes: id_usuario, canal y tipo son requeridos.',
      });
    }

    if (Number.isNaN(sentimiento) || sentimiento < -1 || sentimiento > 1) {
      return res.status(400).json({
        error: 'El campo sentimiento debe ser un número válido entre -1.0 y 1.0.',
      });
    }

    // Validar integridad referencial contra RDS y privacidad geográfica
    const userCheck = await pool.query(
      `SELECT u.id_usuario, u.consentimiento_datos, ub.pais, ub.estado, ub.ciudad
       FROM usuarios u
       LEFT JOIN ubicaciones_usuario ub ON u.id_usuario = ub.id_usuario
       WHERE u.id_usuario = $1`,
      [id_usuario]
    );
    if (userCheck.rowCount === 0) {
      return res.status(400).json({
        error: `Integridad referencial fallida: el usuario '${id_usuario}' no existe en RDS.`,
      });
    }

    const existing = await docClient.send(
      new GetCommand({ TableName: 'interacciones', Key: { id_interaccion } })
    );
    if (existing.Item) {
      return res.status(409).json({ error: `La interacción '${id_interaccion}' ya existe.` });
    }

    const userRow = userCheck.rows[0];
    const texto =
      tipo === 'reaccion' || body.texto === null || body.texto === undefined || String(body.texto).trim() === ''
        ? null
        : String(body.texto).trim();
    const longitud_texto = texto ? texto.length : 0;

    const item = {
      id_interaccion,
      id_usuario,
      timestamp: body.timestamp || new Date().toISOString(),
      canal,
      tipo,
      texto,
      tema,
      sentimiento,
      idioma: body.idioma || 'es',
      dispositivo: body.dispositivo || 'Web',
      longitud_texto,
      reacciones_recibidas: parseInt(body.reacciones_recibidas, 10) || 0,
      etiquetas: Array.isArray(body.etiquetas) ? body.etiquetas : [],
      ubicacion: userRow.consentimiento_datos
        ? {
            pais: userRow.pais || null,
            estado: userRow.estado || null,
            ciudad: userRow.ciudad || null,
          }
        : null,
    };

    await docClient.send(new PutCommand({ TableName: 'interacciones', Item: item }));

    await broadcastDashboardUpdate('creada', item);
    return res.status(201).json({ message: 'Interacción creada exitosamente.', data: item });
  } catch (err) {
    console.error('[POST /api/interacciones]', err.message);
    return res.status(500).json({ error: 'Error al crear interacción', detail: err.message });
  }
});

app.put('/api/interacciones/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await docClient.send(
      new GetCommand({ TableName: 'interacciones', Key: { id_interaccion: id } })
    );
    if (!existing.Item) {
      return res.status(404).json({ error: `Interacción '${id}' no encontrada.` });
    }

    const body = req.body || {};
    const updates = [];
    const names = {};
    const values = {};

    if (body.canal !== undefined) {
      updates.push('#canal = :canal');
      names['#canal'] = 'canal';
      values[':canal'] = String(body.canal).trim();
    }
    if (body.tipo !== undefined) {
      updates.push('#tipo = :tipo');
      names['#tipo'] = 'tipo';
      values[':tipo'] = String(body.tipo).trim();
    }
    if (body.tema !== undefined) {
      updates.push('#tema = :tema');
      names['#tema'] = 'tema';
      values[':tema'] = String(body.tema).trim();
    }
    if (body.sentimiento !== undefined) {
      const s = Number(body.sentimiento);
      if (Number.isNaN(s) || s < -1 || s > 1) {
        return res.status(400).json({ error: 'El sentimiento debe estar entre -1.0 y 1.0.' });
      }
      updates.push('#sentimiento = :sentimiento');
      names['#sentimiento'] = 'sentimiento';
      values[':sentimiento'] = s;
    }
    if (body.texto !== undefined) {
      const t = body.texto === null || String(body.texto).trim() === '' ? null : String(body.texto).trim();
      updates.push('#texto = :texto, #longitud = :longitud');
      names['#texto'] = 'texto';
      names['#longitud'] = 'longitud_texto';
      values[':texto'] = t;
      values[':longitud'] = t ? t.length : 0;
    }
    if (body.reacciones_recibidas !== undefined) {
      updates.push('#reac = :reac');
      names['#reac'] = 'reacciones_recibidas';
      values[':reac'] = parseInt(body.reacciones_recibidas, 10) || 0;
    }
    if (body.etiquetas !== undefined) {
      if (!Array.isArray(body.etiquetas)) {
        return res.status(400).json({ error: 'El campo etiquetas debe ser un arreglo.' });
      }
      updates.push('#etiquetas = :etiquetas');
      names['#etiquetas'] = 'etiquetas';
      values[':etiquetas'] = body.etiquetas;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos válidos para actualizar.' });
    }

    const updated = await docClient.send(
      new UpdateCommand({
        TableName: 'interacciones',
        Key: { id_interaccion: id },
        UpdateExpression: `SET ${updates.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })
    );

    await broadcastDashboardUpdate('actualizada', updated.Attributes);
    return res.status(200).json({
      message: 'Interacción actualizada exitosamente.',
      data: updated.Attributes,
    });
  } catch (err) {
    console.error('[PUT /api/interacciones/:id]', err.message);
    return res.status(500).json({ error: 'Error al actualizar interacción', detail: err.message });
  }
});

app.delete('/api/interacciones/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await docClient.send(
      new GetCommand({ TableName: 'interacciones', Key: { id_interaccion: id } })
    );
    if (!existing.Item) {
      return res.status(404).json({ error: `Interacción '${id}' no encontrada.` });
    }

    await docClient.send(
      new DeleteCommand({
        TableName: 'interacciones',
        Key: { id_interaccion: id },
      })
    );

    await broadcastDashboardUpdate('eliminada', existing.Item);
    return res.status(200).json({
      message: `Interacción '${id}' eliminada exitosamente.`,
      deleted: existing.Item,
    });
  } catch (err) {
    console.error('[DELETE /api/interacciones/:id]', err.message);
    return res.status(500).json({ error: 'Error al eliminar interacción', detail: err.message });
  }
});

// =========================================================================
// SOCKET.IO CONNECTION
// =========================================================================
io.on('connection', (socket) => {
  console.log(`[WS] Cliente conectado: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[WS] Cliente desconectado: ${socket.id}`);
  });
});

// Iniciar servidor
ensureTeacherAccount().finally(() => {
  server.listen(PORT, () => {
    console.log(`======================================================================`);
    console.log(`   COMMUNITY 360 API + WebSockets corriendo en http://localhost:${PORT}`);
    console.log(`======================================================================`);
  });
});
