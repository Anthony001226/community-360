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

### 3.1 Tecnologías finales utilizadas

- **Base de datos relacional en la nube:** Amazon RDS con PostgreSQL (`community360`), conectada con SSL para guardar el padrón de usuarios, catálogos, métricas, ubicaciones autorizadas, administradores y bitácora (Amazon Web Services, 2026b).
- **Base de datos NoSQL en la nube:** Amazon DynamoDB en modo bajo demanda con las tablas `interacciones` e `interacciones_cuarentena` (Amazon Web Services, 2026a).
- **Backend:** Node.js con Express para la API REST, `pg` para PostgreSQL y el SDK v3 de AWS para DynamoDB.
- **WebSockets:** Socket.IO integrado en el mismo servidor de Express para enviar actualizaciones al navegador (Socket.IO, 2026).
- **Frontend y graficación:** HTML5, CSS3 y JavaScript sin frameworks pesados, junto con Chart.js servido localmente para la gráfica de barras y la dona (Chart.js Contributors, 2026).
- **Plataforma de despliegue:** [Indicar plataforma usada, por ejemplo: Render / Railway / EC2].

### 3.2 Modificaciones respecto a la Fase 1

- **Definición concreta de motores:** En la Fase 1 se contemplaban opciones abiertas entre PostgreSQL/MySQL y MongoDB Atlas/DynamoDB. Para la implementación final se eligió trabajar exclusivamente con **Amazon RDS (PostgreSQL)** y **Amazon DynamoDB** dentro de AWS, manteniendo ambos servicios en la misma región (`us-east-2`).
- **Base de datos aislada:** Se creó la base `community360` en Amazon RDS en lugar de reutilizar la base por defecto `postgres`, evitando mezclar tablas de prácticas anteriores.
- **Índices en DynamoDB:** Aunque en la Fase 1 se proyectaron índices secundarios globales (`gsi_usuario_fecha` y `gsi_canal_fecha`), durante la carga en la nube las tablas se crearon únicamente con su llave de partición (`Indexes: 0`) para simplificar el script ETL, dejando la creación de esos GSIs como mejora para escalar en el siguiente apartado.
- **Sin formularios en el dashboard:** A diferencia de ejemplos previos donde el CRUD estaba en la página web, aquí se dejó el tablero únicamente de lectura y análisis, restringiendo las altas, ediciones y bajas a Postman a través de la API REST.

---

## 4. Análisis de Base de Datos y Escalabilidad

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
  *(Inserta aquí la captura del Login)*

- **Vista principal del dashboard:** Muestra en la parte superior el estado de conexión en vivo y el botón de salida con el usuario activo, seguido de la franja de los seis KPIs con su fórmula, las gráficas de barras y dona, el mapa de calor semanal y el listado de actividad reciente.
  *(Inserta aquí la captura del dashboard completo en línea)*

### 5.4 Pruebas de actualización en vivo (Postman + Dashboard)

1. **Prueba 1 — Alta de interacción (`POST /api/interacciones`):**
   - Petición enviada desde Postman con un cuerpo JSON válido para un usuario existente en RDS, obteniendo respuesta `201 Created`.
   - En el navegador se observa el nuevo registro en la parte superior del feed, el incremento de una unidad en el canal correspondiente dentro de la gráfica de barras, la actualización de la celda de día/hora en el mapa de calor y el recálculo del sentimiento promedio sin recargar.
   - *(Inserta aquí la captura en pantalla dividida: Postman + Dashboard)*

2. **Prueba 2 — Modificación de interacción (`PUT /api/interacciones/:id`):**
   - Petición enviada desde Postman cambiando el canal y el valor de sentimiento del registro creado, obteniendo respuesta `200 OK`.
   - En el dashboard se observa cómo baja el conteo en el canal anterior, sube en el nuevo canal y cambia el promedio general de sentimiento al instante.
   - *(Inserta aquí la captura en pantalla dividida: Postman + Dashboard)*

3. **Prueba 3 — Eliminación de interacción (`DELETE /api/interacciones/:id`):**
   - Petición enviada desde Postman para borrar la interacción de prueba, obteniendo respuesta `200 OK`.
   - En el dashboard se observa que el canal regresa a su conteo previo y el sentimiento promedio vuelve a su valor anterior sin recargar la página.
   - *(Inserta aquí la captura en pantalla dividida: Postman + Dashboard)*

---

## 6. Enlaces de Despliegue y Credenciales de Evaluación

- **Liga pública del proyecto desplegado:** `https://[tu-url-publica-aqui]`
- **Credenciales del usuario docente:**
  - **Usuario:** `lizandro.reyes`
  - **Correo:** `lizandro.reyes@utmetropolitana.edu.mx`
  - **Contraseña:** `lizandr0_reye$`

---

## 7. Conclusiones y Referencias Bibliográficas (APA 7)

### Conclusiones
[Redacta aquí con tus propias palabras tu reflexión sobre los retos y aprendizajes al conectar Amazon RDS con DynamoDB, manejar las actualizaciones en vivo con Socket.IO desde Postman y desplegar la aplicación en línea.]

### Referencias
- Amazon Web Services. (2026a). *Amazon DynamoDB developer guide: Working with items and attributes in JavaScript (AWS SDK v3)*. AWS Documentation. https://docs.aws.amazon.com/dynamodb/
- Amazon Web Services. (2026b). *Amazon Relational Database Service (RDS) user guide for PostgreSQL*. AWS Documentation. https://docs.aws.amazon.com/rds/
- Chart.js Contributors. (2026). *Chart.js documentation*. https://www.chartjs.org/docs/
- Socket.IO. (2026). *Socket.IO documentation: Bidirectional and low-latency communication*. https://socket.io/docs/
