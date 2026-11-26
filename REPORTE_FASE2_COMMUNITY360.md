# PROYECTO COMMUNITY 360 — FASE 2: LIMPIEZA DE DATOS, PROCESAMIENTO Y CARGA EN LA NUBE

---

## 1. Portada

- **Universidad:** [Nombre de la Universidad]
- **Carrera:** [Nombre de la Ingeniería / Licenciatura]
- **Asignatura:** Bases de Datos NoSQL / Arquitectura de Datos en la Nube (Unidad 3)
- **Título del Proyecto:** COMMUNITY 360 — Pipeline ETL, Auditoría de Calidad de Datos, Cumplimiento de Privacidad y Carga Híbrida en Amazon RDS (PostgreSQL) y Amazon DynamoDB
- **Alumno:** [PrimerApellido_Nombre — Nombre Completo del Alumno]
- **Fecha de Entrega:** 24 de noviembre de 2026

---

## 2. Auditoría de Calidad y Reglas de Limpieza Aplicadas

Antes de realizar cualquier inserción sobre la arquitectura híbrida aprovisionada en AWS, se ejecutó un diagnóstico exhaustivo sobre los dos insumos originales del proyecto: el padrón de miembros (`comunidad_virtual_usuarios.csv`, con **1,068 filas**) y la bitácora de actividad social (`comunidad_virtual_1000_interacciones.csv`, con **1,000 filas**), sumando un volumen bruto de **2,068 registros recibidos**.

Durante la inspección técnica se detectaron y corrigieron seis grupos principales de anomalías estructurales, semánticas y de privacidad:

### 2.1 Resumen Cuantitativo de Hallazgos de la Auditoría

| Categoría Auditada | Archivo / Entidad Origen | Registros Evaluados | Anomalías Detectadas / Registros Intervenidos | Acción Técnica Aplicada |
| :--- | :--- | :---: | :---: | :--- |
| **1. Duplicidad por llaves e identidad** | `usuarios.csv` e `interacciones.csv` | 2,068 | **0** duplicados exactos o de llave (`id_usuario`, `alias`, `id_interaccion`) | Validación por tablas hash (`Set`) en memoria antes del procesamiento. |
| **2. Inconsistencia en reacciones sin texto** | `interacciones.csv` (`tipo = 'reaccion'`) | 1,000 | **144** registros con texto vacío pero `longitud_texto > 0` (ej. 45, 50, 54) | Asignación explícita `texto = null` y corrección aritmética a `longitud_texto = 0`. |
| **3. Etiquetas multivaluadas y vacías** | `interacciones.csv` (`etiquetas`) | 1,000 | **231** cadenas vacías `""` y **769** cadenas concatenadas con tubería (`\|`) | Normalización de vacíos a arreglo `[]` y tokenización por `\|` a `List<String>`. |
| **4. Formatos de fecha no estándar y tipos planos** | `usuarios.csv` (`fecha_ingreso`, `ultima_actividad`, booleanos) | 1,068 | **2,136** campos de fecha en formato `DD/MM/YYYY` y banderas como texto/entero (`1`/`0`, `si`/`no`) | Conversión a estándar ISO-8601 (`YYYY-MM-DD`) y tipado estricto a `Boolean`, `Integer` y `Float`. |
| **5. Ruptura de integridad referencial (huérfanos)** | `interacciones.csv` vs `usuarios.csv` | 1,000 | **793** interacciones cuyo `id_usuario` no existe en el padrón oficial | Aislamiento hacia `interacciones_cuarentena` con UUID y motivo de rechazo; solo **207** pasan a `interacciones`. |
| **6. Restricción de privacidad geográfica** | `usuarios.csv` (`consentimiento_datos = 'no'`) | 1,068 | **171** usuarios sin consentimiento (y **26** interacciones válidas asociadas a ellos) | Supresión total de país, estado, ciudad, latitud, longitud y zona horaria en RDS y DynamoDB. |

### 2.2 Análisis Técnico de las Anomalías Detectadas

1. **Verificación de unicidad y encabezados UTF-8 BOM:**
   El archivo `comunidad_virtual_usuarios.csv` incluía una marca de orden de bytes (`\uFEFF` BOM) al inicio de la primera columna (`id_usuario`). Si no se limpia dicha cabecera durante el parseo del flujo CSV, la llave primaria queda corrupta e impide hacer cruces exactos. Tras sanear los encabezados y evaluar unicidad mediante estructuras `Set` sobre `id_usuario`, `alias` e `id_interaccion`, se confirmó que los **1,068 usuarios** y las **1,000 interacciones** poseían identificadores únicos (**0 duplicados eliminados**).

2. **Falsos conteos de caracteres en interacciones de tipo reacción:**
   En el archivo de interacciones se detectaron **144 registros** cuyo atributo `tipo` era `"reaccion"` y cuyo campo `texto` venía completamente vacío (`""`), pero que erróneamente reportaban valores numéricos entre `45` y `60` en la columna `longitud_texto`. Conservar ese dato habría distorsionado las métricas de longitud promedio de mensajes. La regla aplicada forzó `texto = null` y recalculó `longitud_texto = 0`.

3. **Normalización de etiquetas vacías y separación de campos multivaluados:**
   Las **231 interacciones** que no contenían etiquetas se normalizaron a una lista vacía `[]` en lugar de almacenar cadenas vacías o nulos ambiguos. Paralelamente, las **769 interacciones** que tenían etiquetas concatenadas mediante el delimitador `|` (como `"humor|musica|aviso"`) fueron separadas en arreglos nativos de cadenas (`["humor", "musica", "aviso"]`) para aprovechar el tipo `List` nativo de Amazon DynamoDB.

4. **Heterogeneidad en formatos de fecha y tipado plano:**
   En el archivo de usuarios, tanto `fecha_ingreso` como `ultima_actividad` (**2,136 valores en total**) estaban expresados en formato local `DD/MM/YYYY` (por ejemplo, `21/04/2026`), el cual provoca errores de rango o interpretaciones invertidas (`MM/DD/YYYY`) al insertarse en columnas `DATE` de PostgreSQL. Se transformaron en su totalidad al formato estándar ISO-8601 (`YYYY-MM-DD`) y se aplicó tipado estricto a booleanos (`es_artista`, `consentimiento_datos`), enteros y flotantes.

5. **Ruptura crítica de integridad referencial (79.3% de interacciones huérfanas):**
   Al cruzar la llave foránea lógica `id_usuario` de las 1,000 interacciones contra el padrón de 1,068 usuarios registrados (cuyos identificadores abarcan del `U000001` al `U001068`), se descubrió que **793 interacciones** hacían referencia a identificadores inexistentes (por ejemplo, `U005764`, `U002888`, `U004367`). En lugar de descartarlas silenciosamente —lo que implicaría pérdida de trazabilidad— o de insertarlas ensuciando las consultas analíticas, se separaron los **207 registros válidos** para la tabla productiva `interacciones` y se enviaron los **793 registros huérfanos** a una colección independiente de auditoría (`interacciones_cuarentena`), adjuntando un identificador único `id_cuarentena` (UUID v4), la marca temporal `fecha_deteccion`, el `motivo_rechazo` y el objeto `registro_original` íntegro.

6. **Cumplimiento estricto de privacidad geográfica (`consentimiento_datos = false`):**
   Del total de 1,068 usuarios, **897** otorgaron consentimiento explícito (`"si"`) y **171** lo negaron (`"no"`). Aun cuando el archivo CSV original contenía datos de país, estado, ciudad y zona horaria para esos 171 usuarios (como el usuario `U000004`, `AshCh'a30`, con ubicación en Monterrey, Nuevo León), la regla de gobernanza implementada eliminó por completo sus atributos `pais`, `estado`, `ciudad`, `latitud`, `longitud` y `zona_horaria` antes de la exportación y carga. En consecuencia:
   - En PostgreSQL (`ubicaciones_usuario`) únicamente se insertaron **897 filas** (ninguno de los 171 usuarios sin consentimiento tiene registro en dicha tabla).
   - En DynamoDB (`interacciones`), para las **26 interacciones válidas** pertenecientes a usuarios sin consentimiento, el subdocumento `ubicacion` se estableció explícitamente en `null`.

---

## 3. Documentación del Script de Procesamiento (ETL)

El pipeline fue construido en **Node.js** dentro del archivo `src/etl.js`, apoyándose en los módulos `src/db.js` (pool de conexiones SSL hacia Amazon RDS PostgreSQL) y `src/dynamo.js` (`DynamoDBClient` y `DynamoDBDocumentClient` del SDK v3 de AWS). Las credenciales sensibles y endpoints se inyectan exclusivamente mediante variables de entorno (`process.env`) definidas en `.env`.

A continuación se documenta la lógica secuencial de las **8 etapas** junto con sus bloques de código clave.

### 3.1 Configuración de Conexiones sin Exposición de Credenciales (`src/db.js` y `src/dynamo.js`)

```javascript
// src/db.js - Conexión parametrizada a Amazon RDS PostgreSQL con SSL
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME, // community360
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

module.exports = pool;
```

```javascript
// src/dynamo.js - Cliente de Amazon DynamoDB (AWS SDK v3)
require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

module.exports = { dynamoClient, docClient };
```

### 3.2 Etapa 1: Eliminación de Registros Duplicados

Se leen ambos archivos CSV eliminando cualquier carácter BOM en las cabeceras y se evalúa cada fila contra conjuntos (`Set`) que indexan `id_usuario`, `alias`, `id_interaccion` y la firma completa del registro.

```javascript
// Etapa 1: Deduplicación por llave primaria, alias único y fila exacta
const seenUserIds = new Set();
const seenAliases = new Set();
const seenUserExact = new Set();
const usuariosDedup = [];
let dupUsuarios = 0;

for (const row of rawUsuarios) {
  const id = (row.id_usuario || '').trim();
  const alias = (row.alias || '').trim();
  const signature = JSON.stringify(row);

  if (!id || seenUserIds.has(id) || seenAliases.has(alias) || seenUserExact.has(signature)) {
    dupUsuarios++;
    continue;
  }
  seenUserIds.add(id);
  seenAliases.add(alias);
  seenUserExact.add(signature);
  usuariosDedup.push({ ...row });
}
```

### 3.3 Etapa 2: Normalización de Valores Vacíos y Nulos

Se corrigen las reacciones que carecen de contenido textual pero tenían longitudes residuales mayores a cero, y se inicializan las etiquetas faltantes como arreglos vacíos.

```javascript
// Etapa 2: Normalización de nulos en reacciones sin texto y etiquetas vacías
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
  }
}
```

### 3.4 Etapa 3: Estandarización de Fechas y Campos Multivaluados

Las fechas `DD/MM/YYYY` se reestructuran mediante expresiones regulares al formato `YYYY-MM-DD`, mientras que la columna `etiquetas` se divide por el carácter `|` para generar un arreglo limpio de cadenas.

```javascript
// Etapa 3: Conversión de fechas DD/MM/YYYY -> YYYY-MM-DD y split de etiquetas por "|"
function convertDateDMYtoYMD(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const match = dateStr.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : dateStr.trim();
}

for (const u of usuariosDedup) {
  u.fecha_ingreso = convertDateDMYtoYMD(u.fecha_ingreso);
  u.ultima_actividad = convertDateDMYtoYMD(u.ultima_actividad);
}

for (const item of interaccionesDedup) {
  if (!item._etiquetas_vacias && typeof item.etiquetas === 'string') {
    item.etiquetas = item.etiquetas.split('|').map((t) => t.trim()).filter(Boolean);
  }
  delete item._etiquetas_vacias;
}
```

### 3.5 Etapa 4: Validación Estricta de Tipos de Datos

Los campos booleanos (`es_artista` expresado como `1`/`0` y `consentimiento_datos` expresado como `si`/`no`) se convierten a valores booleanos nativos (`true`/`false`), y las métricas cuantitativas y coordenadas se fuerzan a enteros o flotantes verificando `Number.isNaN()`.

```javascript
// Etapa 4: Conversión y validación estricta de booleanos, enteros y flotantes
for (const u of usuariosDedup) {
  const rawArtista = String(u.es_artista).trim().toLowerCase();
  u.es_artista = rawArtista === '1' || rawArtista === 'true' || rawArtista === 'si';

  const rawConsent = String(u.consentimiento_datos).trim().toLowerCase();
  u.consentimiento_datos = rawConsent === 'si' || rawConsent === 'true' || rawConsent === '1';

  u.mensajes_30d = parseInt(u.mensajes_30d, 10) || 0;
  u.reacciones_30d = parseInt(u.reacciones_30d, 10) || 0;
  u.eventos_asistidos = parseInt(u.eventos_asistidos, 10) || 0;
  u.comisiones_compradas = parseInt(u.comisiones_compradas, 10) || 0;
  u.sentimiento_promedio = parseFloat(u.sentimiento_promedio) || 0.0;

  u.latitud = u.latitud !== '' ? parseFloat(u.latitud) : null;
  u.longitud = u.longitud !== '' ? parseFloat(u.longitud) : null;
}
```

### 3.6 Etapa 5: Verificación de Integridad Referencial y Cuarentena

Se indexa el padrón de usuarios válidos en un `Map` (`padronUsuariosMap`). Toda interacción cuyo `id_usuario` no exista en dicho mapa se desvía a la estructura `interaccionesCuarentena` con metadatos completos de auditoría.

```javascript
// Etapa 5: Separación de interacciones válidas (207) vs huérfanas en cuarentena (793)
const padronUsuariosMap = new Map(usuariosDedup.map((u) => [u.id_usuario, u]));
const interaccionesValidas = [];
const interaccionesCuarentena = [];

for (const item of interaccionesDedup) {
  if (padronUsuariosMap.has(item.id_usuario)) {
    interaccionesValidas.push(item);
  } else {
    interaccionesCuarentena.push({
      id_cuarentena: uuidv4(),
      id_interaccion: item.id_interaccion,
      id_usuario_huerfano: item.id_usuario,
      motivo_rechazo: `Integridad referencial fallida: id_usuario '${item.id_usuario}' no existe en el padrón de usuarios válidos`,
      fecha_deteccion: new Date().toISOString(),
      registro_original: { ...item },
    });
  }
}
```

### 3.7 Etapa 6: Regla de Privacidad Geográfica (`consentimiento_datos === false`)

Para los 171 usuarios sin consentimiento se anulan todas las propiedades geográficas, excluyéndolos del arreglo `ubicacionesLimpias` que alimenta a PostgreSQL, y forzando `ubicacion: null` en sus interacciones de DynamoDB.

```javascript
// Etapa 6: Supresión de datos geográficos para usuarios con consentimiento_datos === false
for (const u of usuariosDedup) {
  if (!u.consentimiento_datos) {
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
```

### 3.8 Etapa 7: Exportación Local de Datasets Depurados

Antes de transmitir los datos a la nube, el script escribe en el directorio local `/output_depurado` cuatro archivos listos para inspección:
- `usuarios_limpios.csv` (1,068 registros sin columnas de ubicación).
- `ubicaciones_limpias.csv` (897 registros exclusivos de usuarios con consentimiento positivo).
- `interacciones_limpias.json` (207 documentos validados y normalizados).
- `interacciones_cuarentena.json` (793 documentos huérfanos documentados).

```javascript
// Etapa 7: Escritura local en /output_depurado
writeCsvFile(path.join(OUTPUT_DIR, 'usuarios_limpios.csv'), headersUsuariosLimpios, usuariosLimpios);
writeCsvFile(path.join(OUTPUT_DIR, 'ubicaciones_limpias.csv'), headersUbicacionesLimpias, ubicacionesLimpias);
fs.writeFileSync(path.join(OUTPUT_DIR, 'interacciones_limpias.json'), JSON.stringify(interaccionesLimpiasDynamo, null, 2));
fs.writeFileSync(path.join(OUTPUT_DIR, 'interacciones_cuarentena.json'), JSON.stringify(interaccionesCuarentena, null, 2));
```

### 3.9 Etapa 8: Carga Transaccional Híbrida en la Nube (Amazon RDS + Amazon DynamoDB)

En la última etapa, el script verifica o crea la base `community360` en Amazon RDS, abre una transacción SQL (`BEGIN ... COMMIT`) para crear y poblar las **7 tablas relacionales normalizadas** (`cat_plataformas`, `cat_intereses`, `usuarios`, `ubicaciones_usuario`, `metricas_usuario`, `administradores_sistema` y `bitacora_etl`), y posteriormente aprovisiona en Amazon DynamoDB las tablas `interacciones` e `interacciones_cuarentena`, esperando a que su estado sea `ACTIVE` para insertar los documentos mediante lotes de 25 ítems (`BatchWriteCommand`).

```javascript
// Etapa 8 (Fragmento): Registro de auditoría en bitacora_etl y carga por lotes en DynamoDB
await client.query(
  `INSERT INTO bitacora_etl (
    registros_recibidos, registros_aceptados, registros_transformados, registros_rechazados, observaciones
  ) VALUES ($1, $2, $3, $4, $5)`,
  [
    registrosRecibidos,     // 2068
    registrosAceptados,     // 1275 (1068 usuarios + 207 interacciones válidas)
    registrosTransformados, // 2212
    registrosRechazados,    // 793 (enviados a cuarentena)
    'Carga híbrida completada con cumplimiento de privacidad e integridad referencial'
  ]
);

await ensureDynamoTable('interacciones', 'id_interaccion');
await ensureDynamoTable('interacciones_cuarentena', 'id_cuarentena');
await batchWriteDynamoItems('interacciones', interaccionesLimpiasDynamo);
await batchWriteDynamoItems('interacciones_cuarentena', interaccionesCuarentena);
```

---

## 4. Evidencia de Ejecución y Carga en la Nube

### 4.1 Ejecución Exitosa del Pipeline ETL en Consola y Generación de Archivos Depurados

En la siguiente captura se observa la salida completa en terminal de `node src/etl.js`, mostrando los resultados de auditoría de las etapas 1 a 7, la creación de los cuatro archivos en `/output_depurado` y la confirmación de carga de la Etapa 8 tanto en Amazon RDS (`community360`) como en Amazon DynamoDB:

![Ejecución exitosa del script ETL en consola](./evidencias/01_ejecucion_etl_consola.png)

### 4.2 Verificación en Amazon RDS PostgreSQL: Conteo de las 7 Tablas y Comprobación de Privacidad

Para comprobar directamente sobre el motor relacional en la nube que las 7 tablas fueron pobladas correctamente y que **ninguno de los 171 usuarios sin consentimiento** conserva datos geográficos, se ejecutó el script de auditoría SQL (`node src/verificar.js`) realizando un `COUNT(*)` por tabla y un `LEFT JOIN` entre `usuarios` y `ubicaciones_usuario` filtrando por `WHERE u.consentimiento_datos = FALSE`.

Como se aprecia en la captura:
1. `usuarios` y `metricas_usuario` cuentan con **1,068 registros**, mientras que `ubicaciones_usuario` tiene exactamente **897 registros** (`1,068 - 171 = 897`).
2. En la consulta `LEFT JOIN` sobre los usuarios con `consentimiento_datos = false` (`U000004`, `U000011`, `U000017`, etc.), las columnas `pais`, `estado`, `ciudad`, `latitud` y `longitud` aparecen todas en **`null`**.
3. El conteo final confirma **`171` usuarios sin consentimiento** y **`0` ubicaciones almacenadas por error**.

![Verificación de tablas y auditoría de privacidad en Amazon RDS PostgreSQL](./evidencias/04_verificacion_rds_privacidad.png)

### 4.3 Verificación en la Consola de Amazon DynamoDB (Tablas e Ítems Cargados)

En el panel de **Amazon DynamoDB** dentro de AWS Console se verifica la creación y estado `Active` de las dos tablas NoSQL aprovisionadas (`interacciones` con llave de partición `id_interaccion` e `interacciones_cuarentena` con llave de partición `id_cuarentena`):

![Tablas activas en la consola de Amazon DynamoDB](./evidencias/02_tablas_dynamodb.png)

Finalmente, mediante el explorador de ítems (**Explore items**) de Amazon DynamoDB sobre la tabla `interacciones`, se comprueba la estructura de los documentos cargados: las etiquetas almacenadas como listas nativas (`etiquetas`), los textos de reacciones vacías normalizados a `null` con `longitud_texto = 0` (por ejemplo, `I0001321`, `I0002939`, `I0002237`), y los atributos validados:

![Exploración de ítems normalizados en Amazon DynamoDB](./evidencias/03_items_dynamodb.jpg)

---

## Referencias (Formato APA 7.ª Edición)

- Amazon Web Services. (2026). *Amazon DynamoDB Developer Guide: Working with items and attributes in JavaScript (AWS SDK v3)*. AWS Documentation. https://docs.aws.amazon.com/dynamodb/
- Amazon Web Services. (2026). *Amazon Relational Database Service (RDS) User Guide for PostgreSQL*. AWS Documentation. https://docs.aws.amazon.com/rds/
- PostgreSQL Global Development Group. (2026). *PostgreSQL 16 Documentation: Data Manipulation and Transaction Control*. https://www.postgresql.org/docs/
