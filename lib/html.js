// Render the component status page. One template for two contexts:
//   - static index.html written by component_status.js (opened via file://):
//     "Files" links open Chrome's folder listing; "Copy path" copies the path.
//   - live page served by dashboard.js (http://127.0.0.1:…): "Finder" buttons
//     open the folder in Finder and a Refresh rescans the tree.
// The page detects which it is from location.protocol. No external resources.

import { PIPELINE_COLUMNS, QUALITY_COLUMNS, TODO_LABELS, cellState, qualityValue } from "./status.js";
import { DOMAINS, CREATABLE_ENUMS, QUALITY_KEYS_BY_DOMAIN, REQUIRED_QUALITIES_BY_DOMAIN } from "./seed_rules.js";
import { DOMAIN_FOLDER_BY_DOMAIN, DOMAIN_CONFIGS } from "./domains.js";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function pageData(data) {
  const rows = data.rows.map((r) => ({
    name: r.rec.name,
    rel: r.rec.rel,
    abs: r.rec.dir,
    domain: r.rec.domain,
    group: data.groups.find((g) => g.rows.includes(r))?.file ?? "",
    title: r.rec.meta.data ? String(r.rec.meta.data.title_hpc ?? "") : "",
    q: Object.fromEntries(QUALITY_COLUMNS[r.rec.domain].map((c) => [c, qualityValue(r, c)])),
    cells: r.cells,
    seed: r.seed,
    seedState: cellState(r.seed),
    issues: r.issues,
    todo: r.allTodo,
  }));
  const groups = data.groups.map((g) => ({
    file: g.file,
    label: g.file.replace(/\.csv$/, ""),
    domain: g.domain,
    qcols: QUALITY_COLUMNS[g.domain],
    counts: g.counts,
  }));
  return {
    root: data.rootDir,
    scannedAt: data.scannedAt.toISOString(),
    totals: data.totals,
    pipeline: PIPELINE_COLUMNS,
    todoLabels: TODO_LABELS,
    groups,
    rows,
    notes: data.notes.tree,
    form: {
      domains: DOMAINS,
      enums: CREATABLE_ENUMS,
      keys: QUALITY_KEYS_BY_DOMAIN,
      required: REQUIRED_QUALITIES_BY_DOMAIN,
      folders: DOMAIN_FOLDER_BY_DOMAIN,
      levels: Object.fromEntries(Object.entries(DOMAIN_CONFIGS).map(([f, c]) => [c.domain, c.levels])),
    },
  };
}

export function renderPage(data, { live = false } = {}) {
  const json = JSON.stringify(pageData(data)).replace(/<\//g, "<\\/");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Component status</title>
<style>
  :root { --bg:#fff; --fg:#1b1b1b; --muted:#6b6b6b; --line:#e3e3e3; --head:#f6f6f6;
          --ok:#dff5e1; --ok-fg:#1d6b2a; --pend:#fff1cc; --pend-fg:#7a5200; --err:#ffe0e0; --err-fg:#9b1c1c;
          --na:#f1f1f1; --na-fg:#7a7a7a; --accent:#2563eb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161616; --fg:#eaeaea; --muted:#9a9a9a; --line:#333; --head:#1f1f1f;
          --ok:#173d1f; --ok-fg:#8fd69b; --pend:#3d3000; --pend-fg:#f3d27a; --err:#4a1515; --err-fg:#ff9a9a;
          --na:#242424; --na-fg:#8a8a8a; --accent:#7aa2ff; } }
  * { box-sizing: border-box; }
  body { margin:0; font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:14px 18px 8px; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:10px 24px; align-items:baseline; }
  header h1 { font-size:18px; margin:0; }
  header .meta { color:var(--muted); font-size:12px; }
  header .ready { font-weight:600; }
  nav { display:flex; flex-wrap:wrap; gap:6px; padding:10px 18px; border-bottom:1px solid var(--line); }
  nav button { border:1px solid var(--line); background:var(--head); color:var(--fg); border-radius:999px; padding:4px 12px; cursor:pointer; font:inherit; }
  nav button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  .toolbar { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; padding:10px 18px; }
  .toolbar input, .toolbar select { font:inherit; padding:5px 8px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
  .toolbar input { min-width:260px; }
  .toolbar label { color:var(--muted); font-size:12px; }
  .toolbar .count { margin-left:auto; color:var(--muted); font-size:12px; }
  .wrap { overflow:auto; padding:0 18px 24px; }
  table { border-collapse:separate; border-spacing:0; width:100%; font-size:13px; }
  thead th { position:sticky; top:0; background:var(--head); text-align:left; padding:8px 8px; border-bottom:1px solid var(--line); white-space:nowrap; cursor:pointer; user-select:none; z-index:1; }
  thead th.sorted::after { content:" ▾"; color:var(--muted); } thead th.sorted.asc::after { content:" ▴"; }
  tbody td { padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  td.name { white-space:nowrap; } td.name b { font-weight:600; } td.name .rel { display:block; color:var(--muted); font-size:11px; }
  td.state { white-space:nowrap; }
  .pill { display:inline-block; padding:1px 7px; border-radius:999px; font-size:12px; }
  .complete { background:var(--ok); color:var(--ok-fg); } .pending { background:var(--pend); color:var(--pend-fg); }
  .error { background:var(--err); color:var(--err-fg); } .na { background:var(--na); color:var(--na-fg); }
  td.wrap-text { max-width:420px; white-space:normal; }
  td.actions { white-space:nowrap; }
  .btn { font:inherit; font-size:12px; padding:3px 9px; border:1px solid var(--line); border-radius:6px; background:var(--head); color:var(--fg); cursor:pointer; text-decoration:none; display:inline-block; }
  .btn:hover { border-color:var(--accent); }
  .btn.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
  .empty { padding:40px 18px; color:var(--muted); text-align:center; }
  .notes { padding:6px 18px 0; color:var(--muted); font-size:12px; }
  dialog { border:1px solid var(--line); border-radius:12px; padding:0; background:var(--bg); color:var(--fg); width:min(560px, 92vw); }
  dialog::backdrop { background:rgba(0,0,0,.45); }
  dialog form { padding:18px 20px; display:grid; gap:12px; }
  dialog h2 { margin:0 0 4px; font-size:16px; }
  dialog label { display:grid; gap:4px; font-size:12px; color:var(--muted); }
  dialog input, dialog select, dialog textarea { font:inherit; font-size:14px; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:6px 8px; }
  dialog textarea { min-height:110px; resize:vertical; }
  dialog .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  dialog .preview { font-family:ui-monospace, Menlo, monospace; font-size:12px; color:var(--muted); word-break:break-all; }
  dialog .msg { font-size:13px; min-height:1.2em; } dialog .msg.err { color:var(--err-fg); } dialog .msg.ok { color:var(--ok-fg); }
  dialog .buttons { display:flex; gap:8px; justify-content:flex-end; }
  .toast { position:fixed; bottom:16px; right:16px; background:var(--fg); color:var(--bg); padding:8px 12px; border-radius:8px; font-size:12px; opacity:0; transition:opacity .2s; }
  .toast.show { opacity:1; }
</style>
</head>
<body>
<header>
  <h1>Component status</h1>
  <span class="ready" id="ready"></span>
  <span class="meta" id="meta"></span>
  <span class="meta" id="mode"></span>
  <button class="btn primary" id="addBtn" style="margin-left:auto">+ Add component</button>
</header>
<dialog id="addDlg">
  <form id="addForm" method="dialog">
    <h2>Add component</h2>
    <label>Name <input name="name" required placeholder="e.g. Wrist flexion with theraband" autocomplete="off"></label>
    <label>Domain <select name="domain" id="domainSel"></select></label>
    <div id="fields" class="row"></div>
    <label>Summary (patient instructions — optional, can be added later)
      <textarea name="summary" placeholder="Place your forearm on a table…&#10;Hold as advised."></textarea></label>
    <div class="preview" id="preview"></div>
    <div class="msg" id="addMsg"></div>
    <div class="buttons"><button type="button" class="btn" id="cancelBtn">Cancel</button><button type="submit" class="btn primary" id="submitBtn">Create folder</button></div>
  </form>
</dialog>
<nav id="tabs"></nav>
<div class="toolbar">
  <input id="search" type="search" placeholder="Search name, path, title, issues…">
  <label>Show <select id="show">
    <option value="all">everything</option>
    <option value="work" selected>needs work</option>
    <option value="ready">ready to seed</option>
    <option value="issues">has issues</option>
  </select></label>
  <label>Needs <select id="needs"><option value="">any step</option></select></label>
  <span class="count" id="count"></span>
</div>
<div class="notes" id="notes"></div>
<div class="wrap"><table id="table"><thead></thead><tbody></tbody></table><div class="empty" id="empty" hidden>Nothing matches.</div></div>
<div class="toast" id="toast"></div>
<script id="data" type="application/json">${json}</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById('data').textContent);
  const LIVE = ${live ? "true" : "false"} && location.protocol.startsWith('http');
  const $ = (id) => document.getElementById(id);
  const stateOf = (v) => (v || '').split(/[ (:]/)[0];
  const cls = (v) => ({ complete:'complete', pending:'pending', error:'error', 'n/a':'na' })[stateOf(v)] || 'na';
  const pill = (v) => '<span class="pill ' + cls(v) + '">' + esc(v) + '</span>';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fileUrl = (abs) => 'file://' + encodeURI(abs);

  let tab = 'todo', sortKey = null, sortAsc = true;
  const tabs = [{ id:'todo', label:'To-do', count: D.rows.filter(r => r.todo.length).length },
                ...D.groups.map(g => ({ id:g.file, label:g.label, count:g.counts.total })),
                { id:'issues', label:'Issues', count: D.rows.filter(r => r.issues.length).length }];

  $('ready').textContent = 'Ready to seed ' + D.totals.complete + ' of ' + D.totals.total;
  $('meta').textContent = 'pending ' + D.totals.pending + ' · error ' + D.totals.error + ' · no meta.json ' + D.totals['n/a'] + ' · scanned ' + new Date(D.scannedAt).toLocaleString();
  $('mode').innerHTML = LIVE ? '<button class="btn" onclick="location.reload()">Refresh (rescan)</button>'
                             : 'static snapshot — run <code>npm run status</code> to update, or <code>npm run dashboard</code> for a live page with Finder buttons';
  $('notes').textContent = D.notes.length ? D.notes.join('  ·  ') : '';
  for (const col of D.pipeline) { const o = document.createElement('option'); o.value = col; o.textContent = D.todoLabels[col]; $('needs').appendChild(o); }

  function renderTabs() {
    $('tabs').innerHTML = tabs.map(t => '<button data-id="' + t.id + '" class="' + (t.id === tab ? 'active' : '') + '">' + esc(t.label) + ' (' + t.count + ')</button>').join('');
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.id; sortKey = null; render(); });
  }

  function columns() {
    const g = D.groups.find(g => g.file === tab);
    if (tab === 'todo') return [['name','Component'],['actions',''],['next','Next step'],['todo','To-do'],['seed','Seed']];
    if (tab === 'issues') return [['name','Component'],['actions',''],['issues','Issues'],['seed','Seed']];
    return [['name','Component'],['actions',''], ...g.qcols.map(c => ['q.'+c, c]), ...D.pipeline.map(c => ['c.'+c, c]), ['seed','Seed'],['issues','Issues']];
  }
  function value(r, key) {
    if (key === 'name') return r.name; if (key === 'next') return r.todo[0] || ''; if (key === 'todo') return r.todo.join('; ');
    if (key === 'issues') return r.issues.join('; '); if (key === 'seed') return r.seed;
    if (key.startsWith('q.')) return r.q[key.slice(2)] || ''; if (key.startsWith('c.')) return r.cells[key.slice(2)] || ''; return '';
  }
  function cell(r, key) {
    if (key === 'name') return '<td class="name"><b>' + esc(r.name) + '</b><span class="rel">' + esc(r.rel) + '</span></td>';
    if (key === 'actions') {
      const finder = LIVE ? '<button class="btn primary" data-open="' + esc(r.rel) + '">Finder</button> ' : '';
      const files = '<a class="btn" href="' + esc(fileUrl(r.abs)) + '" target="_blank" rel="noopener">Files</a> ';
      const copy = '<button class="btn" data-copy="' + esc(r.abs) + '">Copy path</button>';
      return '<td class="actions">' + finder + files + copy + '</td>';
    }
    if (key === 'seed') return '<td class="state">' + pill(r.seed) + '</td>';
    if (key.startsWith('c.')) return '<td class="state">' + pill(r.cells[key.slice(2)]) + '</td>';
    if (key === 'todo' || key === 'issues' || key === 'next') {
      const items = key === 'next' ? [r.todo[0] || ''] : (key === 'todo' ? r.todo : r.issues);
      return '<td class="wrap-text">' + items.map(i => '<span class="pill ' + (/ error|^seed error/.test(i) ? 'error' : /^issue:/.test(i) ? 'na' : 'pending') + '">' + esc(i) + '</span>').join(' ') + '</td>';
    }
    return '<td>' + esc(value(r, key)) + '</td>';
  }

  function filtered() {
    const q = $('search').value.trim().toLowerCase();
    const show = $('show').value, needs = $('needs').value;
    return D.rows.filter(r => {
      if (tab === 'todo' && !r.todo.length) return false;
      if (tab === 'issues' && !r.issues.length) return false;
      if (tab !== 'todo' && tab !== 'issues' && r.group !== tab) return false;
      if (show === 'work' && !r.todo.length) return false;
      if (show === 'ready' && r.seedState !== 'complete') return false;
      if (show === 'issues' && !r.issues.length) return false;
      if (needs && !['pending','error'].includes(stateOf(r.cells[needs]))) return false;
      if (q) { const hay = [r.name, r.rel, r.title, r.seed, ...r.issues, ...r.todo, ...Object.values(r.q)].join(' ').toLowerCase(); if (!hay.includes(q)) return false; }
      return true;
    });
  }

  function render() {
    renderTabs();
    const cols = columns();
    let rows = filtered();
    if (sortKey) rows = rows.slice().sort((a, b) => value(a, sortKey).localeCompare(value(b, sortKey), undefined, { numeric:true }) * (sortAsc ? 1 : -1));
    else if (tab === 'todo') rows = rows.slice().sort((a, b) => { const ia = a.todo.every(i => i.startsWith('issue:')), ib = b.todo.every(i => i.startsWith('issue:')); return (ia - ib) || (a.todo.length - b.todo.length) || a.rel.localeCompare(b.rel); });
    $('table').querySelector('thead').innerHTML = '<tr>' + cols.map(([k, l]) => '<th data-key="' + k + '" class="' + (k === sortKey ? 'sorted ' + (sortAsc ? 'asc' : '') : '') + '">' + esc(l) + '</th>').join('') + '</tr>';
    $('table').querySelector('tbody').innerHTML = rows.map(r => '<tr>' + cols.map(([k]) => cell(r, k)).join('') + '</tr>').join('');
    $('empty').hidden = rows.length > 0;
    $('count').textContent = rows.length + ' of ' + D.rows.length + ' components';
    document.querySelectorAll('th[data-key]').forEach(th => th.onclick = () => { const k = th.dataset.key; if (k === 'actions') return; if (sortKey === k) sortAsc = !sortAsc; else { sortKey = k; sortAsc = true; } render(); });
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => {
      const res = await fetch('/open?rel=' + encodeURIComponent(b.dataset.open)).catch(() => null);
      toast(res && res.ok ? 'Opened in Finder' : 'Could not open — is the dashboard still running?');
    });
    document.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Path copied — ⇧⌘G in Finder, paste'); } catch { toast('Copy failed'); } });
  }
  let toastTimer; function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800); }

  // ── Add component form ──
  const F = D.form, dlg = $('addDlg'), form = $('addForm');
  const label = (k) => k.replace(/_/g, ' ');
  $('domainSel').innerHTML = F.domains.map(d => '<option value="' + d + '">' + d.replace(/_/g, ' ') + '</option>').join('');
  function buildFields() {
    const domain = form.domain.value;
    const keys = F.keys[domain];
    $('fields').innerHTML = keys.map(k => {
      const req = F.required[domain].includes(k);
      const opts = F.enums[k].map(v => '<option value="' + v + '">' + v.replace(/_/g, ' ') + '</option>').join('');
      const blank = req ? '<option value="" disabled selected>choose…</option>' : '<option value="">none</option>';
      return '<label data-key="' + k + '">' + label(k) + (req ? ' *' : '') + ' <select name="' + k + '"' + (req ? ' required' : '') + '>' + blank + opts + '</select></label>';
    }).join('');
    toggleContraction(); updatePreview();
  }
  function toggleContraction() {
    const wrap = $('fields').querySelector('[data-key="contraction_type"]'); if (!wrap) return;
    const isRes = form.exercise_type && form.exercise_type.value === 'resistance';
    wrap.style.display = isRes ? '' : 'none';
    const sel = wrap.querySelector('select'); sel.required = isRes; if (!isRes) sel.value = '';
    if (isRes && sel.options[0].value === '') { sel.options[0].disabled = true; sel.options[0].textContent = 'choose…'; }
  }
  const slugify = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  function updatePreview() {
    const domain = form.domain.value, slug = slugify(form.name.value || '');
    const parts = [F.folders[domain], ...F.levels[domain].map(k => (form[k] && form[k].value) || '<' + k + '>'), slug || '<name>'];
    $('preview').textContent = 'Will create: ' + parts.join('/') + '/  (final, bg_removed, original, audio, meta.json, ' + (slug || 'name') + '_summary.txt)';
  }
  form.addEventListener('input', (e) => { if (e.target.name === 'exercise_type') toggleContraction(); updatePreview(); });
  form.addEventListener('change', (e) => { if (e.target.name === 'domain') buildFields(); else { if (e.target.name === 'exercise_type') toggleContraction(); updatePreview(); } });
  $('addBtn').onclick = () => {
    if (!LIVE) { toast('Open the live page (npm run dashboard) to add components'); return; }
    form.reset(); buildFields(); $('addMsg').textContent = ''; $('addMsg').className = 'msg'; dlg.showModal(); form.name.focus();
  };
  $('cancelBtn').onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form).entries());
    $('submitBtn').disabled = true; $('addMsg').textContent = 'Creating…'; $('addMsg').className = 'msg';
    try {
      const res = await fetch('/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const r = await res.json();
      if (r.outcome === 'created') { $('addMsg').textContent = 'Created ' + r.rel; $('addMsg').className = 'msg ok'; toast('Created ' + r.rel); setTimeout(() => location.reload(), 900); }
      else { $('addMsg').textContent = (r.outcome === 'exists' ? 'Already exists: ' + r.where : 'Not created — ' + r.message); $('addMsg').className = 'msg err'; }
    } catch { $('addMsg').textContent = 'Could not reach the dashboard server'; $('addMsg').className = 'msg err'; }
    $('submitBtn').disabled = false;
  };
  buildFields();

  $('search').oninput = render; $('show').onchange = render; $('needs').onchange = render;
  render();
})();
</script>
</body>
</html>
`;
}
