// app.js — Portail client Le Gout du Lien
// Backend: Supabase

const SUPABASE_URL = 'https://loiaubdlhkcnohtbwtxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxvaWF1YmRsaGtjbm9odGJ3dHhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMzU1NDAsImV4cCI6MjA5MjcxMTU0MH0.2S2xnnpFT-kcblTzSC_x2ybSUUipUi5jMPe_DbNBUcA';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const JOURS = ['Lundi', 'Mardi', 'Jeudi', 'Vendredi'];
const HEURES = ['9h00 - 12h00', '13h00 - 16h00'];
const JMAP = { Lundi: 0, Mardi: 1, Jeudi: 3, Vendredi: 4 };
const REMOJI = {
  'Fruits & Légumes': '🥦', 'Fruits et légumes': '🥦', 'Fruits & légumes': '🥦',
  'Viandes': '🥩', 'Boucherie': '🥩', 'Charcuterie': '🥓',
  'Poissonnerie': '🐟', 'Crémerie': '🧀', 'Cremerie': '🧀',
  'Épicerie': '🥫', 'Epicerie': '🥫', 'Épices': '🌶️', 'Epices': '🌶️',
  'Surgelés': '❄️', 'Boulangerie': '🥖', 'Produits frais': '🥗'
};

// state
let clientProfile = null;
let recettes = [];
let ingredients = [];
let recettesIngredients = [];
let mesCommandes = [];
let sel = [];
let semSel = null;
let crenSel = null;
let platsDetailCache = [];

// helpers UI
const $ = (id) => document.getElementById(id);
const showLoad = (t) => { $('lov').style.display = 'flex'; $('ltxt').textContent = t || 'Chargement...'; };
const hideLoad = () => { $('lov').style.display = 'none'; };
const showToast = (m, t) => {
  const el = $('toast'); el.textContent = m; el.className = 'toast show ' + (t || '');
  setTimeout(() => { el.className = 'toast'; }, 3000);
};
const showPage = (p) => {
  ['pLogin', 'pDash', 'pApp', 'pDetail'].forEach(x => { const el = $(x); if (el) el.style.display = 'none'; });
  const el = $(p); if (el) el.style.display = p === 'pLogin' ? 'flex' : 'block';
};

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function fmtN(n) { return n % 1 === 0 ? n : parseFloat(n.toFixed(2)); }
function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return iso; }
}
function catCls(c) {
  if (!c) return 'cd';
  const l = c.toLowerCase();
  if (l.includes('vég') || l.includes('vege')) return 'cv';
  if (l.includes('viande')) return 'cm';
  if (l.includes('poisson')) return 'cp';
  return 'cd';
}

// --- AUTH ---
async function login() {
  const email = $('iEmail').value.trim();
  const mdp = $('iMdp').value.trim();
  const err = $('lerr');
  err.style.display = 'none';
  if (!email || !mdp) {
    err.textContent = 'Remplissez tous les champs.'; err.style.display = 'block'; return;
  }
  showLoad('Connexion...');
  try {
    const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password: mdp });
    if (authErr) throw new Error('Email ou mot de passe incorrect.');
    const { data: profile, error: pErr } = await sb.from('clients').select('*').eq('id', auth.user.id).single();
    if (pErr || !profile) {
      await sb.auth.signOut();
      throw new Error("Ce compte n'est pas un compte client.");
    }
    clientProfile = profile;
    await loadDash();
  } catch (e) {
    err.textContent = e.message || String(e); err.style.display = 'block';
  } finally {
    hideLoad();
  }
}

async function logout() {
  await sb.auth.signOut();
  clientProfile = null; sel = []; semSel = null; crenSel = null;
  sessionStorage.clear();
  showPage('pLogin');
}

// --- DASHBOARD ---
async function loadDash() {
  const prenom = (clientProfile.nom || '').split(' ')[0];
  $('unom').textContent = prenom;
  $('welcomeTxt').textContent = `Bonjour ${prenom} !`;
  showPage('pDash');
  await chargerMesCommandes();
}

async function chargerMesCommandes() {
  const div = $('dashCommandes');
  div.innerHTML = '<div style="text-align:center;padding:20px"><div class="spin" style="margin:0 auto"></div></div>';
  try {
    if (!recettes.length) await loadRecettesData();
    const { data, error } = await sb.from('commandes')
      .select('*')
      .eq('client_id', clientProfile.id)
      .order('semaine_du', { ascending: false });
    if (error) throw error;
    mesCommandes = data || [];

    if (!mesCommandes.length) {
      div.innerHTML = `<div class="section-titre">Mes commandes</div><div class="empty-state"><div class="eicon">📭</div><p>Vous n'avez pas encore de commande.</p></div>`;
      return;
    }
    div.innerHTML = `<div class="section-titre">Mes commandes (${mesCommandes.length})</div><div class="cmd-liste">${mesCommandes.map((cmd, i) => {
      const platIds = [cmd.plat_1_id, cmd.plat_2_id, cmd.plat_3_id, cmd.plat_4_id, cmd.plat_5_id].filter(Boolean);
      const plats = platIds.map(id => (recettes.find(r => r.id === id) || {}).nom_du_plat).filter(Boolean);
      const ok = cmd.statut === 'Confirmée';
      return `<div class="cmd-item" data-idx="${i}">
        <div class="cmd-info">
          <h4>Semaine du ${escapeHtml(fmtDate(cmd.semaine_du))}</h4>
          <p>${escapeHtml(cmd.creneau || '')}</p>
          <div class="cmd-plats">${plats.slice(0, 3).map(escapeHtml).join(' · ')}${plats.length > 3 ? ' · ...' : ''}</div>
        </div>
        <div class="cmd-status">
          <span class="badge ${ok ? 'ok' : 'wait'}">${ok ? '✓ Confirmee' : '⏳ En attente'}</span>
          <span class="cmd-arrow">›</span>
        </div>
      </div>`;
    }).join('')}</div>`;
    div.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => ouvrirCommande(parseInt(el.dataset.idx, 10)));
    });
  } catch (e) {
    div.innerHTML = '<p style="color:var(--txl);padding:20px">Erreur chargement: ' + escapeHtml(e.message) + '</p>';
  }
}

function showMesCommandes() {
  const div = $('dashCommandes');
  if (div) div.scrollIntoView({ behavior: 'smooth' });
}

// --- DETAIL COMMANDE ---
async function ouvrirCommande(idx) {
  const cmd = mesCommandes[idx];
  if (!cmd) return;
  showPage('pDetail');
  showLoad('Chargement...');
  try {
    if (!recettes.length) await loadRecettesData();
    const platIds = [cmd.plat_1_id, cmd.plat_2_id, cmd.plat_3_id, cmd.plat_4_id, cmd.plat_5_id].filter(Boolean);
    platsDetailCache = platIds.map(id => recettes.find(r => r.id === id)).filter(Boolean);
    const semLabel = cmd.semaine_du ? 'Semaine du ' + fmtDate(cmd.semaine_du) : '';
    renderDetail({ nom: clientProfile.nom || '', semLabel, creneau: cmd.creneau || '', id: cmd.id, statut: cmd.statut || 'En attente de paiement' });
  } catch (e) {
    showToast('Erreur: ' + e.message, 'err');
  } finally {
    hideLoad();
  }
}

function renderDetail(data) {
  const ok = data.statut === 'Confirmée';
  const titre = ok ? 'Commande confirmee' : 'Commande en attente';
  const icone = ok
    ? '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/></svg>';
  $('detailMain').innerHTML = `
    <div class="cbanner">
      <div class="cicon">${icone}</div>
      <h1>${titre}</h1>
      <p>${escapeHtml(data.semLabel)} · ${escapeHtml(data.creneau)}</p>
    </div>
    <div class="igrid">
      <div><div class="ilbl">Client</div><div class="ival">${escapeHtml(data.nom)}</div></div>
      <div><div class="ilbl">Semaine</div><div class="ival">${escapeHtml(data.semLabel)}</div></div>
      <div><div class="ilbl">Creneau</div><div class="ival">${escapeHtml(data.creneau)}</div></div>
      <div><div class="ilbl">Montant</div><div class="ival">60€</div></div>
    </div>
    <div class="tabs">
      <button class="tab on" data-tab="plats">🍽️ Mes plats</button>
      <button class="tab" data-tab="courses">🛒 Liste de courses</button>
      <button class="tab" data-tab="memo">♨️ Rechauffage & conservation</button>
    </div>
    <div id="tc-plats" class="tc on">
      <div class="ecgrid">${platsDetailCache.map(p => `
        <div class="eccard" data-platid="${p.id}">
          ${p.photo_url ? `<img class="ecimg" src="${escapeHtml(p.photo_url)}" alt="${escapeHtml(p.nom_du_plat)}">` : `<div class="ecph">🍽️</div>`}
          <div class="ecinfo">
            <div class="ecnom">${escapeHtml(p.nom_du_plat)}</div>
            <div class="echint">Cliquez pour les ingredients</div>
          </div>
        </div>`).join('')}
      </div>
    </div>
    <div id="tc-courses" class="tc">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div class="cnote" style="margin-bottom:0;flex:1">🛒 Quantites pour <strong>4 portions</strong> par plat</div>
        <button id="btnPrint" style="padding:9px 18px;background:#3d6b4f;color:#fff;border:none;border-radius:10px;font-family:'DM Sans',sans-serif;font-size:13px;cursor:pointer;white-space:nowrap">🖨️ Imprimer</button>
      </div>
      <div id="coursesDiv"></div>
    </div>
    <div id="tc-memo" class="tc">
      ${platsDetailCache.map(p => `
        <div class="mcard">
          <div class="mnom">${escapeHtml(p.nom_du_plat)}</div>
          <div class="mgrid">
            <div class="mi miv"><div class="mlbl">♨️ Rechauffage</div><div class="mtxt">${escapeHtml(p.instructions_rechauffage || 'Non renseigne')}</div></div>
            <div class="mi mij"><div class="mlbl">🧊 Conservation</div><div class="mtxt">${p.frigo_en_jours ? p.frigo_en_jours + ' jours au refrigerateur' : 'Non renseigne'}</div></div>
            ${p.congelation ? `<div class="mi" style="background:#e3f2fd;border-left:3px solid #64b5f6"><div class="mlbl">❄️ Congelation</div><div class="mtxt">${escapeHtml(p.congelation)}</div></div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;

  $('detailMain').querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => chgTab(t.dataset.tab, t)));
  $('detailMain').querySelectorAll('.eccard').forEach(c => c.addEventListener('click', () => voirIngDetail(c.dataset.platid)));
  $('btnPrint').addEventListener('click', imprimerCourses);
  loadCourses(platsDetailCache.map(p => p.id));
}

function chgTab(t, btn) {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
  document.querySelectorAll('.tc').forEach(x => x.classList.remove('on'));
  btn.classList.add('on');
  $('tc-' + t).classList.add('on');
}

function loadCourses(platIds) {
  const rayons = {};
  platIds.forEach(pid => {
    const ris = recettesIngredients.filter(ri => ri.recette_id === pid);
    ris.forEach(ri => {
      const ing = ingredients.find(i => i.id === ri.ingredient_id);
      if (!ing) return;
      const ray = ing.rayon || 'Autres';
      const u = ing.unite_par_defaut && ing.unite_par_defaut !== 'Unité par défaut' ? ing.unite_par_defaut : '';
      const qte = (ri.quantite_par_portion || 0) * 4;
      if (!rayons[ray]) rayons[ray] = {};
      if (!rayons[ray][ing.nom]) rayons[ray][ing.nom] = { qte: 0, u };
      rayons[ray][ing.nom].qte += qte;
    });
  });
  const sorted = Object.entries(rayons).sort((a, b) => a[0].localeCompare(b[0]));
  const el = $('coursesDiv');
  if (!sorted.length) { el.innerHTML = '<p style="color:var(--txl);padding:20px">Aucun ingredient trouve.</p>'; return; }
  el.innerHTML = sorted.map(([ray, ings]) => `
    <div class="rbloc">
      <div class="rtit">${REMOJI[ray] || '🛒'} ${escapeHtml(ray)}</div>
      ${Object.entries(ings).map(([n, { qte, u }]) => `
        <div class="iline">
          <span class="inom">${escapeHtml(n)}</span>
          <span class="iqte">${qte > 0 ? fmtN(qte) + (u ? ' ' + u : '') : '–'}</span>
        </div>`).join('')}
    </div>`).join('');
}

function voirIngDetail(platId) {
  const plat = recettes.find(r => r.id === platId);
  if (!plat) return;
  const ris = recettesIngredients.filter(ri => ri.recette_id === platId).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  const html = `
    ${plat.photo_url ? `<img class="mimg" src="${escapeHtml(plat.photo_url)}" alt="${escapeHtml(plat.nom_du_plat)}">` : `<div class="mph">🍽️</div>`}
    <div class="mbody">
      <div class="mtit2">${escapeHtml(plat.nom_du_plat)}</div>
      ${ris.length ? `
      <div class="mstit">🥕 Ingredients (4 portions)</div>
      <ul class="ings">${ris.map(ri => {
        const ing = ingredients.find(i => i.id === ri.ingredient_id);
        if (!ing) return '';
        const qte = (ri.quantite_par_portion || 0) * 4;
        const u = ing.unite_par_defaut && ing.unite_par_defaut !== 'Unité par défaut' ? ing.unite_par_defaut : '';
        return `<li style="display:flex;justify-content:space-between"><span>${escapeHtml(ing.nom)}</span><span style="color:var(--txl)">${qte > 0 ? fmtN(qte) + (u ? ' ' + u : '') : '–'}</span></li>`;
      }).join('')}</ul>` : ''}
      <div class="mstit">♨️ Rechauffage</div>
      <div class="mrec">${escapeHtml(plat.instructions_rechauffage || 'Non renseigne')}</div>
      <div class="mstit">🧊 Conservation</div>
      <div class="mcon">${plat.frigo_en_jours ? plat.frigo_en_jours + ' jours au refrigerateur' : 'Non renseigne'}</div>
      ${plat.congelation ? `<div class="mstit">❄️ Congelation</div><div class="mcon" style="border-left-color:#64b5f6;background:#e3f2fd">${escapeHtml(plat.congelation)}</div>` : ''}
      <button class="mclose" id="mcloseBtn">Fermer</button>
    </div>`;
  $('mcont').innerHTML = html;
  $('mbg').classList.add('show');
  $('mcloseBtn').addEventListener('click', () => $('mbg').classList.remove('show'));
}

function imprimerCourses() {
  const coursesDiv = $('coursesDiv');
  if (!coursesDiv) return;
  const semaineEl = document.querySelector('.cbanner p');
  const semaine = semaineEl ? semaineEl.textContent : '';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>Liste de courses - Le Gout du Lien</title>
    <style>
      body{font-family:'Helvetica Neue',Arial,sans-serif;max-width:600px;margin:40px auto;padding:20px;color:#2c2c2c}
      h1{font-size:22px;margin-bottom:4px;color:#3d6b4f}
      .sub{font-size:13px;color:#6b6b6b;margin-bottom:24px}
      h2{font-size:15px;font-weight:600;border-bottom:2px solid #ede7db;padding-bottom:6px;margin:20px 0 10px}
      .item{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0ece4;font-size:14px}
      .qte{color:#3d6b4f;font-weight:500}
      @media print{body{margin:20px}}
    </style>
  </head><body>
    <h1>Le Gout du Lien</h1>
    <div class="sub">Liste de courses · ${escapeHtml(semaine)}</div>
    ${coursesDiv.innerHTML}
    <div style="margin-top:30px;font-size:11px;color:#aaa;text-align:center">Imprime depuis legoutdulien.netlify.app</div>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

// --- APP COMMANDE (selection plats) ---
async function showApp() {
  sel = []; semSel = null; crenSel = null;
  showPage('pApp');
  affSemaines();
  if (!recettes.length) await loadRecettesData();
  renderPlats();
  majBarre();
}

async function loadRecettesData() {
  showLoad('Chargement des plats...');
  try {
    const [recRes, riRes, ingRes] = await Promise.all([
      sb.from('recettes').select('*').order('nom_du_plat'),
      sb.from('recettes_ingredients').select('*').order('ordre', { ascending: true }),
      sb.from('ingredients').select('*')
    ]);
    if (recRes.error) throw recRes.error;
    if (riRes.error) throw riRes.error;
    if (ingRes.error) throw ingRes.error;
    recettes = recRes.data || [];
    recettesIngredients = riRes.data || [];
    ingredients = ingRes.data || [];
  } finally {
    hideLoad();
  }
}

function getLundis() {
  const res = [];
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const dow = (new Date(y, m, d)).getDay() || 7;
  const diffToMonday = dow - 1;
  for (let i = 0; i < 4; i++) {
    const l = new Date(y, m, d - diffToMonday + i * 7);
    const v = new Date(y, m, d - diffToMonday + i * 7 + 4);
    const f = x => x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    const yy = l.getFullYear(), mm = String(l.getMonth() + 1).padStart(2, '0'), dd = String(l.getDate()).padStart(2, '0');
    res.push({ id: `${yy}-${mm}-${dd}`, label: `Semaine du ${f(l)}`, det: `${f(l)} au ${f(v)}` });
  }
  return res;
}

function affSemaines() {
  const c = $('slist');
  c.innerHTML = '';
  getLundis().forEach(s => {
    const el = document.createElement('div');
    el.className = 'sitem';
    el.innerHTML = `<div>${escapeHtml(s.label)}</div><div class="sdates">${escapeHtml(s.det)}</div>`;
    el.addEventListener('click', () => {
      document.querySelectorAll('.sitem').forEach(x => x.classList.remove('on'));
      el.classList.add('on');
      semSel = s;
      affCreneaux(s);
    });
    c.appendChild(el);
  });
}

async function affCreneaux(sem) {
  const c = $('clist');
  c.innerHTML = '<div class="cph">Chargement...</div>';
  crenSel = null;
  let pris = [], crenRecs = [];
  try {
    const [cmdRes, crRes] = await Promise.all([
      sb.from('commandes').select('creneau').eq('semaine_du', sem.id),
      sb.from('creneaux').select('*').eq('semaine', sem.id)
    ]);
    pris = (cmdRes.data || []).map(r => r.creneau).filter(Boolean);
    crenRecs = crRes.data || [];
  } catch (e) { /* default to all open */ }

  const SLOT_MAP = { matin: '9h00 - 12h00', apmidi: '13h00 - 16h00' };
  function isActif(j, slot) {
    const k = `${j}_${slot}`;
    const found = crenRecs.find(r => r.slot === k);
    return found ? !!found.actif : true;
  }
  const [y, mo, d] = sem.id.split('-').map(Number);
  c.innerHTML = '';
  JOURS.forEach(j => {
    const jd = new Date(y, mo - 1, d + JMAP[j]);
    const jl = jd.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    ['matin', 'apmidi'].forEach(slot => {
      const h = SLOT_MAP[slot];
      const lbl = `${jl} · ${h}`;
      const taken = pris.some(p => p && p.trim() === lbl.trim());
      const ferme = !isActif(j, slot);
      const el = document.createElement('div');
      el.className = 'citem' + ((taken || ferme) ? ' cpris' : '');
      const tag = taken ? '<span class="cpris-tag">Complet</span>' : ferme ? '<span class="cpris-tag">Ferme</span>' : '';
      el.innerHTML = `<div class="cjour">${escapeHtml(jl)}</div><div style="display:flex;align-items:center;justify-content:space-between"><span>${h}</span>${tag}</div>`;
      if (!taken && !ferme) {
        el.addEventListener('click', () => {
          document.querySelectorAll('.citem').forEach(x => x.classList.remove('on'));
          el.classList.add('on');
          crenSel = { lbl };
          majBarre();
        });
      }
      c.appendChild(el);
    });
  });
}

function renderPlats() {
  const g = $('pgrid');
  g.innerHTML = '';
  const actifs = recettes.filter(r => r.active);
  actifs.forEach(rec => {
    const card = document.createElement('div');
    card.className = 'pcard';
    card.dataset.id = rec.id;
    card.innerHTML = `
      <div class="pchk"><svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></div>
      ${rec.photo_url ? `<img class="pimg" src="${escapeHtml(rec.photo_url)}" alt="${escapeHtml(rec.nom_du_plat)}" loading="lazy">` : `<div class="pph">🍽️</div>`}
      <div class="pinfo">
        <div class="ptop">
          <span class="pcat ${catCls(rec.categorie)}">${escapeHtml(rec.categorie || 'Plat')}</span>
          <button class="bing" data-act="ing" data-id="${rec.id}">🥕 Ingredients</button>
        </div>
        <div class="pnom">${escapeHtml(rec.nom_du_plat)}</div>
      </div>`;
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="ing"]')) return;
      togglePlat(rec.id, card);
    });
    card.querySelector('[data-act="ing"]').addEventListener('click', (e) => {
      e.stopPropagation();
      voirIngSel(rec.id);
    });
    g.appendChild(card);
  });
}

function togglePlat(id, card) {
  const idx = sel.findIndex(p => p.id === id);
  if (idx > -1) {
    sel.splice(idx, 1);
    card.classList.remove('on');
  } else {
    if (sel.length >= 5) { showToast('Maximum 5 plats !', 'err'); return; }
    const rec = recettes.find(r => r.id === id);
    if (!rec) return;
    sel.push({ id, nom: rec.nom_du_plat });
    card.classList.add('on');
  }
  document.querySelectorAll('.pcard').forEach(c => {
    if (!c.classList.contains('on')) c.classList.toggle('off', sel.length >= 5);
  });
  majBarre();
}

function majBarre() {
  const n = sel.length;
  const ok = n === 5 && semSel && crenSel;
  for (let i = 1; i <= 5; i++) $('d' + i).classList.toggle('on', i <= n);
  $('ctxt').textContent = n + ' / 5 plats';
  $('barre').classList.toggle('show', n > 0);
  $('btxt').textContent = n + ' / 5 plats selectionnes';
  $('bcren').textContent = crenSel ? '📅 ' + crenSel.lbl : semSel ? 'Choisissez un creneau' : 'Choisissez une semaine et un creneau';
  const bv = $('bval');
  bv.disabled = !ok;
  bv.textContent = ok ? '✓ Valider ma semaine' : (n < 5 ? 'Encore ' + (5 - n) + ' plat' + (5 - n > 1 ? 's' : '') : 'Choisissez un creneau');
}

function voirIngSel(platId) {
  voirIngDetail(platId);
}

function valider() {
  if (sel.length < 5 || !semSel || !crenSel) return;
  afficherRecap();
}

function afficherRecap() {
  const pop = document.createElement('div');
  pop.id = 'recapPop';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px';
  const semaine = semSel ? semSel.label : '';
  const creneau = crenSel ? crenSel.lbl : '';
  const platsHtml = sel.map((p, i) => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #ede7db">
    <span style="background:#eef4f0;color:#3d6b4f;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0">${i + 1}</span>
    <span style="font-size:14px">${escapeHtml(p.nom)}</span>
  </div>`).join('');

  pop.innerHTML = `<div id="recapBox" style="background:#fff;border-radius:20px;padding:0;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;max-height:90vh;overflow-y:auto">
    <div style="background:#3d6b4f;padding:24px;text-align:center;color:#fff">
      <div style="font-size:36px;margin-bottom:10px">📋</div>
      <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;margin-bottom:4px">Recapitulatif</div>
      <div style="font-size:13px;opacity:.85">Verifiez votre selection avant de confirmer</div>
    </div>
    <div style="padding:24px">
      <div style="background:#f8f4ee;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b6b6b;margin-bottom:4px">📅 Semaine</div>
        <div style="font-size:15px;font-weight:500">${escapeHtml(semaine)}</div>
      </div>
      <div style="background:#f8f4ee;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b6b6b;margin-bottom:4px">🕐 Creneau</div>
        <div style="font-size:15px;font-weight:500">${escapeHtml(creneau)}</div>
      </div>
      <div style="background:#f8f4ee;border-radius:12px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#6b6b6b;margin-bottom:8px">🍽️ Vos 5 plats</div>
        ${platsHtml}
      </div>
      <div style="background:#eef4f0;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:15px;font-weight:500">A votre charge</span>
        <span style="font-size:20px;font-weight:700;color:#3d6b4f">60€</span>
      </div>
      <div style="background:#fff8e7;border-left:3px solid #f9c74f;border-radius:10px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px;color:#8a6a1a">💳 Paiement automatique via URSSAF</div>
        <div style="font-size:12px;line-height:1.6;color:#5a5a3a">
          Une fois la prestation declaree par Alizee, l'URSSAF prelevera <strong>60€</strong> directement sur votre compte bancaire (l'avance immediate du credit d'impot de 50% est deja deduite — vous payez 60€ au lieu de 120€).<br><br>
          Vous n'avez <strong>rien a faire</strong> : votre commande passera en "Confirmee" des la declaration validee.
        </div>
      </div>
      <button id="recapConfirm" style="display:block;width:100%;padding:14px;background:#3d6b4f;color:#fff;border-radius:12px;border:none;font-weight:500;font-size:15px;cursor:pointer;font-family:'DM Sans',sans-serif;margin-bottom:10px">✓ Confirmer ma commande</button>
      <button id="recapModifier" style="width:100%;padding:12px;background:#f8f4ee;color:#6b6b6b;border-radius:12px;border:none;font-size:14px;cursor:pointer;font-family:'DM Sans',sans-serif">← Modifier ma selection</button>
    </div>
  </div>`;
  document.body.appendChild(pop);

  $('recapModifier').addEventListener('click', () => pop.remove());
  $('recapConfirm').addEventListener('click', () => confirmerCommande(pop));
}

async function confirmerCommande(pop) {
  const btn = $('recapConfirm');
  btn.disabled = true;
  btn.textContent = 'Enregistrement...';
  btn.style.opacity = '0.6';
  btn.style.cursor = 'not-allowed';
  try {
    const payload = {
      client_id: clientProfile.id,
      semaine_du: semSel.id,
      creneau: crenSel.lbl,
      statut: 'En attente de paiement',
      plat_1_id: sel[0].id,
      plat_2_id: sel[1].id,
      plat_3_id: sel[2].id,
      plat_4_id: sel[3].id,
      plat_5_id: sel[4].id,
      nombre_portions: 4
    };
    const { error } = await sb.from('commandes').insert(payload);
    if (error) throw error;

    // Remplace le contenu de la modal par l'ecran de succes
    $('recapBox').innerHTML = `
      <div style="background:#3d6b4f;padding:32px 24px;text-align:center;color:#fff">
        <div style="font-size:54px;margin-bottom:12px">✅</div>
        <div style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700;margin-bottom:6px">Commande validee !</div>
        <div style="font-size:13px;opacity:.85">Merci, on s'occupe de tout</div>
      </div>
      <div style="padding:28px 24px">
        <p style="font-size:14px;line-height:1.7;color:#2c2c2c;margin-bottom:18px">
          Alizee va emettre votre facture via Abby et l'URSSAF prelevera <strong>60€</strong> sur votre compte bancaire.<br><br>
          Vous recevrez une notification quand votre commande passera en <strong>"Confirmee"</strong>.
        </p>
        <button id="recapClose" style="display:block;width:100%;padding:14px;background:#3d6b4f;color:#fff;border-radius:12px;border:none;font-weight:500;font-size:15px;cursor:pointer;font-family:'DM Sans',sans-serif">Voir mes commandes</button>
      </div>`;
    $('recapClose').addEventListener('click', async () => {
      pop.remove();
      sel = []; semSel = null; crenSel = null;
      await chargerMesCommandes();
      showPage('pDash');
    });
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '✓ Confirmer ma commande';
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    showToast('Erreur: ' + (e.message || e), 'err');
  }
}

// --- bind events ---
document.addEventListener('DOMContentLoaded', async () => {
  $('btnLogin').addEventListener('click', login);
  $('btnLogout1').addEventListener('click', logout);
  $('btnLogout2').addEventListener('click', logout);
  $('btnLogout3').addEventListener('click', logout);
  $('btnRetourDash').addEventListener('click', () => showPage('pDash'));
  $('btnRetourDash2').addEventListener('click', () => showPage('pDash'));
  $('cardCommander').addEventListener('click', showApp);
  $('cardMesCommandes').addEventListener('click', showMesCommandes);
  $('bval').addEventListener('click', valider);
  $('iEmail').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('iMdp').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('mbg').addEventListener('click', (e) => { if (e.target === $('mbg')) $('mbg').classList.remove('show'); });

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    const { data: profile } = await sb.from('clients').select('*').eq('id', session.user.id).single();
    if (profile) {
      clientProfile = profile;
      await loadDash();
      return;
    }
    await sb.auth.signOut();
  }
  showPage('pLogin');
});
