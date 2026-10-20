import { Hono } from 'hono'
import Stripe from 'stripe'
import { sql } from '../db'
import { env, billingEnabled } from '../env'
import { requireUser, type AppEnv } from '../auth'

let client: Stripe | null = null
const stripe = () => (client ??= new Stripe(env.stripeSecretKey))

async function customerFor(user: { id: string; email: string; name: string }): Promise<string> {
  const [row] = await sql<{ stripe_customer_id: string | null }[]>`select stripe_customer_id from subscriptions where user_id = ${user.id}`
  if (row?.stripe_customer_id) return row.stripe_customer_id
  const customer = await stripe().customers.create({ email: user.email, name: user.name || undefined, metadata: { user_id: user.id } })
  await sql`
    insert into subscriptions (user_id, stripe_customer_id) values (${user.id}, ${customer.id})
    on conflict (user_id) do update set stripe_customer_id = excluded.stripe_customer_id`
  return customer.id
}

async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  // current_period_end lives on subscription items in recent Stripe API versions.
  const periodEnd = sub.items.data[0]?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end
  const status = sub.status === 'incomplete_expired' || sub.status === 'unpaid' || sub.status === 'paused' ? 'canceled' : sub.status
  await sql`
    update subscriptions set stripe_subscription_id = ${sub.id}, status = ${status},
      current_period_end = ${periodEnd ? new Date(periodEnd * 1000) : null}, updated_at = now()
    where stripe_customer_id = ${customerId}`
}

export const billingRoutes = new Hono<AppEnv>()
  .post('/checkout', requireUser, async (c) => {
    if (!billingEnabled()) return c.json({ error: 'La facturación no está configurada en este servidor' }, 400)
    const user = c.get('user')
    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      customer: await customerFor(user),
      line_items: [{ price: env.stripePriceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
      client_reference_id: user.id,
      success_url: `${env.appUrl}/app/billing?status=success`,
      cancel_url: `${env.appUrl}/app/billing?status=cancel`
    })
    return c.json({ url: session.url })
  })
  .post('/portal', requireUser, async (c) => {
    if (!billingEnabled()) return c.json({ error: 'La facturación no está configurada en este servidor' }, 400)
    const session = await stripe().billingPortal.sessions.create({
      customer: await customerFor(c.get('user')),
      return_url: `${env.appUrl}/app/billing`
    })
    return c.json({ url: session.url })
  })
  .post('/webhook', async (c) => {
    if (!billingEnabled() || !env.stripeWebhookSecret) return c.text('billing disabled', 400)
    const raw = await c.req.text()
    let event: Stripe.Event
    try {
      event = await stripe().webhooks.constructEventAsync(raw, c.req.header('stripe-signature') ?? '', env.stripeWebhookSecret)
    } catch {
      return c.text('invalid signature', 400)
    }
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await syncSubscription(event.data.object)
        break
      case 'checkout.session.completed': {
        const s = event.data.object
        if (s.subscription) {
          const id = typeof s.subscription === 'string' ? s.subscription : s.subscription.id
          await syncSubscription(await stripe().subscriptions.retrieve(id))
        }
        break
      }
    }
    return c.json({ received: true })
  })
