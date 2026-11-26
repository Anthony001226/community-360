# API CRUD + Amazon RDS (PostgreSQL)

## 1. Crear la base en AWS RDS
1. AWS Console → RDS → **Create database** → *Standard create* → motor **PostgreSQL** (el mismo motor de la unidad 1; el esquema es PostgreSQL).
2. Template **Free tier**, instancia `db.t3.micro` / `db.t4g.micro`.
3. DB instance identifier: `taller-db`. Usuario maestro: `postgres` + contraseña.
4. Connectivity: **Public access = Yes**.
5. VPC Security Group: agrega regla de entrada **PostgreSQL, TCP 5432** desde *My IP*.
6. Additional configuration → Initial database name: `taller`.
7. Espera a que esté *Available* y copia el **Endpoint**.

## 2. Configurar `.env`
Copia `.env.example` a `.env` y llena con tus datos del endpoint. No subas `.env` a git.

## 3. Crear tablas y correr
```
npm install
npm run init-db     # ejecuta db/schema.sql en RDS
npm start
```
Prueba: http://localhost:3000/health

## 4. Postman
```
npm run postman     # genera postman/coleccion.json
```
Importa `postman/coleccion.json` en Postman. Orden recomendado para POST (por llaves foráneas):
clientes → categorias_equipo → equipos → tecnicos → catalogo_servicios → ordenes_trabajo → detalle_servicios → proveedores → refacciones → consumo_refacciones → facturacion.

## Endpoints
`GET/POST /api/:tabla`, `GET/PUT/DELETE /api/:tabla/:id`

## Migrar datos desde Supabase (opcional)
Solo el esquema ya está en `db/schema.sql`. Para datos:
```
pg_dump --data-only --no-owner -h <host_supabase> -U postgres -d postgres -t clientes ... > datos.sql
psql -h <endpoint_rds> -U postgres -d taller -f datos.sql
```
