# AdPilot

SaaS de analítica, tracking server-side y atribución para **Meta Ads**, pensado para **lead generation** y **e-commerce**. Suscripción de **100 €/mes** con Stripe.

## Qué incluye

| Módulo | Qué hace |
|---|---|
| **Resumen** | KPIs con comparación frente al periodo anterior, gráficos diarios (inversión, leads/ingresos, CPL/ROAS), embudo y mejores anuncios |
| **Campañas** | Tabla campaña → conjunto → anuncio, ordenable, con búsqueda, filtros y exportación a CSV |
| **Creatividades** | Galería de anuncios con etiquetas automáticas (ganador, fatiga, caro, CTR bajo) y gráfico diario por anuncio |
| **Recomendaciones** | Reglas de media buyer: anuncios que queman presupuesto, fatiga creativa, embudo roto, fase de aprendizaje, reparto de presupuesto, ganadores para escalar |
| **Analista IA** | Claude analiza la cuenta y devuelve un diagnóstico, un plan priorizado y 5 anuncios nuevos listos para pegar |
| **Todas las cuentas** | Vista de agencia con todas las cuentas publicitarias del Business Manager |
| **Píxel y CAPI** | Script de primera parte (`/t.js`), envío server-side a la Conversions API con deduplicación por `event_id`, webhook de pedidos de Shopify, feed de eventos en directo |
| **Atribución** | Conversiones según Meta frente a las registradas en tu web, por campaña, conjunto y anuncio (último o primer clic, ventana de 28 días) |
| **Modo demo** | Datos de ejemplo realistas, así cualquiera puede probar la app sin conectar Meta |

Stack: Node 22 + Hono + PostgreSQL (API) · React + Vite + Recharts (web) · Stripe · Claude API.

## Puesta en marcha en local

```bash
cp .env.example .env            # rellena lo que tengas; todo es opcional en local
docker compose up -d db         # o tu propio PostgreSQL
npm install
npm run dev                     # API en :8787, web en http://localhost:5173
```

Sin claves, la app funciona en modo demo, sin cobro y sin IA.

## Configuración para producción

1. **Meta** — En [developers.facebook.com](https://developers.facebook.com) crea una app de tipo *Empresa* y añade *Inicio de sesión con Facebook para empresas* y la *API de marketing*. Como URI de redirección OAuth válida pon `https://TU-DOMINIO/api/meta/oauth/callback`. Copia el ID y la clave secreta en `META_APP_ID` y `META_APP_SECRET`. Para que clientes externos puedan conectar sus cuentas necesitas la **revisión de la app** con los permisos `ads_read`, `business_management` y `read_insights` (verificación del negocio incluida). Mientras tanto funciona con los usuarios que tengan un rol en la app, o con tokens de usuario del sistema.
2. **Stripe** — Crea un producto «AdPilot Pro» con un precio recurrente de 100 €/mes y pon su ID en `STRIPE_PRICE_ID`. Crea un webhook a `https://TU-DOMINIO/api/billing/webhook` con los eventos `checkout.session.completed` y `customer.subscription.*`, y guarda su secreto en `STRIPE_WEBHOOK_SECRET`. Activa el portal de cliente y Stripe Tax si facturas IVA.
3. **IA** — `ANTHROPIC_API_KEY` activa el analista IA (40 análisis al día por usuario).
4. **Seguridad** — Genera la clave de cifrado de los tokens con `ENCRYPTION_KEY=$(openssl rand -hex 32)`. No la cambies después: los tokens guardados dejarían de descifrarse.

### Despliegue

- **Render**: *New → Blueprint* con este repo (usa `render.yaml`, que crea la base de datos y la app).
- **Cualquier servidor con Docker**: `docker build -t adpilot . && docker run -p 8787:8787 --env-file .env adpilot`.

Las migraciones de la base de datos se aplican solas al arrancar.

## Cómo instala el tracking un cliente

1. En *Píxel y CAPI* crea la web y pega `<script async src="https://TU-DOMINIO/t.js?k=CLAVE"></script>` en el `<head>`.
2. Añade el ID del píxel y el token de la Conversions API.
3. En cada anuncio, en *Parámetros de URL*:
   `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`
4. Si usa Shopify: webhook de *Creación de pedido* a `https://TU-DOMINIO/api/webhooks/shopify/CLAVE` y su clave de firma.
5. Leads: los formularios con `data-adpilot-lead` se registran solos; o `adpilot.track('Lead', { email, phone })`.

El email y el teléfono se normalizan y se cifran con SHA-256 en el servidor antes de guardarse o enviarse a Meta. Nunca se almacenan en claro.

## Scripts

```bash
npm run dev        # desarrollo
npm run typecheck  # TypeScript
npm test           # tests (métricas, reglas, atribución, hashing CAPI)
npm run build      # build de producción → dist/
npm start          # servidor de producción
```
