# McBarber

Sitio de reservas con React, Vite y Express. Express sirve la web y la API; Supabase proporciona PostgreSQL y Supabase Auth para el acceso del dueño. El esquema existente usa `servicios`, `barberos` y `citas`.

## Configuración

1. En la raíz del proyecto, configura `.env` con `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `SESSION_SECRET`.
   - `SUPABASE_SECRET_KEY` debe ser una clave secreta de servidor (o la clave heredada `service_role`), disponible en la configuración de API de Supabase. **No** uses la clave publicable/anon aquí ni pongas una clave secreta en `VITE_` o `NEXT_PUBLIC_`.
   - Genera `SESSION_SECRET` con al menos 32 caracteres aleatorios.
2. Configura `.env.local` con la URL del proyecto y su clave publicable:
   ```env
   VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_...
   ```
   La clave publicable se usa únicamente en el navegador para iniciar sesión en Supabase Auth.
3. En **Authentication → Users**, crea el usuario del dueño. Asígnale en `app_metadata` el rol `owner` (o `dueno`); solo las cuentas con ese rol pueden abrir el panel. No uses `user_metadata` para autorizar el acceso, porque el usuario puede modificarlo.
4. En el SQL Editor del proyecto, ejecuta [`supabase/migrations/20261008010000_booking_function.sql`](./supabase/migrations/20261008010000_booking_function.sql). Esta función guarda las reservas de forma transaccional en las tablas existentes. **No ejecutes** `20261008000000_initial_schema.sql` en una base que ya tiene el esquema del diagrama.
5. Ejecuta:

   ```bash
   npm install
   npm run dev
   ```

La web y su API se sirven en `http://localhost:3001`. El backend comprueba las columnas de `servicios`, `barberos` y `citas` antes de iniciar. La clave secreta de Supabase solo se usa en Express y nunca se envía al navegador.

Los horarios se ofrecen por barbero según los servicios y las citas existentes. Los datos de contacto del cliente se guardan en `citas.notas_cliente`, ya que el esquema permite una cita pública sin `cliente_id`.
