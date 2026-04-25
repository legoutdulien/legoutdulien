// /.netlify/functions/admin-key
// Verifie le mot de passe admin et renvoie les credentials Supabase service_role.
// Variables d'environnement requises (Netlify -> Site settings -> Environment variables):
//   ADMIN_PASSWORD            = mot de passe admin
//   SUPABASE_URL              = URL du projet Supabase
//   SUPABASE_SERVICE_KEY      = service_role key du projet Supabase

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    // Diagnostic: liste les noms d'env vars visibles (sans valeurs) pour debug
    const visible = Object.keys(process.env).filter(k =>
      k.startsWith('ADMIN') || k.startsWith('SUPABASE') || k.startsWith('ANTHROPIC') || k.startsWith('CLAUDE')
    ).sort();
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'ADMIN_PASSWORD non configure',
        debug_env_keys_visibles: visible,
        debug_total_env: Object.keys(process.env).length
      })
    };
  }
  if (!body.password || body.password !== expected) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Mot de passe incorrect' }) };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Configuration Supabase incomplete' }) };
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, key })
  };
};
