// salarie.js — Espace salarie
// Le Gout du Lien
// Backend: Supabase (auth + Postgres + Storage)

const SUPABASE_URL = 'https://loiaubdlhkcnohtbwtxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvaWF1YmRsaGtjbm9odGJ3dHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMzU1NDAsImV4cCI6MjA5MjcxMTU0MH0.2S2xnnpFT-kcblTzSC_x2ybSUUipUi5jMPe_DbNBUcA';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let salarieProfile = null;
let recettes = [];
let ingredients = [];
let recettesIngredients = [];
let allCommandesAssignees = [];
let curView = 'liste';

// --- helpers UI ---
const $ = (id) => document.getElementById(id);
const showLoad = () => $('lov').style.display = 'flex';
const hideLoad = () => $('lov').style.display = 'none';
const showErr = (msg) => { const e = $('lerr'); e.textContent = msg; e.style.display = 'block'; };
const hideErr = () => { $('lerr').style.display = 'none'; };

// --- helpers semaines ---
function getLundis() {
  const res = [];
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const dow = new Date(y, m, d).getDay();
  const nextMon = dow === 1 ? 0 : (8 - dow) % 7;
  for (let i = -2; i < 6; i++) {
    const l = new Date(y, m, d + nextMon + i * 7);
    const yy = l.getFullYear();
    const mm = String(l.getMonth() + 1).padStart(2, '0');
    const dd = String(l.getDate()).padStart(2, '0');
    res.push({ id: `${yy}-${mm}-${dd}`, label: l.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) });
  }
  return res;
}

// --- login / logout ---
async function login() {
  hideErr();
  const email = $('iEmail').value.trim();
  const mdp = $('iMdp').value.trim();
  if (!email || !mdp) return showErr('Remplissez tous les champs.');
  showLoad();
  try {
    const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password: mdp });
    if (authErr) throw new Error('Email ou mot de passe incorrect.');
    const { data: profile, error: pErr } = await sb.from('salaries').select('*').eq('id', auth.user.id).single();
    if (pErr || !profile) {
      await sb.auth.signOut();
      throw new Error("Ce compte n'est pas un compte salarie.");
    }
    salarieProfile = profile;
    await initSalarie();
  } catch (e) {
    showErr(e.message || String(e));
  } finally {
    hideLoad();
  }
}

async function logout() {
  await sb.auth.signOut();
  location.reload();
}

// --- init dashboard ---
async function initSalarie() {
  const prenom = (salarieProfile.nom || '').split(' ')[0];
  $('welcomeTxt').textContent = `Bonjour ${prenom}`;
  const dateEl = $('welcomeDate');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  const sel = $('semSelect');
  sel.innerHTML = '';
  const lundis = getLundis();
  lundis.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = 'Semaine du ' + s.label;
    if (i === 2) opt.selected = true;
    sel.appendChild(opt);
  });

  $('pLogin').style.display = 'none';
  $('pSalarie').style.display = 'block';

  showLoad();
  try {
    const [recRes, riRes, ingRes, cmdRes] = await Promise.all([
      sb.from('recettes').select('id, nom_du_plat, instructions_preparation, photo_url'),
      sb.from('recettes_ingredients').select('id, recette_id, ingredient_id, quantite_par_portion, ordre').order('ordre', { ascending: true }),
      sb.from('ingredients').select('id, nom, unite_par_defaut, rayon'),
      sb.from('commandes')
        .select(`
          id, semaine_du, creneau, statut,
          plat_1_id, plat_2_id, plat_3_id, plat_4_id, plat_5_id,
          nombre_portions, assigne_a_id,
          client:clients(id, nom, email, telephone, adresse, notes)
        `)
        .eq('assigne_a_id', salarieProfile.id)
        .order('semaine_du', { ascending: false })
    ]);
    if (recRes.error) throw recRes.error;
    if (riRes.error) throw riRes.error;
    if (ingRes.error) throw ingRes.error;
    if (cmdRes.error) throw cmdRes.error;

    recettes = recRes.data || [];
    recettesIngredients = riRes.data || [];
    ingredients = ingRes.data || [];
    allCommandesAssignees = cmdRes.data || [];

    initCalSelects();
    chargerMissions();
  } catch (e) {
    $('missionsDiv').innerHTML = `<p style="color:red;padding:20px">Erreur: ${e.message}</p>`;
  } finally {
    hideLoad();
  }
}

// --- rendu missions ---
function getRecette(id) {
  return recettes.find(r => r.id === id) || null;
}
function getIngredient(id) {
  return ingredients.find(i => i.id === id) || null;
}
function getIngredientsForRecette(recetteId) {
  return recettesIngredients
    .filter(ri => ri.recette_id === recetteId)
    .sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
}

function chargerMissions() {
  const semId = $('semSelect').value;
  const mesMissions = allCommandesAssignees.filter(c => (c.semaine_du || '').startsWith(semId));
  const confirmees = mesMissions.filter(c => c.statut === 'Confirmée').length;
  const totalPortions = mesMissions.reduce((a, c) => a + (c.nombre_portions || 4) * 5, 0);

  $('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-num">${mesMissions.length}</div><div class="stat-lbl">Mission${mesMissions.length > 1 ? 's' : ''}</div></div>
    <div class="stat-card"><div class="stat-num">${mesMissions.length * 5}</div><div class="stat-lbl">Plats a preparer</div></div>
    <div class="stat-card"><div class="stat-num">${confirmees}</div><div class="stat-lbl">Confirmee${confirmees > 1 ? 's' : ''}</div></div>
    <div class="stat-card"><div class="stat-num">${totalPortions}</div><div class="stat-lbl">Portions totales</div></div>`;

  if (mesMissions.length === 0) {
    $('missionsDiv').innerHTML = `<div class="empty"><div class="empty-icon">🗓️</div><p>Aucune mission assignee pour cette semaine.</p></div>`;
    return;
  }

  $('missionsDiv').innerHTML = mesMissions.map(cmd => {
    const platIds = [cmd.plat_1_id, cmd.plat_2_id, cmd.plat_3_id, cmd.plat_4_id, cmd.plat_5_id].filter(Boolean);
    const plats = platIds.map(getRecette).filter(Boolean);
    const cl = cmd.client || {};
    const crenParts = (cmd.creneau || '').split('·');
    const crenJour = (crenParts[0] || '').trim();
    const crenHeure = (crenParts[1] || '').trim();
    const portions = cmd.nombre_portions || 4;
    const ok = cmd.statut === 'Confirmée';

    return `<div class="mission-card">
      <div class="mission-header">
        <div>
          <div class="mission-date">${escapeHtml(crenJour)}</div>
          <div class="mission-creneau">🕐 ${escapeHtml(crenHeure)}</div>
        </div>
        <span style="background:${ok ? '#e8f5e9' : '#fff8e1'};color:${ok ? '#2e7d32' : '#f57f17'};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:500">${ok ? '✓ Confirmee' : '⏳ En attente'}</span>
      </div>
      <div class="client-info">
        <div class="client-nom">👤 ${escapeHtml(cl.nom || '–')}</div>
        ${cl.telephone ? `<div class="client-detail">📞 <a href="tel:${encodeURIComponent(cl.telephone)}" style="color:var(--vert)">${escapeHtml(cl.telephone)}</a></div>` : ''}
        ${cl.adresse ? `<div class="client-detail">📍 <a href="https://maps.google.com?q=${encodeURIComponent(cl.adresse)}" target="_blank" rel="noopener" style="color:var(--vert)">${escapeHtml(cl.adresse)}</a></div>` : ''}
      </div>
      <div class="plats-section">
        <div style="font-size:12px;color:var(--txl);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${plats.length} plat${plats.length > 1 ? 's' : ''} a preparer (${portions} portions chacun · cliquer pour voir les ingredients)</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${plats.map(rec => `<button class="sal-plat-chip" data-id="${rec.id}" data-portions="${portions}" style="padding:9px 14px;background:var(--vp);border:1px solid var(--bgd);border-radius:18px;font-size:13px;color:var(--vert);cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500;transition:transform .15s ease,background .15s ease;text-align:left">🍽️ ${escapeHtml(rec.nom_du_plat)}</button>`).join('')}
        </div>
      </div>
    </div>`;
  }).join('');

  $('missionsDiv').querySelectorAll('.sal-plat-chip').forEach(b => {
    b.addEventListener('click', () => voirPlatDetailModal(b.dataset.id, parseInt(b.dataset.portions, 10) || 4));
  });
}

function voirPlatDetailModal(recetteId, portions) {
  const rec = getRecette(recetteId); if (!rec) return;
  const ings = getIngredientsForRecette(recetteId);
  const prep = rec.instructions_preparation || '';
  let mbg = document.getElementById('salPlatMbg');
  if (!mbg) {
    mbg = document.createElement('div');
    mbg.id = 'salPlatMbg';
    mbg.className = 'mbg';
    mbg.innerHTML = '<div class="mbox" id="salPlatMbox" style="padding:0;overflow:hidden"></div>';
    document.body.appendChild(mbg);
    mbg.addEventListener('click', (e) => { if (e.target === mbg) mbg.classList.remove('show'); });
  }
  document.getElementById('salPlatMbox').innerHTML = `
    ${rec.photo_url ? `<img src="${escapeAttr(rec.photo_url)}" alt="${escapeAttr(rec.nom_du_plat)}" style="width:100%;height:180px;object-fit:cover;display:block">` : '<div style="height:80px;background:linear-gradient(135deg,var(--bgd),var(--vp))"></div>'}
    <div style="padding:22px">
      <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:600;margin-bottom:6px;color:var(--vert)">${escapeHtml(rec.nom_du_plat)}</div>
      <div style="font-size:12px;color:var(--txl);margin-bottom:14px">Pour ${portions} portions</div>
      ${prep ? `<div style="background:#fff8e7;border-left:3px solid #f9c74f;border-radius:8px;padding:12px 14px;margin-bottom:14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#8a7a3a;font-weight:600;margin-bottom:6px">👩‍🍳 Preparation</div>
        <div style="font-size:13px;line-height:1.6;white-space:pre-line">${escapeHtml(prep)}</div>
      </div>` : ''}
      ${ings.length ? `<div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--txl);margin-bottom:8px;font-weight:600">🥕 Ingredients (pour ${portions} portions)</div>
      <div style="display:flex;flex-direction:column;gap:0;margin-bottom:14px">
        ${ings.map(ri => {
          const ing = getIngredient(ri.ingredient_id); if (!ing) return '';
          const qte = (ri.quantite_par_portion || 0) * portions;
          const u = ing.unite_par_defaut && ing.unite_par_defaut !== 'Unité par défaut' ? ing.unite_par_defaut : '';
          return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--bgd);font-size:13px"><span>${escapeHtml(ing.nom)}${ing.rayon ? ` <span style="font-size:10px;color:var(--txl)">(${escapeHtml(ing.rayon)})</span>` : ''}</span><span style="color:var(--vert);font-weight:600">${qte > 0 ? (Number.isInteger(qte) ? qte : qte.toFixed(2)) + (u ? ' ' + u : '') : '–'}</span></div>`;
        }).join('')}
      </div>` : '<p style="color:var(--txl);font-size:13px;margin-bottom:14px">Pas d\'ingredients renseignes</p>'}
      ${rec.instructions_rechauffage ? `<div style="background:var(--vp);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:12px"><strong style="color:var(--vert)">🔥 Rechauffage :</strong> ${escapeHtml(rec.instructions_rechauffage)}</div>` : ''}
      ${rec.frigo_en_jours ? `<div style="font-size:12px;color:var(--txl);margin-bottom:14px">❄️ Conservation : ${rec.frigo_en_jours} jours au refrigerateur</div>` : ''}
      <button class="mclose" id="salPlatClose">Fermer</button>
    </div>`;
  mbg.classList.add('show');
  document.getElementById('salPlatClose').addEventListener('click', () => mbg.classList.remove('show'));
}

function renderPlat(recette, mIdx, pIdx, portions) {
  const ings = getIngredientsForRecette(recette.id);
  const img = recette.photo_url || '';
  const prep = recette.instructions_preparation || '';
  return `<div class="plat-item">
    ${img ? `<img src="${escapeAttr(img)}" style="width:100%;height:90px;object-fit:cover;border-radius:8px 8px 0 0;display:block" onerror="this.style.display='none'">` : ''}
    <div class="plat-header" data-target="ing-${mIdx}-${pIdx}">
      <span>🍽️ ${escapeHtml(recette.nom_du_plat)}</span>
      <span class="plat-arrow" id="arr-${mIdx}-${pIdx}">▼</span>
    </div>
    <div class="plat-ings" id="ing-${mIdx}-${pIdx}">
      ${prep ? `<div style="background:#fff8e7;border-left:3px solid #f9c74f;border-radius:8px;padding:10px 12px;margin-bottom:10px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b6b6b;margin-bottom:4px">👩‍🍳 Preparation</div><div style="font-size:12px;line-height:1.6">${escapeHtml(prep)}</div></div>` : ''}
      ${ings.map(ri => {
        const ing = getIngredient(ri.ingredient_id);
        if (!ing) return '';
        const qte = (ri.quantite_par_portion || 0) * portions;
        const u = ing.unite_par_defaut || '';
        const uFinal = u && u !== 'Unité par défaut' ? u : '';
        const rayon = ing.rayon || '';
        return `<div class="ing-line">
          <span>${escapeHtml(ing.nom)}${rayon ? ` <span style="font-size:10px;color:var(--txl)">(${escapeHtml(rayon)})</span>` : ''}</span>
          <span class="ing-qte">${qte > 0 ? (Number.isInteger(qte) ? qte : qte.toFixed(2)) + (uFinal ? ' ' + uFinal : '') : '–'}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function toggleIng(targetId) {
  const div = document.getElementById(targetId);
  if (!div) return;
  const arrId = targetId.replace('ing-', 'arr-');
  const arr = document.getElementById(arrId);
  const open = div.classList.toggle('open');
  if (arr) arr.textContent = open ? '▲' : '▼';
}

// --- views switcher ---
function setView(v) {
  curView = v;
  const btns = { liste: $('btnListe'), semaine: $('btnSem'), mois: $('btnMois') };
  Object.entries(btns).forEach(([k, btn]) => {
    if (!btn) return;
    btn.style.background = k === v ? 'var(--vert)' : 'var(--bgd)';
    btn.style.color = k === v ? '#fff' : 'var(--tx)';
  });
  $('missionsDiv').style.display = v === 'liste' ? 'block' : 'none';
  $('listeTitre').style.display = v === 'liste' ? 'block' : 'none';
  $('calContainer').style.display = v !== 'liste' ? 'block' : 'none';
  $('calSemDiv').style.display = v === 'semaine' ? 'block' : 'none';
  $('calMoisDiv').style.display = v === 'mois' ? 'block' : 'none';
  if (v === 'semaine') renderCalSem();
  if (v === 'mois') renderCalMois();
}

function initCalSelects() {
  const selS = $('calSemSelect');
  if (selS && !selS.options.length) {
    const lundis = getLundis();
    lundis.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = 'Semaine du ' + s.label;
      if (i === 2) opt.selected = true;
      selS.appendChild(opt);
    });
  }
  const selM = $('calMoisSelect');
  if (selM && !selM.options.length) {
    const now = new Date();
    for (let i = -2; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const opt = document.createElement('option');
      opt.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      opt.textContent = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      if (i === 2) opt.selected = true;
      selM.appendChild(opt);
    }
  }
}

function renderCalSem() {
  initCalSelects();
  const semId = $('calSemSelect').value;
  const [y, m, d] = semId.split('-').map(Number);
  const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const JMAP = { Lundi: 0, Mardi: 1, Mercredi: 2, Jeudi: 3, Vendredi: 4 };
  const HEURES = ['9h00 - 12h00', '13h00 - 16h00'];
  const cmdSem = allCommandesAssignees.filter(c => (c.semaine_du || '').startsWith(semId));

  $('calContainer').innerHTML = `<div class="cal-semaine">${JOURS.map(j => {
    const jd = new Date(y, m - 1, d + JMAP[j]);
    const jl = jd.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<div class="cal-jour">
      <div class="cal-jour-header">${j}<span>${jd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span></div>
      ${HEURES.map(h => {
        const lbl = `${jl} · ${h}`;
        const cmd = cmdSem.find(c => (c.creneau || '').trim() === lbl.trim());
        if (cmd) {
          const cName = cmd.client ? cmd.client.nom : '?';
          return `<div class="cal-slot moi">
            <div class="cal-slot-heure">${h}</div>
            <div style="font-size:11px;font-weight:500">${escapeHtml(cName)}</div>
          </div>`;
        }
        return `<div class="cal-slot vide">${h}<br>–</div>`;
      }).join('')}
    </div>`;
  }).join('')}</div>`;
}

function renderCalMois() {
  initCalSelects();
  const val = $('calMoisSelect').value;
  const [y, m] = val.split('-').map(Number);
  const premier = new Date(y, m - 1, 1);
  const dernier = new Date(y, m, 0);
  const today = new Date();
  let dow = premier.getDay(); if (dow === 0) dow = 7;
  const jours = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  let html = `<div class="cal-mois">`;
  jours.forEach(j => { html += `<div class="cmh">${j}</div>`; });
  for (let i = 1; i < dow; i++) html += `<div class="cmd autre"></div>`;
  for (let dd = 1; dd <= dernier.getDate(); dd++) {
    const isToday = today.getFullYear() === y && today.getMonth() === m - 1 && today.getDate() === dd;
    const cmdsJour = allCommandesAssignees.filter(c => {
      const cren = c.creneau || '';
      const semaine = c.semaine_du || '';
      if (!semaine) return false;
      const [sy, sm, sd] = semaine.split('-').map(Number);
      for (let i = 0; i < 5; i++) {
        const jd = new Date(sy, sm - 1, sd + i);
        if (jd.getFullYear() === y && jd.getMonth() === m - 1 && jd.getDate() === dd) {
          const jl = jd.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
          return cren.startsWith(jl);
        }
      }
      return false;
    });
    html += `<div class="cmd ${isToday ? 'today' : ''}">
      <div class="cmd-num">${dd}</div>
      ${cmdsJour.map(c => `<div class="cmd-ev">${escapeHtml(c.client ? c.client.nom : '?')}</div>`).join('')}
    </div>`;
  }
  html += `</div>`;
  $('calContainer').innerHTML = html;
}

// --- helpers escape ---
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function escapeAttr(s) { return escapeHtml(s); }

// --- bind events ---
document.addEventListener('DOMContentLoaded', async () => {
  $('btnLogin').addEventListener('click', login);
  $('btnLogout').addEventListener('click', logout);
  $('iEmail').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('iMdp').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('semSelect').addEventListener('change', chargerMissions);
  $('calSemSelect').addEventListener('change', renderCalSem);
  $('calMoisSelect').addEventListener('change', renderCalMois);
  $('btnListe').addEventListener('click', () => setView('liste'));
  $('btnSem').addEventListener('click', () => setView('semaine'));
  $('btnMois').addEventListener('click', () => setView('mois'));
  document.body.addEventListener('click', (e) => {
    const t = e.target.closest('.plat-header');
    if (t && t.dataset.target) toggleIng(t.dataset.target);
  });

  // Auto-login si session existe
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const { data: profile } = await sb.from('salaries').select('*').eq('id', session.user.id).single();
    if (profile) {
      salarieProfile = profile;
      await initSalarie();
      return;
    }
    await sb.auth.signOut();
  }
  $('pLogin').style.display = 'flex';
});
