import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarCheck, CalendarDays, Check, CircleDollarSign, Clock3, LockKeyhole, LogOut, MapPin, Phone, Scissors, ShieldCheck, Sparkles, UserRound, XCircle } from 'lucide-react'
import { api, ApiError } from './lib/api'
import { getAuthClient } from './lib/supabase'
import './App.css'

type Status = 'confirmed' | 'completed' | 'cancelled'
type Appointment = { id: string; appointment_at: string; customer_name: string; phone: string; service_name: string; price_cents: number; duration_minutes: number; barber_name: string; status: Status }
type Service = { id: string; name: string; description: string; duration: number; price: number }
type AvailableSlot = { barber_id: string; barber_name: string; time: string }

const initialServices: Service[] = [
  { id: '1', name: 'Corte Clásico', description: '', duration: 30, price: 150 },
  { id: '2', name: 'Corte + Barba', description: '', duration: 45, price: 220 },
  { id: '3', name: 'Afeitado con Navaja', description: '', duration: 30, price: 120 },
  { id: '4', name: 'Corte Niño', description: '', duration: 25, price: 100 },
  { id: '5', name: 'Tinte', description: '', duration: 60, price: 350 },
]
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function formatMoney(cents: number) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(cents / 100) }
function formatDate(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) { return new Intl.DateTimeFormat('es-MX', options).format(new Date(`${date}T12:00:00`)) }
function formatTime(date: string) { return new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(date)) }

function App() {
  const today = dateKey(new Date())
  const [page, setPage] = useState<'home' | 'admin'>('home')
  const [ownerSession, setOwnerSession] = useState<'supabase' | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [services, setServices] = useState(initialServices)
  const [selectedService, setSelectedService] = useState(initialServices[0].id)
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedTime, setSelectedTime] = useState('')
  const [selectedBarber, setSelectedBarber] = useState('')
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([])
  const [availabilityVersion, setAvailabilityVersion] = useState(0)
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [appointmentsLoading, setAppointmentsLoading] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [bookingError, setBookingError] = useState('')
  const [bookingSuccess, setBookingSuccess] = useState('')
  const [bookingLoading, setBookingLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')

  const activeService = services.find((service) => service.id === selectedService) ?? services[0]
  const barbers = [...new Map(availableSlots.map((slot) => [slot.barber_id, { id: slot.barber_id, name: slot.barber_name }])).values()]
  const barberSlots = availableSlots.filter((slot) => slot.barber_id === selectedBarber)
  const isOwner = ownerSession !== null

  useEffect(() => {
    let active = true
    void Promise.all([
      api<{ user: { id: string } | null }>('/api/auth/session'),
      api<Service[]>('/api/services'),
    ]).then(([session, loadedServices]) => {
      if (!active) return
      setOwnerSession(session.user ? 'supabase' : null)
      if (loadedServices.length) {
        setServices(loadedServices)
        setSelectedService(loadedServices[0].id)
      }
      setAuthReady(true)
    }).catch((error: unknown) => {
      if (!active) return
      setBookingError('No se pudo conectar con la base de datos. Revisa la configuración del servidor.')
      setLoginError(error instanceof ApiError ? error.message : 'No se pudo conectar con la base de datos.')
      setAuthReady(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setAvailabilityLoading(true)
    setBookingError('')
    setAvailableSlots([])
    if (!activeService) { setAvailabilityLoading(false); return }
    void api<AvailableSlot[]>(`/api/availability?date=${encodeURIComponent(selectedDate)}&serviceId=${encodeURIComponent(activeService.id)}`)
      .then((data) => { if (active) setAvailableSlots(data) })
      .catch(() => { if (active) setBookingError('No pudimos consultar los horarios. Revisa la conexión con la base de datos.') })
      .finally(() => { if (active) setAvailabilityLoading(false) })
    return () => { active = false }
  }, [selectedDate, selectedService, availabilityVersion])

  useEffect(() => {
    if (page !== 'admin' || !isOwner) return
    let active = true
    setAppointmentsLoading(true)
    setAdminError('')
    void api<Appointment[]>('/api/appointments')
      .then((data) => { if (active) setAppointments(data) })
      .catch(() => { if (active) setAdminError('No se pudieron cargar las citas. Comprueba la conexión con la base de datos.') })
      .finally(() => { if (active) setAppointmentsLoading(false) })
    return () => { active = false }
  }, [page, isOwner])

  function openAdmin() { setLoginError(''); setPage('admin') }
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginLoading(true); setLoginError('')
    try {
      const authClient = getAuthClient()
      const { data, error } = await authClient.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      if (!data.session) throw new Error('Supabase Auth no devolvió una sesión válida.')
      try {
        await api('/api/auth/session', {
          method: 'POST',
          body: JSON.stringify({ accessToken: data.session.access_token }),
        })
      } catch (error) {
        const { error: signOutError } = await authClient.auth.signOut()
        if (signOutError) console.error('No se pudo limpiar la sesión de Supabase Auth.', signOutError)
        throw error
      }
      setOwnerSession('supabase')
      setPage('admin')
    } catch (error) {
      setLoginError(error instanceof ApiError || error instanceof Error ? error.message : 'No se pudo iniciar sesión.')
    } finally {
      setLoginLoading(false)
    }
  }
  async function signOut() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
      const { error } = await getAuthClient().auth.signOut()
      if (error) throw error
    } catch {
      setAdminError('No se pudo cerrar la sesión. Inténtalo de nuevo.')
      return
    }
    setOwnerSession(null)
    setPage('home')
  }
  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBookingError(''); setBookingSuccess(''); setBookingLoading(true)
    try {
      if (!selectedBarber || !activeService) throw new Error('Elige un barbero disponible.')
      await api('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          customerName: customerName.trim(),
          phone: customerPhone.trim(),
          date: selectedDate,
          time: selectedTime,
          serviceId: activeService.id,
          barberId: selectedBarber,
        }),
      })
      const barber = availableSlots.find((slot) => slot.barber_id === selectedBarber)?.barber_name
      setBookingSuccess(`${activeService.name} · ${formatDate(selectedDate)} a las ${selectedTime}${barber ? ` con ${barber}` : ''}`)
      setCustomerName('')
      setCustomerPhone('')
      setSelectedTime('')
      setAvailabilityVersion((version) => version + 1)
    } catch (error) {
      setBookingError(error instanceof ApiError ? error.message : 'No pudimos guardar tu cita. Inténtalo de nuevo en un momento.')
    } finally {
      setBookingLoading(false)
    }
  }
  async function updateStatus(id: string, status: Status) {
    try {
      await api(`/api/appointments/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setAppointments((current) => current.map((appointment) => appointment.id === id ? { ...appointment, status } : appointment))
    } catch (error) {
      setAdminError(error instanceof ApiError ? error.message : 'No se pudo actualizar la cita. Inténtalo de nuevo.')
    }
  }

  const upcomingAppointments = appointments.filter((appointment) => appointment.appointment_at >= new Date().toISOString() && appointment.status !== 'cancelled')
  const todayAppointments = upcomingAppointments.filter((appointment) => dateKey(new Date(appointment.appointment_at)) === today)
  const filteredAppointments = appointments.filter((appointment) => filter === 'all' || appointment.status === filter)
  const totalToday = todayAppointments.reduce((total, appointment) => total + appointment.price_cents, 0)

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#inicio" onClick={() => setPage('home')} aria-label="Marco Beltrán Barbería, inicio"><img className="brand-logo" src="/marco-beltran-logo.png" alt="" /><span className="brand-word">MARCO BELTRÁN<span>BARBERÍA</span></span></a>
        {page === 'home' ? <><nav className="main-nav" aria-label="Navegación principal"><a href="#servicios">Servicios</a><a href="#reserva">Reservar</a><a href="#visitanos">Visítanos</a></nav><button className="owner-link" type="button" onClick={openAdmin}><LockKeyhole size={15} /><span>Acceso dueño</span></button></> : <button className="back-link" type="button" onClick={() => setPage('home')}><ArrowLeft size={16} /> Volver al sitio</button>}
      </header>
      {page === 'home' ? <main>
        <section className="hero" id="inicio">
          <div className="hero-barber-decor" aria-hidden="true">
            <Scissors className="hero-barber-scissors" size={112} strokeWidth={0.8} />
            <span className="hero-barber-pole" />
            <span className="hero-barber-comb" />
            <span className="hero-barber-spark hero-barber-spark-one" />
            <span className="hero-barber-spark hero-barber-spark-two" />
          </div>
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line" /> MARCO BELTRÁN · BARBERÍA</div><h1>El arte de<br /><em>llevar tu estilo.</em></h1><p className="hero-description">Precisión en cada detalle. Un espacio para bajar el ritmo y salir sintiéndote mejor.</p><div className="hero-actions"><a className="button button-primary" href="#reserva">Reserva tu momento <ArrowUpRight size={17} /></a><a className="text-link" href="#servicios">Explorar servicios <ArrowRight size={15} /></a></div><div className="hero-proof"><span className="proof-stars">✦</span><span>Atención personalizada</span><span className="proof-divider" /><span>Solo con cita</span></div><span className="hero-number" aria-hidden="true">01</span></div>
          <div className="hero-visual"><img src="https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=1200&q=85" alt="Interior de una barbería clásica y elegante" /><div className="image-label"><span className="label-dot" /> CON CITA <span>LUN — SÁB · 09:00 — 19:00</span></div><div className="hero-stamp"><Scissors size={18} /><span>OFICIO<br />Y DETALLE</span></div><div className="photo-caption">EL ESTILO SE<br />TRABAJA<span>— MARCO BELTRÁN</span></div></div>
          <a className="scroll-cue" href="#reserva"><span /> DESLIZA PARA RESERVAR</a>
        </section>
        <section className="trust-strip" aria-label="Lo que nos distingue"><div><Sparkles size={17} /><span>Un espacio para desconectar</span></div><span className="strip-separator" /><div><ShieldCheck size={17} /><span>Barberos con oficio</span></div><span className="strip-separator" /><div><Clock3 size={17} /><span>Sin esperas, con cita</span></div></section>
        <section className="booking-section" id="reserva">
          <div className="section-heading"><div className="eyebrow"><span className="eyebrow-line" /> TU SILLA TE ESPERA</div><h2>Reserva en <em>tres pasos.</em></h2><p>Elige tu servicio, encuentra tu horario y nos vemos pronto.</p></div>
          <form className="booking-layout" onSubmit={submitBooking}>
            <div className="booking-main">
              <div className="booking-step"><div className="step-heading"><span className="step-number">01</span><div><h3>Elige tu servicio</h3><p>Un buen resultado empieza con el ritual adecuado.</p></div></div><div className="service-grid" id="servicios">{services.map((service, index) => <button className={`service-option${selectedService === service.id ? ' selected' : ''}`} type="button" key={service.id} onClick={() => { setSelectedService(service.id); setSelectedBarber(''); setSelectedTime(''); setBookingSuccess('') }} aria-pressed={selectedService === service.id}><span className="service-index">SERVICIO <span>{String(index + 1).padStart(2, '0')}</span></span><span className="service-check">{selectedService === service.id && <Check size={13} />}</span><span className="service-info"><strong>{service.name}</strong>{service.description && <small>{service.description}</small>}<small className="service-duration"><Clock3 size={12} /> {service.duration} min</small></span><span className="service-price">{formatMoney(service.price * 100)}</span><span className="service-select-label">{selectedService === service.id ? 'SELECCIONADO' : 'ELEGIR SERVICIO'} <ArrowUpRight size={13} /></span></button>)}</div></div>
              <div className="booking-step"><div className="step-heading"><span className="step-number">02</span><div><h3>Encuentra tu momento</h3><p>Selecciona el día, el barbero y la hora que te vengan bien.</p></div></div><label className="date-field"><CalendarDays size={17} /><span>FECHA</span><input type="date" min={today} value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setSelectedBarber(''); setSelectedTime(''); setBookingSuccess('') }} required /></label><label className="input-label" htmlFor="barber-select">BARBEROS DISPONIBLES</label><div className="input-wrap"><Scissors size={16} /><select id="barber-select" value={selectedBarber} onChange={(event) => { setSelectedBarber(event.target.value); setSelectedTime(''); setBookingSuccess('') }} disabled={availabilityLoading || barbers.length === 0} required><option value="">Selecciona un barbero</option>{barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select></div><div className="slot-header"><span>HORARIOS DISPONIBLES</span>{availabilityLoading && <span className="availability-loading">Consultando...</span>}</div><div className="time-grid">{barberSlots.map(({ time }) => <button className={`time-option${selectedTime === time ? ' selected' : ''}`} type="button" key={time} disabled={availabilityLoading || Boolean(bookingError)} onClick={() => { setSelectedTime(time); setBookingSuccess('') }}>{time}</button>)}</div>{!availabilityLoading && !bookingError && barbers.length === 0 && <p className="form-message">No hay barberos u horarios disponibles para ese día.</p>}{selectedBarber && barberSlots.length === 0 && !availabilityLoading && !bookingError && <p className="form-message">No hay horarios disponibles para este barbero. Elige otro.</p>}{bookingError && <p className="form-message error-message" role="alert">{bookingError}</p>}</div>
            </div>
            <aside className="booking-aside"><div className="step-heading"><span className="step-number">03</span><div><h3>Tus datos</h3><p>Y listo, apartamos tu silla.</p></div></div><label className="input-label" htmlFor="customer-name">NOMBRE COMPLETO</label><div className="input-wrap"><UserRound size={16} /><input id="customer-name" autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="¿Cómo te llamas?" minLength={2} maxLength={80} required /></div><label className="input-label" htmlFor="customer-phone">TELÉFONO</label><div className="input-wrap"><Phone size={16} /><input id="customer-phone" type="tel" autoComplete="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="55 1234 5678" minLength={8} maxLength={24} required /></div><div className="summary-divider" /><div className="summary-row"><span>{activeService.name}</span><span>{formatMoney(activeService.price * 100)}</span></div><div className="summary-row summary-muted"><span><CalendarDays size={14} /> {formatDate(selectedDate, { day: 'numeric', month: 'short' })}{selectedTime && ` · ${selectedTime}`}</span><span>{activeService.duration} min</span></div>{bookingSuccess ? <div className="booking-confirmation" role="status"><span className="confirmation-icon"><Check size={18} /></span><strong>¡Tu cita está apartada!</strong><span>{bookingSuccess}</span><small>Te esperamos en Marco Beltrán. Si necesitas cambiarla, llámanos.</small></div> : <button className="button button-primary submit-booking" type="submit" disabled={!selectedTime || availabilityLoading || bookingLoading}>{bookingLoading ? 'Apartando tu silla…' : 'Confirmar cita'} <ArrowRight size={17} /></button>}<p className="booking-note"><ShieldCheck size={13} /> Sin pago anticipado · Cancelación gratuita</p></aside>
          </form>
        </section>
        <section className="visit-section" id="visitanos"><div className="visit-mark"><Scissors size={25} /></div><div className="visit-copy"><span className="eyebrow">NOS ENCUENTRAS EN</span><h2>El barrio se ve<br /><em>mejor desde aquí.</em></h2></div><div className="visit-details"><p><MapPin size={17} /> Av. Álvaro Obregón 142, Roma Norte<br /><span>Ciudad de México, CDMX</span></p><p><Clock3 size={17} /> Lun — Sáb <span>09:00 — 19:00</span></p><a href="https://maps.google.com/?q=Av.+Alvaro+Obregon+142+Roma+Norte+CDMX" target="_blank" rel="noreferrer">Cómo llegar <ArrowUpRight size={15} /></a></div><span className="visit-watermark" aria-hidden="true">M</span></section>
        <footer className="footer"><a className="brand footer-brand" href="#inicio"><img className="brand-logo" src="/marco-beltran-logo.png" alt="" /><span className="brand-word">MARCO BELTRÁN<span>BARBERÍA</span></span></a><span>Un buen corte. Y a seguir con tu día.</span><a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram"><ArrowUpRight size={18} /></a><small>© {new Date().getFullYear()} Marco Beltrán Barbería</small></footer>
      </main> : <main className="admin-page">
        {!authReady ? <div className="admin-loading"><span className="loader" />Comprobando sesión…</div> : !isOwner ? <section className="login-shell">
          <div className="login-visual">
            <div className="login-shapes" aria-hidden="true"><span className="login-shape login-shape-orb" /><span className="login-shape login-shape-ring" /><span className="login-shape login-shape-diamond" /><span className="login-shape login-shape-pill" /></div>
            <div className="login-brandline"><img className="login-emblem" src="/marco-beltran-logo.png" alt="Logotipo de Marco Beltrán Barbería" /><span>MARCO BELTRÁN<small>BARBERÍA · CDMX</small></span></div>
            <div className="login-editorial"><span className="eyebrow"><span className="eyebrow-line" /> ESPACIO PRIVADO</span><h1>Las llaves<br />del <em>local.</em></h1><p>Tu negocio, tus citas y tu tiempo, en un solo lugar.</p></div>
            <div className="login-perks"><span><CalendarDays size={15} /> Agenda organizada</span><span><ShieldCheck size={15} /> Acceso protegido</span></div>
            <span className="login-vertical">SOLO PERSONAL AUTORIZADO</span>
          </div>
          <div className="login-form-side">
            <button className="mobile-back" type="button" onClick={() => setPage('home')}><ArrowLeft size={16} /> Volver al sitio</button>
            <div className="login-access-mark"><LockKeyhole size={15} /><span>ACCESO SEGURO</span><span className="login-access-dot" /></div>
            <span className="eyebrow"><span className="eyebrow-line" /> ÁREA DE ADMINISTRACIÓN</span><h2>Qué bueno verte.</h2><p>Inicia sesión para gestionar las citas de hoy.</p>
            <form className="owner-login-form" onSubmit={signIn}>
              <label className="input-label" htmlFor="owner-email">CORREO</label><div className="input-wrap"><UserRound size={16} /><input id="owner-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="tu@barberia.com" required /></div>
              <label className="input-label" htmlFor="owner-password">CONTRASEÑA</label><div className="input-wrap"><LockKeyhole size={16} /><input id="owner-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••" required /></div>
              {loginError && <p className="form-message error-message" role="alert">{loginError}</p>}
              <button className="button button-primary login-submit" type="submit" disabled={loginLoading}>{loginLoading ? 'Entrando…' : 'Entrar al panel'} <ArrowRight size={17} /></button>
            </form>
            <div className="login-security"><ShieldCheck size={15} /><span>Sesión cifrada · Solo personal autorizado</span></div>
          </div>
        </section> : <section className="dashboard">
          <div className="dashboard-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> PANEL DEL DUEÑO</span><h1>Buen día, <em>maestro.</em></h1><p>{formatDate(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div><div className="dashboard-actions"><span className="connection-badge"><span />Conectado a Supabase</span><button className="logout-button" type="button" onClick={signOut}><LogOut size={15} /> Salir</button></div></div>
          <div className="metric-grid"><article className="metric-card"><span className="metric-icon"><CalendarCheck size={19} /></span><span className="metric-label">CITAS DE HOY</span><strong>{appointmentsLoading ? '—' : todayAppointments.length.toString().padStart(2, '0')}</strong><small>Reservas confirmadas</small></article><article className="metric-card"><span className="metric-icon coral"><Clock3 size={19} /></span><span className="metric-label">PRÓXIMA CITA</span><strong className="metric-time">{todayAppointments[0] ? formatTime(todayAppointments[0].appointment_at) : '—'}</strong><small>{todayAppointments[0]?.customer_name ?? 'Sin citas pendientes'}</small></article><article className="metric-card"><span className="metric-icon green"><CircleDollarSign size={19} /></span><span className="metric-label">INGRESO POTENCIAL</span><strong>{formatMoney(totalToday)}</strong><small>Basado en las citas de hoy</small></article></div>
          <div className="appointments-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> TU AGENDA</span><h2>Las próximas <em>citas.</em></h2></div><div className="filter-wrap"><label htmlFor="status-filter">Mostrar</label><select id="status-filter" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Todas</option><option value="confirmed">Confirmadas</option><option value="completed">Completadas</option><option value="cancelled">Canceladas</option></select></div></div>
          {adminError && <p className="form-message error-message" role="alert">{adminError}</p>}<div className="appointment-list">{appointmentsLoading ? <div className="empty-appointments"><span className="loader" />Cargando agenda…</div> : filteredAppointments.length === 0 ? <div className="empty-appointments"><CalendarDays size={25} /><strong>Todo tranquilo por aquí.</strong><span>No hay citas en esta categoría.</span></div> : filteredAppointments.map((appointment) => <article className={`appointment-row status-${appointment.status}`} key={appointment.id}><div className="appointment-date"><strong>{formatTime(appointment.appointment_at)}</strong><span>{formatDate(dateKey(new Date(appointment.appointment_at)), { weekday: 'short', day: 'numeric', month: 'short' })}</span></div><div className="appointment-person"><span className="person-avatar">{appointment.customer_name.split(' ').map((part) => part[0]).slice(0, 2).join('')}</span><div><strong>{appointment.customer_name}</strong><span><Phone size={12} /> {appointment.phone}</span></div></div><div className="appointment-service"><strong>{appointment.service_name}</strong><span>{appointment.duration_minutes} min · {appointment.barber_name}</span></div><strong className="appointment-price">{formatMoney(appointment.price_cents)}</strong><span className={`status-pill ${appointment.status}`}>{appointment.status === 'confirmed' ? 'Confirmada' : appointment.status === 'completed' ? 'Completada' : 'Cancelada'}</span><div className="appointment-actions">{appointment.status === 'confirmed' && <><button type="button" className="icon-action complete-action" title="Marcar como completada" aria-label="Marcar cita como completada" onClick={() => updateStatus(appointment.id, 'completed')}><Check size={16} /></button><button type="button" className="icon-action cancel-action" title="Cancelar cita" aria-label="Cancelar cita" onClick={() => updateStatus(appointment.id, 'cancelled')}><XCircle size={16} /></button></>}{appointment.status === 'cancelled' && <button type="button" className="icon-action complete-action" title="Restaurar cita" aria-label="Restaurar cita" onClick={() => updateStatus(appointment.id, 'confirmed')}><ArrowRight size={16} /></button>}</div></article>)}</div>
          <div className="dashboard-footer"><span><ShieldCheck size={14} /> Los datos de tus clientes solo son visibles para ti.</span><button type="button" onClick={() => setPage('home')}><ArrowLeft size={14} /> Ver página pública</button></div>
        </section>}
      </main>}
    </div>
  )
}

export default App
