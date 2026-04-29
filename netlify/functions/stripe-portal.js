// /.netlify/functions/stripe-portal
// Genere une Customer Portal Session pour qu'une cuisiniere gere son abonnement
// (mettre a jour CB, voir factures, annuler).
// Body : { access_token } -- token Supabase de l'admin connectee
// Variables d'environnement :
//   STRIPE_SECRET_KEY            = sk_...
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   PUBLIC_BASE_URL              = https://mybatch.cooking

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;
  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://mybatch.cooking';
  if (!stripeKey || !sbUrl || !sbKey) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Configuration manquante' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) }; }
  const token = body.access_token;
  if (!token) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'access_token requis' }) };

  // Verifie que le token est valide et recupere le user
  const userRes = await fetch(`${sbUrl}/auth/v1/user`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${token}` }
  });
  if (!userRes.ok) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Session invalide' }) };
  const user = await userRes.json();

  // Trouve son entreprise et son stripe_customer_id
  const linkRes = await fetch(`${sbUrl}/rest/v1/admins_entreprise?user_id=eq.${user.id}&select=entreprise_id,entreprises(stripe_customer_id,nom_marque,plan)`, {
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
  });
  const links = await linkRes.json();
  if (!Array.isArray(links) || !links[0]) {
    return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Aucune entreprise associee' }) };
  }
  const ent = links[0].entreprises || {};
  if (ent.plan === 'founder') {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Le plan Founder n a pas d abonnement Stripe' }) };
  }
  if (!ent.stripe_customer_id) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Aucun client Stripe associe — saisis ta CB depuis le lien de paiement initial.' }) };
  }

  const params = new URLSearchParams();
  params.append('customer', ent.stripe_customer_id);
  params.append('return_url', `${baseUrl}/admin.html`);

  try {
    const r = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    const session = await r.json();
    if (!r.ok) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: session.error?.message || 'Stripe error' }) };
    }
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url })
    };
  } catch (e) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Stripe API echec : ' + e.message }) };
  }
};
