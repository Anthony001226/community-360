# COMMUNITY 360: Arquitectura de datos en la nube y dashboard analítico en tiempo real

## 1. Portada Institucional

- **Universidad:** Universidad Tecnológica Metropolitana
- **Carrera:** [Tu Carrera]
- **Asignatura:** Bases de Datos en la Nube (Unidad III)
- **Título del proyecto:** COMMUNITY 360: Arquitectura de datos en la nube y dashboard analítico en tiempo real
- **Alumno:** Marco Castellanos
- **Fecha de entrega:** [Fecha de entrega]

---

## 2. Descripción General del Sistema y Solución Planteada

> [!NOTE] Guía para redactar con tus palabras (Sección 2)
> **Qué puntos tocar:** Qué problema resuelve la app (juntar usuarios e interacciones en la nube en un solo panel), los 4 módulos (Login, carga inicial por REST, cambios en vivo con Socket.IO y respeto a la privacidad de los 171 usuarios) y mencionar que tu API tiene **15 endpoints**.
>
> **Propuesta de texto:** *"La página de COMMUNITY 360 junta los datos que limpiamos en la fase anterior para ver qué pasa en la comunidad sin tener que revisar archivos sueltos. Primero te pide iniciar sesión validando al usuario en Amazon RDS; ya adentro, carga el resumen de los 1,068 usuarios y las 207 interacciones válidas. Para que el tablero se mueva solo cuando se manda un cambio desde Postman, conecté WebSockets con Socket.IO, y además cuidé que cualquier interacción nueva respete si el usuario dio permiso o no de mostrar su ubicación."*

COMMUNITY 360 es una aplicación web diseñada para centralizar y analizar la actividad de una comunidad digital de 1,068 usuarios y sus interacciones en distintas redes sociales. El sistema resuelve el problema de tener la información repartida en archivos aislados, separando los datos estables del padrón en una base relacional y la actividad social en una base NoSQL, para mostrar indicadores claros en un tablero que se actualiza solo cuando ocurren cambios.

### 2.1 Módulos integrados

- **Autenticación (Login):** Al entrar a la página se muestra una pantalla de inicio de sesión. El servidor valida el usuario o correo y la contraseña contra la tabla de administradores en Amazon RDS antes de permitir el acceso al dashboard.
- **Consulta de métricas históricas (REST):** Al abrir el tablero después de iniciar sesión, la página pide por REST el resumen histórico guardado en Amazon RDS y Amazon DynamoDB para dibujar las tarjetas de indicadores, las gráficas y el mapa de calor.
- **Actualización en vivo sin recargar la página (WebSockets):** Usando Socket.IO, el servidor mantiene una conexión abierta con el navegador. Cuando desde Postman se crea, modifica o elimina una interacción mediante la API, el servidor avisa al instante al dashboard para que actualice los conteos y gráficas afectadas sin recargar.
- **Cumplimiento de privacidad geográfica:** Los 171 usuarios que no autorizaron el uso de su ubicación no tienen registros en la tabla de ubicaciones de PostgreSQL. Además, cuando se registra una interacción nueva para cualquiera de esos usuarios desde la API, el sistema verifica su consentimiento en RDS y guarda su ubicación como nula en DynamoDB.

### 2.2 Resumen de la API desarrollada

El backend está construido en Node.js con Express y cuenta con **15 endpoints REST** divididos según su función:

| # | Método y ruta | Propósito | Cómo interactúa con el dashboard |
| :-: | :--- | :--- | :--- |
| 1 | `POST /api/auth/login` | Verifica usuario/correo y contraseña en RDS y entrega un token de acceso. | Habilita la entrada al tablero principal. |
| 2 | `GET /api/auth/me` | Revisa si el token guardado en el navegador sigue siendo válido. | Mantiene la sesión iniciada al volver a abrir la página. |
| 3 | `GET /health` | Comprueba que la API tenga conexión activa con RDS y DynamoDB. | Permite verificar que el servicio en línea está saludable. |
| 4 | `GET /api/dashboard` | Junta en una sola respuesta los KPIs, canales, estatus, mapa de calor y actividad reciente. | Realiza la carga inicial completa al entrar al panel. |
| 5 | `GET /api/kpis` | Calcula los seis indicadores clave combinando RDS y DynamoDB. | Entrega los valores numéricos de la barra superior de KPIs. |
| 6 | `GET /api/interacciones/por-canal` | Agrupa las interacciones por red social. | Alimenta la gráfica de barras horizontales. |
| 7 | `GET /api/usuarios/por-estatus` | Cuenta cuántos usuarios están activos, inactivos o en riesgo en RDS. | Alimenta la gráfica de dona y su leyenda. |
| 8 | `GET /api/heatmap` | Genera una matriz de 7 días por 24 horas (UTC) con el total de interacciones. | Llena las celdas del mapa de calor semanal. |
| 9 | `GET /api/usuarios` | Lista usuarios con su plataforma, interés, métricas y ubicación (solo si dieron permiso). | Consulta administrativa del padrón por REST. |
| 10 | `GET /api/bitacora` | Devuelve el historial de cargas registrado en la tabla de bitácora del ETL. | Permite revisar los conteos de cargas anteriores. |
| 11 | `GET /api/interacciones` | Lista las interacciones guardadas en DynamoDB ordenadas de la más reciente a la más vieja. | Sirve para consultar y verificar registros desde Postman. |
| 12 | `GET /api/interacciones/:id` | Busca una interacción específica por su identificador. | Permite validar un registro puntual o devolver `404` si no existe. |
| 13 | `POST /api/interacciones` | Valida campos, revisa que el usuario exista en RDS, respeta su privacidad e inserta en DynamoDB (`201`). | Dispara el evento WebSocket para actualizar el dashboard en vivo. |
| 14 | `PUT /api/interacciones/:id` | Valida los datos enviados y modifica una interacción existente en DynamoDB (`200` o `404`). | Dispara el recálculo en vivo y actualiza el dashboard por WebSocket. |
| 15 | `DELETE /api/interacciones/:id` | Elimina una interacción existente en DynamoDB (`200` o `404`). | Dispara el recálculo en vivo para descontar el registro en el dashboard. |

---

## 3. Evolución del Stack Tecnológico

> [!NOTE] Guía para redactar con tus palabras (Sección 3)
> **Qué puntos tocar:** Qué herramientas usaste al final (Amazon RDS PostgreSQL, Amazon DynamoDB, Node.js/Express, Socket.IO, Chart.js y Render) y qué cambió respecto a la Fase 1 (te decidiste por PostgreSQL + DynamoDB, creaste la base limpia `community360`, dejaste las tablas de DynamoDB sin índices secundarios por ahora y quitaste formularios del frontend).
>
> **Propuesta de texto:** *"Al principio en la Fase 1 había dejado abiertas varias opciones como MySQL o MongoDB, pero ya para construirlo todo me quedé con PostgreSQL en Amazon RDS y DynamoDB en la misma región de AWS para evitar problemas de conexión. También creé una base aparte llamada community360 para no revolver tablas viejas, dejé las tablas de DynamoDB solo con su llave principal para no complicar la carga inicial y quité cualquier formulario de edición en el dashboard para que todo se pruebe desde Postman."*

### 3.1 Tecnologías finales utilizadas

- **Base de datos relacional en la nube:** Amazon RDS con PostgreSQL (`community360`), conectada con SSL para guardar el padrón de usuarios, catálogos, métricas, ubicaciones autorizadas, administradores y bitácora (Amazon Web Services, 2026b).
- **Base de datos NoSQL en la nube:** Amazon DynamoDB en modo bajo demanda con las tablas `interacciones` e `interacciones_cuarentena` (Amazon Web Services, 2026a).
- **Backend:** Node.js con Express para la API REST, `pg` para PostgreSQL y el SDK v3 de AWS para DynamoDB.
- **WebSockets:** Socket.IO integrado en el mismo servidor de Express para enviar actualizaciones al navegador (Socket.IO, 2026).
- **Frontend y graficación:** HTML5, CSS3 y JavaScript sin frameworks pesados, junto con Chart.js servido localmente para la gráfica de barras y la dona (Chart.js Contributors, 2026).
- **Plataforma de despliegue:** Render (Web Service en Node.js conectado al repositorio en GitHub).

### 3.2 Modificaciones respecto a la Fase 1

- **Definición concreta de motores:** En la Fase 1 se contemplaban opciones abiertas entre PostgreSQL/MySQL y MongoDB Atlas/DynamoDB. Para la implementación final se eligió trabajar exclusivamente con **Amazon RDS (PostgreSQL)** y **Amazon DynamoDB** dentro de AWS, manteniendo ambos servicios en la misma región (`us-east-2`).
- **Base de datos aislada:** Se creó la base `community360` en Amazon RDS en lugar de reutilizar la base por defecto `postgres`, evitando mezclar tablas de prácticas anteriores.
- **Índices en DynamoDB:** Aunque en la Fase 1 se proyectaron índices secundarios globales (`gsi_usuario_fecha` y `gsi_canal_fecha`), durante la carga en la nube las tablas se crearon únicamente con su llave de partición (`Indexes: 0`) para simplificar el script ETL, dejando la creación de esos GSIs como mejora para escalar en el siguiente apartado.
- **Sin formularios en el dashboard:** A diferencia de ejemplos previos donde el CRUD estaba en la página web, aquí se dejó el tablero únicamente de lectura y análisis, restringiendo las altas, ediciones y bajas a Postman a través de la API REST.

---

## 4. Análisis de Base de Datos y Escalabilidad

> [!NOTE] Guía para redactar con tus palabras (Sección 4)
> **Qué puntos tocar:** Cómo se comportaría tu base híbrida si pasara de 207 interacciones a cientos de miles (cuello de botella: hoy el backend hace un escaneo completo en DynamoDB en cada evento y recalcula todo) y qué cambiarías para escalar (crear los GSIs que faltaron, usar DynamoDB Streams/Lambda para contadores, meter caché con Redis y mandar solo el cambio puntual por WebSocket).
>
> **Propuesta de texto:** *"Con los datos actuales la página carga rápido, pero si llegaran cientos de miles de interacciones al mismo tiempo tendría un cuello de botella fuerte: ahorita el servidor escanea toda la tabla de DynamoDB cada vez que alguien entra o manda un cambio desde Postman. Para que aguante mucho tráfico, le agregaría los índices secundarios (GSI) que quedaron pendientes, guardaría los totales en caché con Redis para no consultar la base a cada rato y mandaría por WebSocket únicamente el dato que cambió en lugar de recalcular toda la tabla."*

El sistema utiliza un esquema híbrido: **PostgreSQL en Amazon RDS** para la información estructurada de usuarios y sus relaciones, y **DynamoDB** para los eventos de interacción que tienen listas de etiquetas y subdocumentos opcionales de ubicación.

### 4.1 Soporte ante grandes volúmenes de información

Con los datos actuales (1,068 usuarios y 207 interacciones válidas), las consultas responden rápido. Sin embargo, si el proyecto creciera a cientos de miles de usuarios e interacciones en tiempo real, aparecerían tres cuellos de botella importantes:

1. **Escaneo completo en DynamoDB:** Para obtener el sentimiento promedio, agrupar por canal y armar el mapa de calor, la API recorre toda la tabla `interacciones` cada vez que se abre el tablero o llega una petición `POST`, `PUT` o `DELETE`. Con cientos de miles de documentos, ese escaneo completo consumiría demasiada capacidad de lectura y tardaría varios segundos en responder.
2. **Recálculo total en cada cambio:** Volver a leer toda la tabla cada vez que entra una interacción por Postman saturaría el servidor si hubiera muchos usuarios enviando mensajes al mismo tiempo.
3. **Límites de la instancia RDS:** Una instancia básica de capa gratuita en RDS tiene pocas conexiones simultáneas y memoria limitada para recalcular agregaciones de cientos de miles de usuarios en cada carga inicial.

### 4.2 Modificaciones propuestas para escalar

Para que la arquitectura soporte un crecimiento masivo sin volverse lenta, se proponen los siguientes cambios:

1. **Crear los GSIs en DynamoDB:** Implementar los índices secundarios globales planeados desde la Fase 1 (`gsi_canal_fecha` y `gsi_usuario_fecha`) para consultar por canal o por usuario mediante `Query` en lugar de recorrer toda la tabla.
2. **Contadores precalculados con DynamoDB Streams y Lambda:** Mantener un registro de totales acumulados que se actualice automáticamente cada vez que entra o sale una interacción, evitando contar todos los documentos desde cero.
3. **Caché en memoria y actualizaciones parciales:** Guardar en Redis el resumen del dashboard para responder cargas iniciales rápido, y enviar por WebSocket solo el dato que cambió (por ejemplo, sumar 1 al canal y recalcular el promedio) en lugar de reenviar toda la matriz del mapa de calor.
4. **Índices y réplica de lectura en PostgreSQL:** Indexar las columnas de estatus y consentimiento, y agregar una réplica de solo lectura en RDS si aumenta mucho el tráfico de consultas.

---

## 5. Evidencias del Sistema Desplegado

> [!NOTE] Guía para redactar con tus palabras (Secciones 5.1 y 5.2)
> **Qué puntos tocar:** Explicar que los indicadores del padrón (RDS) solo se piden por REST al entrar porque no cambian con Postman, mientras que los de DynamoDB (sentimiento, barras por canal, mapa de calor y feed) sí van por WebSockets; y dar ejemplos concretos de decisiones con cada gráfica.
>
> **Propuesta de texto:** *"Dividí el consumo en dos partes para no gastar peticiones de más: las tarjetas de usuarios activos, en riesgo, consentimiento, actividad, comisiones y la dona de estatus solo se cargan por REST al abrir la página, porque vienen de RDS y no cambian cuando mandas una interacción desde Postman. En cambio, el sentimiento promedio, las barras por canal, el mapa de calor y la lista reciente sí se actualizan por WebSockets porque dependen de DynamoDB. Con esto podemos detectar rápido si sube el porcentaje de gente en riesgo (39.4 %) para mandarles avisos en sus redes principales como Telegram o Facebook, o ver a qué horas hay más movimiento en el mapa de calor para publicar eventos."*

### 5.1 Arquitectura de consumo (REST vs. WebSockets)

Cada parte del dashboard usa el mecanismo de comunicación que corresponde a la frecuencia con la que cambian sus datos:

- **Solo por REST (al abrir la página):**
  - *Tarjetas KPI del padrón (`Usuarios activos`, `Usuarios en riesgo`, `Con consentimiento`, `Actividad por usuario`, `Comisiones por artista`)* y la *gráfica de dona (`Estatus de usuarios`)*. Estos seis indicadores salen de las tablas de usuarios en Amazon RDS. Como crear, editar o borrar una interacción desde Postman no modifica el padrón de usuarios ni sus métricas de los últimos 30 días, basta con pedirlos una sola vez por REST al iniciar sesión.
- **Carga inicial por REST + actualización en vivo por WebSockets (`Socket.IO`):**
  - *Tarjeta `Sentimiento promedio`*, *gráfica de barras (`Interacciones por canal`)*, *mapa de calor (`Actividad por día y hora`)* y *feed de actividad reciente*. Estos cuatro elementos dependen directamente de la tabla `interacciones` en Amazon DynamoDB. Al iniciar se cargan por REST, y cada vez que entra un `POST`, `PUT` o `DELETE` desde Postman, el servidor emite el evento `dashboard_actualizado` para actualizarlos al instante sin recargar la página.

### 5.2 Justificación y utilidad de las métricas

- **Usuarios activos (36.5 %):** Muestra qué proporción del padrón participa de forma regular y sirve como línea base para medir si la comunidad crece o se estanca.
- **Usuarios en riesgo (39.4 %):** Al detectar que casi cuatro de cada diez miembros están en riesgo de abandono, el equipo puede enfocar avisos, dinámicas o mensajes directos en sus plataformas principales antes de que pasen a inactivos.
- **Con consentimiento (84.0 %):** Confirma qué parte del padrón autorizó compartir ubicación; permite saber si una muestra geográfica es representativa sin violar la privacidad del 16 % restante.
- **Sentimiento promedio:** Resume el tono general de los mensajes en una escala de -1 a +1. Si cae de forma repentina tras una actualización, alerta a los moderadores para revisar conflictos o quejas recientes.
- **Actividad por usuario:** Mide el promedio de mensajes y reacciones por miembro en 30 días, ayudando a evaluar si las dinámicas recientes generan conversación real.
- **Comisiones por artista:** Indica la demanda promedio de trabajo creativo por cada artista registrado, útil para decidir si conviene abrir más espacios de promoción o ferias de comisiones.
- **Gráfica de barras (Interacciones por canal):** Identifica qué redes concentran la actividad (como Discord y Telegram) para asignar más moderadores en esos canales y no desperdiciar esfuerzo en redes con poco movimiento.
- **Gráfica de dona (Estatus de usuarios):** Permite comparar visualmente en un vistazo a los usuarios activos frente a los inactivos y en riesgo dentro del total de 1,068 miembros.
- **Mapa de calor (Actividad por día y hora):** Muestra en qué días y horarios (UTC) hay más publicaciones, lo cual sirve para programar anuncios importantes, transmisiones o convocatorias de eventos cuando hay más gente conectada.

### 5.3 Capturas del acceso y vista general del sistema

- **Pantalla de inicio de sesión:** Esta vista restringe el acceso al tablero analítico mediante usuario o correo institucional y contraseña validados contra Amazon RDS, mostrando mensajes claros si las credenciales fallan.

  > **[CAPTURA 1 — PEGAR AQUÍ]:** Pantalla de Login en `https://community-360-mlwu.onrender.com` con el usuario `lizandro.reyes`.

- **Vista principal del dashboard:** Muestra en la parte superior el estado de conexión en vivo y el botón de salida con el usuario activo, seguido de la franja de los seis KPIs, las gráficas de barras y dona, el mapa de calor semanal y el listado de actividad reciente.

  > **[CAPTURA 2 — PEGAR AQUÍ]:** Vista completa del Dashboard desplegado en Render mostrando datos reales y el indicador `En vivo (WebSockets)`.

### 5.4 Pruebas de actualización en vivo (Postman + Dashboard)

1. **Prueba 1 — Alta de interacción (`POST /api/interacciones`):**
   - Petición enviada desde Postman con un cuerpo JSON válido para un usuario existente en RDS, obteniendo respuesta `201 Created`.
   - En el navegador se observa el nuevo registro en la parte superior del feed, el incremento de una unidad en el canal correspondiente dentro de la gráfica de barras (Discord pasa de 15 a 16), la actualización de la celda de día/hora en el mapa de calor y el recálculo del sentimiento promedio sin recargar.

   > **[CAPTURA 3 — PEGAR AQUÍ (Pantalla dividida)]:** Izquierda: Postman ejecutando `5. Crear Nueva Interacción (POST)` con respuesta `201 Created`. Derecha: Dashboard en Render mostrando `[creada] I9990001` en el feed y Discord actualizado en tiempo real.

2. **Prueba 2 — Modificación de interacción (`PUT /api/interacciones/:id`):**
   - Petición enviada desde Postman cambiando el canal a Telegram y el valor de sentimiento a `-0.45` sobre el registro creado, obteniendo respuesta `200 OK`.
   - En el dashboard se observa cómo baja el conteo en Discord, sube en Telegram y cambia el promedio general de sentimiento al instante.

   > **[CAPTURA 4 — PEGAR AQUÍ (Pantalla dividida)]:** Izquierda: Postman ejecutando `6. Actualizar Interacción (PUT)` con respuesta `200 OK`. Derecha: Dashboard en Render mostrando `[actualizada] I9990001`, el cambio de canal en la gráfica de barras y el nuevo sentimiento promedio.

3. **Prueba 3 — Eliminación de interacción (`DELETE /api/interacciones/:id`):**
   - Petición enviada desde Postman para borrar la interacción de prueba `I9990001`, obteniendo respuesta `200 OK`.
   - En el dashboard se observa que Telegram regresa a su conteo previo (70) y el sentimiento promedio vuelve a su valor original (`+0.299`) sin recargar la página.

   > **[CAPTURA 5 — PEGAR AQUÍ (Pantalla dividida)]:** Izquierda: Postman ejecutando `7. Eliminar Interacción (DELETE)` con respuesta `200 OK`. Derecha: Dashboard en Render mostrando `[eliminada] I9990001` y los valores restaurados en tiempo real.

---

## 6. Enlaces de Despliegue y Credenciales de Evaluación

- **Liga pública del proyecto desplegado:** https://community-360-mlwu.onrender.com
- **Credenciales del usuario docente:**
  - **Usuario:** `lizandro.reyes`
  - **Correo:** `lizandro.reyes@utmetropolitana.edu.mx`
  - **Contraseña:** `lizandr0_reye$`

---

## 7. Conclusiones y Referencias Bibliográficas (APA 7)

### Conclusiones

> [!NOTE] Guía para redactar con tus palabras (Sección 7)
> **Qué puntos tocar:** Qué fue lo que más trabajo te costó (abrir el puerto 5432 en AWS, conectar RDS + DynamoDB en Render, lograr que Postman actualizara el dashboard sin recargar) y qué aprendiste de usar SQL + NoSQL juntos.
>
> **Propuesta de texto:** *"Lo que más me costó trabajo al principio fue la conexión hacia Amazon RDS por las reglas del firewall y entender cómo separar bien qué datos iban en SQL y cuáles en NoSQL. Al final me di cuenta de que combinar PostgreSQL para los datos fijos de usuarios y DynamoDB para las interacciones hace mucho más ordenado el proyecto, y ver cómo una petición en Postman actualiza las gráficas en Render al instante me ayudó a entender cómo funcionan los dashboards reales en la nube."*

[Redacta aquí con tus propias palabras tu reflexión sobre los retos y aprendizajes al conectar Amazon RDS con DynamoDB, manejar las actualizaciones en vivo con Socket.IO desde Postman y desplegar la aplicación en línea.]

### Referencias
- Amazon Web Services. (2026a). *Amazon DynamoDB developer guide: Working with items and attributes in JavaScript (AWS SDK v3)*. AWS Documentation. https://docs.aws.amazon.com/dynamodb/
- Amazon Web Services. (2026b). *Amazon Relational Database Service (RDS) user guide for PostgreSQL*. AWS Documentation. https://docs.aws.amazon.com/rds/
- Chart.js Contributors. (2026). *Chart.js documentation*. https://www.chartjs.org/docs/
- Socket.IO. (2026). *Socket.IO documentation: Bidirectional and low-latency communication*. https://socket.io/docs/
