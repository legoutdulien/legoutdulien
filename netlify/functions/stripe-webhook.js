// /.netlify/functions/stripe-webhook
// Recoit les events Stripe et met a jour entreprises.subscription_status, stripe_*, current_period_end, trial_ends_at.
// Variables d'environnement requises :
//   STRIPE_SECRET_KEY            = sk_test_... ou sk_live_...
//   STRIPE_WEBHOOK_SECRET        = whsec_... (cree dans Stripe Dashboard > Developpeurs > Webhooks)
//   SUPABASE_URL                 = ...
//   SUPABASE_SERVICE_KEY         = service_role

const crypto = require('crypto');

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = sigHeader.split(',').reduce((acc, p) => {
    const [k, v] = p.split('=');
    acc[k] = v;
    return acc;
  }, {});
  if (!parts.t || !parts.v1) return false;
  const signed = `${parts.t}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch (_) {
    return false;
  }
}

async function updateEntreprise(sbUrl, sbKey, entrepriseId, fields) {
  const r = await fetch(`${sbUrl}/rest/v1/entreprises?id=eq.${encodeURIComponent(entrepriseId)}`, {
    method: 'PATCH',
    headers: {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(fields)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Supabase update failed (${r.status}): ${t}`);
  }
}

async function fetchSubscription(stripeKey, subId) {
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` }
  });
  return r.ok ? r.json() : null;
}

async function findEntrepriseBySubscription(sbUrl, sbKey, subId) {
  const r = await fetch(`${sbUrl}/rest/v1/entreprises?stripe_subscription_id=eq.${encodeURIComponent(subId)}&select=id`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
  });
  const d = await r.json();
  return Array.isArray(d) && d[0] ? d[0].id : null;
}

exports.handler = async (event) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;
  if (!stripeKey || !whSecret || !sbUrl || !sbKey) {
    return { statusCode: 500, body: 'Configuration manquante' };
  }

  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const payload = event.body || '';

  if (!verifyStripeSignature(payload, sig, whSecret)) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let evt;
  try { evt = JSON.parse(payload); }
  catch { return { statusCode: 400, body: 'Invalid JSON' }; }

  try {
    switch (evt.type) {
      case 'checkout.session.completed': {
        const session = evt.data.object;
        const entrepriseId = session.client_reference_id || session.metadata?.entreprise_id;
        if (!entrepriseId || !session.subscription) break;
        const sub = await fetchSubscription(stripeKey, session.subscription);
        if (!sub) break;
        await updateEntreprise(sbUrl, sbKey, entrepriseId, {
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
          subscription_status: sub.status,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          active: sub.status === 'active' || sub.status === 'trialing'
        });
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = evt.data.object;
        const entrepriseId = sub.metadata?.entreprise_id || (await findEntrepriseBySubscription(sbUrl, sbKey, sub.id));
        if (!entrepriseId) break;
        await updateEntreprise(sbUrl, sbKey, entrepriseId, {
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
          active: sub.status === 'active' || sub.status === 'trialing'
        });
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = evt.data.object;
        const entrepriseId = sub.metadata?.entreprise_id || (await findEntrepriseBySubscription(sbUrl, sbKey, sub.id));
        if (!entrepriseId) break;
        await updateEntreprise(sbUrl, sbKey, entrepriseId, {
          subscription_status: 'canceled',
          active: false
        });
        break;
      }
      case 'invoice.payment_failed': {
        const inv = evt.data.object;
        if (!inv.subscription) break;
        const entrepriseId = await findEntrepriseBySubscription(sbUrl, sbKey, inv.subscription);
        if (!entrepriseId) break;
        await updateEntreprise(sbUrl, sbKey, entrepriseId, {
          subscription_status: 'past_due'
        });
        break;
      }
      default:
        // Ignored event
        break;
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (e) {
    return { statusCode: 500, body: 'Handler error : ' + e.message };
  }
};
