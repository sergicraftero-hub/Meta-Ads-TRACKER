import { Link } from 'react-router-dom'
import { BarChart3, Bot, Building2, Check, Crosshair, Lightbulb, Radio, ShieldCheck } from 'lucide-react'
import { Logo } from '@/components/Layout'
import { useStore } from '@/lib/store'

export const FEATURES = [
  { icon: Building2, title: 'Todas tus cuentas en un panel', text: 'Conecta tu Business Manager y ve cada cuenta publicitaria, campaña, conjunto y anuncio con sus métricas.' },
  { icon: Radio, title: 'Tracking server-side + Conversions API', text: 'Script de primera parte y envío por servidor a Meta con deduplicación. Recupera las conversiones que el píxel pierde.' },
  { icon: Crosshair, title: 'Atribución real', text: 'Compara lo que dice Meta con las ventas y leads que registra tu web, por campaña, conjunto y anuncio.' },
  { icon: BarChart3, title: 'Modo lead gen y e-commerce', text: 'CPL, tasa de lead y calidad del embudo, o ROAS, CPA, ticket medio y abandono de carrito. Cambia con un clic.' },
  { icon: Lightbulb, title: 'Recomendaciones automáticas', text: 'Detecta anuncios que queman dinero, fatiga creativa, presupuesto mal repartido y ganadores para escalar.' },
  { icon: Bot, title: 'Analista IA', text: 'Un media buyer senior revisa la cuenta, prioriza acciones y te escribe 5 anuncios nuevos listos para lanzar.' },
  { icon: ShieldCheck, title: 'Shopify y cualquier web', text: 'Webhook de pedidos de Shopify con firma verificada, o eventos desde cualquier web con una línea de código.' }
]

export default function Landing() {
  const { me } = useStore()
  return (
    <div className="landing">
      <nav>
        <span className="brand" style={{ padding: 0 }}>
          <Logo /> AdPilot
        </span>
        <span className="spacer" />
        <a href="#precio" className="btn ghost">
          Precio
        </a>
        {me ? (
          <Link className="btn primary" to="/app">
            Ir al panel
          </Link>
        ) : (
          <>
            <Link className="btn ghost" to="/login">
              Entrar
            </Link>
            <Link className="btn primary" to="/register">
              Prueba gratis
            </Link>
          </>
        )}
      </nav>

      <header className="hero">
        <span className="badge accent">Para media buyers, agencias y e-commerce</span>
        <h1>
          Deja de adivinar qué anuncios <em>te hacen ganar dinero</em>
        </h1>
        <p>Todas tus cuentas de Meta Ads, tracking server-side con la Conversions API, atribución real y recomendaciones con IA. Para lead generation y e-commerce.</p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <Link className="btn primary lg" to="/register">
            Empieza gratis 14 días
          </Link>
          <a className="btn lg" href="#funciones">
            Ver funciones
          </a>
        </div>
        <span className="faint" style={{ fontSize: 13 }}>
          Sin tarjeta · Datos de ejemplo desde el primer minuto
        </span>
      </header>

      <section className="block" id="funciones">
        <h2>Todo lo que necesitas para escalar en Meta</h2>
        <div className="grid g3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card feature">
              <span className="ic">
                <f.icon size={20} />
              </span>
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </div>
          ))}
          <div className="card feature" style={{ background: 'var(--accent-soft)' }}>
            <h3>¿Cómo funciona?</h3>
            <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Conecta Meta en un clic</li>
              <li>Pega una línea de código en tu web</li>
              <li>Mira la atribución real y aplica las recomendaciones</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="block" id="precio">
        <h2>Un plan. Todo incluido.</h2>
        <div className="card price-card">
          <h3>AdPilot Pro</h3>
          <div>
            <span className="price">100 €</span>
            <span className="muted"> /mes</span>
          </div>
          <div className="col" style={{ gap: 8 }}>
            {['Cuentas publicitarias ilimitadas', 'Hasta 10 webs o tiendas con tracking', 'Conversions API y webhook de Shopify', 'Atribución por campaña, conjunto y anuncio', 'Recomendaciones automáticas', 'Analista IA (40 análisis al día)', 'Exportación a CSV / Excel'].map((t) => (
              <div key={t} className="check">
                <Check size={16} />
                {t}
              </div>
            ))}
          </div>
          <Link className="btn primary lg" to="/register">
            Probar 14 días gratis
          </Link>
          <span className="faint" style={{ fontSize: 12, textAlign: 'center' }}>
            Cancela cuando quieras.
          </span>
        </div>
      </section>
      <footer className="faint" style={{ textAlign: 'center', marginTop: 64, fontSize: 13 }}>
        © {new Date().getFullYear()} AdPilot. Meta, Facebook e Instagram son marcas de Meta Platforms, Inc. AdPilot no está afiliado a Meta.
      </footer>
    </div>
  )
}
