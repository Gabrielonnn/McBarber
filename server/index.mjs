import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { createServer as createViteServer } from 'vite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 3001)
const sessionSecret = process.env.SESSION_SECRET
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SECRET_KEY

if (!supabaseUrl || !supabaseKey || !sessionSecret || sessionSecret.length < 32) {
  throw new Error('Configura SUPABASE_URL, SUPABASE_SECRET_KEY y un SESSION_SECRET de al menos 32 caracteres en .env.')
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '16kb' }))

const cookieName = 'mcbarber_session'
const sessionDuration = 8 * 60 * 60

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt: Math.floor(Date.now() / 1000) + sessionDuration })).toString('base64url')
  const signature = createHmac('sha256', sessionSecret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function sessionUser(req) {
  const value = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  if (!value) return null
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  const expected = createHmac('sha256', sessionSecret).update(payload).digest()
  let received
  try {
    received = Buffer.from(signature, 'base64url')
  } catch {
    return null
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return session.expiresAt > Math.floor(Date.now() / 1000) ? session.userId : null
  } catch {
    return null
  }
}

function setSessionCookie(res, value, maxAge = sessionDuration) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`)
}

function requireOwner(req, res, next) {
  if (!sessionUser(req)) return res.status(401).json({ error: 'Inicia sesión para continuar.' })
  next()
}

function sendError(res, error, message = 'Ocurrió un error al comunicarse con la base de datos.') {
  console.error(error)
  return res.status(500).json({ error: message })
}

function mxDateTime() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` }
}

function validBusinessDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

function maximumBookingDate() {
  const maximum = new Date(`${mxDateTime().date}T00:00:00Z`)
  maximum.setUTCDate(maximum.getUTCDate() + 90)
  return maximum.toISOString().slice(0, 10)
}

function dbTime(value) {
  return String(value).slice(0, 8)
}

function appointmentDto(row) {
  const date = String(row.fecha).slice(0, 10)
  const time = dbTime(row.hora)
  const status = { confirmada: 'confirmed', pendiente: 'confirmed', completada: 'completed', cancelada: 'cancelled' }[row.estado] ?? 'confirmed'
  const customerDetails = /^Cliente: ([^\r\n]*)\r?\nTeléfono: ([^\r\n]*)$/.exec(row.notas_cliente ?? '')
  return {
    id: String(row.id),
    appointment_at: `${date}T${time}`,
    customer_name: customerDetails?.[1] ?? 'Cliente',
    phone: customerDetails?.[2] ?? '',
    service_name: row.service_name,
    price_cents: Math.round(Number(row.price) * 100),
    duration_minutes: row.duration_minutes,
    barber_name: row.barber_name,
    status,
  }
}

app.get('/api/auth/session', async (req, res) => {
  const userId = sessionUser(req)
  if (!userId) return res.json({ user: null })
  try {
    const { data: { user: owner }, error } = await supabase.auth.admin.getUserById(userId)
    if (error) throw error
    if (!owner || !['owner', 'dueno'].includes(owner.app_metadata?.role)) {
      setSessionCookie(res, '', 0)
      return res.json({ user: null })
    }
    return res.json({ user: { id: owner.id, name: owner.user_metadata?.full_name ?? owner.email ?? '' } })
  } catch (error) {
    return sendError(res, error, 'No se pudo verificar la sesión.')
  }
})

app.post('/api/auth/session', async (req, res) => {
  const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken : ''
  if (!accessToken || accessToken.length > 4096) {
    return res.status(400).json({ error: 'Inicia sesión con tu cuenta de Supabase Auth.' })
  }
  try {
    const { data: { user: owner }, error } = await supabase.auth.getUser(accessToken)
    if (error) throw error
    if (!owner || !['owner', 'dueno'].includes(owner.app_metadata?.role)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' })
    }
    setSessionCookie(res, signSession(owner.id))
    return res.json({ user: { id: owner.id, name: owner.user_metadata?.full_name ?? owner.email ?? '' } })
  } catch (error) {
    return sendError(res, error, 'No se pudo iniciar sesión.')
  }
})

app.post('/api/auth/logout', (_req, res) => {
  setSessionCookie(res, '', 0)
  res.status(204).end()
})

app.get('/api/services', async (_req, res) => {
  try {
    const { data: services, error } = await supabase.from('servicios')
      .select('id,nombre,descripcion,precio,duracion_minutos')
      .eq('activo', true)
      .order('id')
    if (error) throw error
    res.json(services.map((service) => ({
      id: String(service.id),
      name: service.nombre,
      description: service.descripcion ?? '',
      duration: service.duracion_minutos,
      price: Math.round(Number(service.precio) * 100) / 100,
    })))
  } catch (error) {
    return sendError(res, error, 'No se pudieron cargar los servicios.')
  }
})

app.get('/api/availability', async (req, res) => {
  const { date, serviceId } = req.query
  if (typeof date !== 'string' || !validBusinessDate(date) || typeof serviceId !== 'string' || !/^\d+$/.test(serviceId)) {
    return res.status(400).json({ error: 'La fecha o el servicio no son válidos.' })
  }
  try {
    const [serviceResult, barberResult, appointmentResult, servicesResult] = await Promise.all([
      supabase.from('servicios').select('duracion_minutos').eq('id', Number(serviceId)).eq('activo', true).maybeSingle(),
      supabase.from('barberos').select('id,nombre_completo').eq('activo', true).order('nombre_completo'),
      supabase.from('citas').select('barbero_id,hora,servicio_id').eq('fecha', date).in('estado', ['confirmada', 'pendiente']),
      supabase.from('servicios').select('id,duracion_minutos'),
    ])
    for (const result of [serviceResult, barberResult, appointmentResult, servicesResult]) {
      if (result.error) throw result.error
    }
    const duration = serviceResult.data?.duracion_minutos
    if (!duration) return res.status(404).json({ error: 'El servicio seleccionado no está disponible.' })
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (day === 0) return res.json([])
    const { date: today, time: now } = mxDateTime()
    if (date < today || date > maximumBookingDate()) return res.json([])
    const durationsByService = new Map(servicesResult.data.map((service) => [service.id, service.duracion_minutos]))
    const busyByBarber = new Map()
    for (const appointment of appointmentResult.data) {
      const busy = busyByBarber.get(appointment.barbero_id) ?? []
      busy.push({ time: dbTime(appointment.hora), duration: durationsByService.get(appointment.servicio_id) })
      busyByBarber.set(appointment.barbero_id, busy)
    }
    const availability = []
    for (const barber of barberResult.data) {
      for (let minutes = 9 * 60; minutes + duration <= 19 * 60; minutes += 30) {
        const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
        if (date === today && time <= now) continue
        const start = minutes
        const end = start + duration
        const overlapsExisting = (busyByBarber.get(barber.id) ?? []).some(({ time: busyTime, duration: busyDuration }) => {
          if (!busyDuration) return false
          const [hour, minute] = busyTime.split(':').map(Number)
          const busyStart = hour * 60 + minute
          return start < busyStart + busyDuration && end > busyStart
        })
        if (!overlapsExisting) availability.push({ barber_id: barber.id, barber_name: barber.nombre_completo, time })
      }
    }
    res.json(availability)
  } catch (error) {
    return sendError(res, error, 'No se pudieron consultar los horarios.')
  }
})

app.post('/api/appointments', async (req, res) => {
  const { customerName, phone, date, time, serviceId, barberId } = req.body ?? {}
  if (typeof customerName !== 'string' || customerName.trim().length < 2 || customerName.trim().length > 80
    || /[\r\n]/.test(customerName)
    || typeof phone !== 'string' || phone.trim().length < 8 || phone.trim().length > 24
    || typeof date !== 'string' || !validBusinessDate(date)
    || typeof time !== 'string' || !/^(09|1[0-8]):(00|30)$/.test(time)
    || !/^\d+$/.test(String(serviceId)) || typeof barberId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(barberId)) {
    return res.status(400).json({ error: 'Revisa los datos de la cita e inténtalo de nuevo.' })
  }
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  const minute = Number(time.slice(3))
  const hour = Number(time.slice(0, 2))
  const { date: today, time: now } = mxDateTime()
  if (day === 0 || date < today || date > maximumBookingDate()
    || (date === today && time <= now) || minute % 30 !== 0 || hour < 9 || hour >= 19) {
    return res.status(400).json({ error: 'Ese horario no está disponible.' })
  }

  try {
    if (phone.trim().length > 20) {
      return res.status(400).json({ error: 'El teléfono no puede superar 20 caracteres.' })
    }
    const { data, error } = await supabase.rpc('crear_cita', {
      p_customer_name: customerName.trim(),
      p_phone: phone.trim(),
      p_date: date,
      p_time: time,
      p_service_id: Number(serviceId),
      p_barber_id: barberId,
    })
    if (error) {
      if (error.code === '23P01' || error.message.includes('SLOT_TAKEN')) {
        return res.status(409).json({ error: 'Ese horario acaba de ocuparse. Elige otro para continuar.' })
      }
      if (error.message.includes('SERVICE_OR_BARBER_UNAVAILABLE')) {
        return res.status(400).json({ error: 'El servicio o barbero ya no está disponible.' })
      }
      throw error
    }
    return res.status(201).json({ id: String(data) })
  } catch (error) {
    return sendError(res, error, 'No se pudo guardar la cita.')
  }
})

app.get('/api/appointments', requireOwner, async (_req, res) => {
  try {
    const { data: appointments, error } = await supabase.from('citas').select(`
      id,fecha,hora,estado,notas_cliente,
      barbero:barberos(nombre_completo),
      servicio:servicios(nombre,precio,duracion_minutos)
    `).order('fecha').order('hora').limit(200)
    if (error) throw error
    res.json(appointments.map((appointment) => appointmentDto({
      ...appointment,
      barber_name: appointment.barbero.nombre_completo,
      service_name: appointment.servicio.nombre,
      price: appointment.servicio.precio,
      duration_minutes: appointment.servicio.duracion_minutos,
    })))
  } catch (error) {
    return sendError(res, error, 'No se pudieron cargar las citas.')
  }
})

app.patch('/api/appointments/:id/status', requireOwner, async (req, res) => {
  const id = req.params.id
  const status = { confirmed: 'confirmada', completed: 'completada', cancelled: 'cancelada' }[req.body?.status]
  if (!/^\d+$/.test(id) || !status) {
    return res.status(400).json({ error: 'La cita o el estado no son válidos.' })
  }
  try {
    const { data, error } = await supabase.from('citas').update({ estado: status }).eq('id', id).select('id').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'No se encontró esa cita.' })
    res.json({ success: true })
  } catch (error) {
    return sendError(res, error, 'No se pudo actualizar la cita.')
  }
})

const httpServer = createServer(app)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')))
  app.get(/.*/, (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
} else {
  const vite = await createViteServer({
    configFile: path.join(root, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

try {
  for (const [table, columns] of [
    ['servicios', 'id,nombre,descripcion,precio,duracion_minutos,activo'],
    ['barberos', 'id,nombre_completo,telefono,activo'],
    ['citas', 'id,cliente_id,barbero_id,servicio_id,fecha,hora,estado,notas_cliente,creado_en'],
  ]) {
    const { error } = await supabase.from(table).select(columns, { head: true }).limit(0)
    if (error) throw error
  }
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`McBarber disponible en http://localhost:${port}`)
  })
} catch (error) {
  console.error('No se pudo conectar a Supabase. Revisa SUPABASE_URL y SUPABASE_SECRET_KEY en .env.', error)
  process.exitCode = 1
}
