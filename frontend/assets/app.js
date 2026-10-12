/* Resume Intelligence: single-page app.
   Plain JavaScript, no framework or CDN. Views are functions that return HTML;
   one delegated listener handles every interaction. */

const App = (() => {
  const $ = id => document.getElementById(id);
  const I = (n, s = 16) => Icons.get(n, s);
  const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
                  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } } };

  const S = {
    job: { name: '', text: '' }, resumes: [], screen: null, blind: store.get('ri2-blind') !== 'off',
    view: store.get('ri2-view') || 'board', q: '', drawer: null, tab: 'overview', compare: new Set(),
    imp: { resume: { name: '', text: '' }, job: '', result: null, base: null, assume: new Set() },
    samples: null, busy: false,
    jobs: null, jobMeta: { statuses: ['Open', 'On hold', 'Closed'], employment_types: ['Full-time', 'Part-time', 'Contract', 'Internship'] },
    jobFilter: store.get('ri2-jobfilter') || 'All', jobQ: '', editor: null, confirm: null,
    activity: [], model: null, palette: null, shortcuts: false, run: null, dealt: false,
    weights: null, pipe: {}, groups: {}, fair: { attr: 'experience', outcome: 'shortlist' },
    hl: new Set(['shown', 'listed', 'related', 'metric']), detail: null, tune: false, labels: {},
  };
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD = isMac ? '⌘' : 'Ctrl';
  const ST = { 'Open': { cls: 'st-open', icon: 'check' }, 'On hold': { cls: 'st-hold', icon: 'pause' }, 'Closed': { cls: 'st-closed', icon: 'archive' } };

  const VERD = {
    strong:    { label: 'Strong shortlist',    cls: 'v-strong',    c: 'var(--green)', m: 'var(--v-strong)',    icon: 'star' },
    shortlist: { label: 'Shortlist',           cls: 'v-shortlist', c: 'var(--teal)',  m: 'var(--v-shortlist)', icon: 'check' },
    verify:    { label: 'Interview to verify', cls: 'v-verify',    c: 'var(--amber)', m: 'var(--v-verify)',    icon: 'help' },
    reject:    { label: 'Not a fit',           cls: 'v-reject',    c: 'var(--slate)', m: 'var(--v-reject)',    icon: 'x' },
  };
  const AV = ['#6E56CF', '#3E63DD', '#0D7480', '#18794E', '#A35200', '#CD2B31', '#8E4EC6', '#0091FF'];
  const PART_TIPS = {
    must: 'Share of must-have skills found. A skill shown in a job or project bullet counts fully; one that only sits in a skills list counts 70%. Either-or requirements count once.',
    nice: 'Same idea for nice-to-have skills.',
    experience: 'Years from dated roles (overlaps merged) against the minimum the job asks for.',
    education: 'Highest qualification found against the level the job asks for.',
    similarity: 'How closely the overall wording matches the job (TF-IDF cosine similarity), scaled 0–100.',
    semantic: 'How closely the meaning of the resume’s work lines matches the job’s lines, from a small sentence-embedding model (MiniLM). Catches work described in different words.',
    evidence: 'Bullets with measurable results, bullets that start with action verbs, and skills shown in real work rather than only listed.',
    quality: 'Structure checks: contact details, standard sections, sensible length, measurable bullets.',
  };

  /* ---------------------------------------------------------------- utils */
  async function api(path, body, method) {
    const opt = body instanceof FormData ? { method: 'POST', body }
      : body ? { method: method || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : method ? { method } : {};
    const r = await fetch(path, opt);
    if (!r.ok) {
      let d = r.statusText;
      try { const j = await r.json(); d = typeof j.detail === 'string' ? j.detail : (j.detail?.[0]?.msg || d); } catch (e) { }
      throw new Error(d);
    }
    return path.endsWith('export') ? r.text() : r.json();
  }

  function toast(msg, err, action) {
    let host = $('toasts');
    if (!host) { host = Object.assign(document.createElement('div'), { id: 'toasts', className: 'toasts' });
      host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    while (host.children.length >= 3) host.firstChild.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = `${I(err ? 'alert' : 'check')}<span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action.label)}</button>` : ''}<i class="toast-timer"></i>`;
    if (action) t.querySelector('.toast-act').onclick = () => { action.run(); t.remove(); };
    host.appendChild(t);
    const life = action ? 6000 : 3400;
    t.querySelector('.toast-timer').style.animationDuration = `${life}ms`;
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, life);
  }

  const tip = t => `<button type="button" class="tip" data-tip="${esc(t)}" aria-label="${esc(t)}">${I('info', 14)}</button>`;
  const pill = k => `<span class="pill ${VERD[k].cls}"><i class="dot"></i>${VERD[k].label}</span>`;
  const bar = (v, c) => `<div class="bar"><i style="width:${Math.max(2, Math.min(100, v || 0))}%;${c ? `background:${c}` : ''}"></i></div>`;
  const scoreColor = v => v >= 74 ? 'var(--green)' : v >= 62 ? 'var(--teal)' : v >= 48 ? 'var(--amber)' : 'var(--red)';

  function ring(v, size = 64, stroke = 7, color, label) {
    const r = (size - stroke) / 2, c = size / 2, val = Math.max(0, Math.min(100, v || 0));
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Score ${val}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
      <circle class="ring-arc" cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color || scoreColor(val)}" stroke-width="${stroke}"
        stroke-linecap="round" pathLength="100" stroke-dasharray="${val.toFixed(1)} 100" transform="rotate(-90 ${c} ${c})"/>
      <text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" fill="var(--text)" font-size="${size * 0.28}"
        font-weight="700" ${label === undefined ? 'data-count' : ''}>${label ?? Math.round(val)}</text></svg>`;
  }

  const candName = c => S.blind ? c.label : (c.name_guess || c.label);
  const initials = c => S.blind ? c.id : (c.name_guess || c.label).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const avatar = (c, i) => `<span class="avatar" style="--av:${AV[(parseInt(c.id.slice(1)) - 1) % AV.length]}">${esc(initials(c))}</span>`;

  function ago(iso) {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    const units = [[86400 * 30, 'month'], [86400 * 7, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [n, u] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? 's' : ''} ago`; }
  }

  async function loadJobs() {
    const r = await api('/api/jobs');
    S.jobs = r.jobs; S.jobMeta = { statuses: r.statuses, employment_types: r.employment_types };
    return S.jobs;
  }
  const jobById = id => (S.jobs || []).find(j => j.id === +id);
  const stPill = st => `<span class="pill ${ST[st].cls}"><i class="dot"></i>${esc(st)}</span>`;

  async function samples() {
    if (!S.samples) S.samples = await api('/api/samples');
    return S.samples;
  }

  function animate() {
    const page = $('page');
    page.classList.add('enter');
    page.querySelectorAll('.anim').forEach((n, i) => n.style.setProperty('--i', Math.min(i, 12)));
    if (reduced) return;
    animateCounts(document);
  }
  function animateCounts(root) {
    if (reduced) return;
    root.querySelectorAll('[data-count]').forEach(n => {
      if (n.dataset.done) return;
      n.dataset.done = '1';
      const target = parseFloat(n.textContent); if (isNaN(target)) return;
      const t0 = performance.now(), dur = 900;
      const step = now => { const p = Math.min((now - t0) / dur, 1); n.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }

  /* ---------------------------------------------------------------- routing */
  const ROUTES = {
    overview: { title: 'Overview', crumb: 'Hiring' },
    jobs: { title: 'Job library', crumb: 'Company workspace' },
    screen: { title: 'Screen candidates', crumb: 'Recruiter workspace' },
    improve: { title: 'Improve a resume', crumb: 'Candidate workspace' },
    model: { title: 'Model quality', crumb: 'Model' },
    method: { title: 'How scoring works', crumb: 'Model' },
  };
  const route = () => (location.hash.replace(/^#\//, '') || 'overview').split('/')[0];

  function render(anim = true) {
    const r = ROUTES[route()] ? route() : 'overview';
    // A new page starts at the top; re-renders of the same page keep their place.
    if (S.lastRoute !== r) { S.lastRoute = r; window.scrollTo(0, 0); }
    document.querySelectorAll('.nav a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r));
    $('crumbs').innerHTML = `<span class="crumb-sec">${esc(ROUTES[r].crumb)} ${I('chevronRight', 14)}</span> <b>${esc(ROUTES[r].title)}</b>`;
    $('top-actions').innerHTML = topActions(r);
    const page = $('page');
    page.classList.remove('enter');
    page.innerHTML = r === 'overview' ? overviewPage() : r === 'jobs' ? jobsPage()
      : r === 'screen' ? (S.screen ? screenResults() : screenSetup())
      : r === 'improve' ? (S.imp.result ? improveResults() : improveSetup()) : r === 'model' ? modelPage() : method();
    navTags();
    document.title = `${ROUTES[r].title} · Resume Intelligence`;
    $('shell').classList.remove('menu');
    renderOverlays();
    if (anim) animate();
    if (S.jobs === null && !S.jobsLoading) {
      S.jobsLoading = true;
      loadJobs().then(() => { S.jobsLoading = false; if (['overview', 'jobs', 'screen', 'improve'].includes(route()) && !S.editor) render(['jobs', 'overview'].includes(route())); else navTags(); })
        .catch(e => { S.jobsLoading = false; S.jobs = []; toast(e.message, true); });
    }
  }

  function topActions(r) {
    if (r === 'jobs') return '';
    if (r === 'screen' && S.screen) return `
      <button class="btn btn-sm btn-ghost" data-act="edit-inputs" title="Edit inputs">${I('arrowLeft', 15)}<span class="lbl">Edit inputs</span></button>
      <button class="btn btn-sm" data-act="dl-labels" title="Download your verdict labels" ${labelStats().n ? '' : 'disabled'}>${I('check', 15)}<span class="lbl">Labels${labelStats().n ? ` (${labelStats().n})` : ''}</span></button>
      <button class="btn btn-sm" data-act="export" title="Export CSV">${I('download', 15)}<span class="lbl">Export CSV</span></button>`;
    if (r === 'improve' && S.imp.result) return `
      <button class="btn btn-sm btn-ghost" data-act="imp-reset" title="New analysis">${I('arrowLeft', 15)}<span class="lbl">New analysis</span></button>`;
    if (r === 'overview') return `<button class="btn btn-sm btn-primary" data-act="demo-screen" title="Run a sample screening">${I('play', 15)}<span class="lbl">Run a sample screening</span></button>`;
    if (r === 'model') return `<a class="btn btn-sm btn-ghost" href="#/method" title="How scoring works">${I('scale', 15)}<span class="lbl">How scoring works</span></a>`;
    return `<a class="btn btn-sm btn-ghost" href="#/method" title="How it works">${I('help', 15)}<span class="lbl">How it works</span></a>`;
  }

  /* ---------------------------------------------------------------- screen: setup */
  function screenSetup() {
    const ready = S.job.text.trim().length > 20 && S.resumes.length;
    return `
    <section class="hero anim">
      <h1>Screen a stack of resumes in seconds, with a reason for every decision.</h1>
      <p>Paste a job description and drop in resumes. Each candidate gets a verdict, the evidence behind it,
        the risks to check and interview questions written for them. Names are hidden by default.</p>
      <div class="row">
        <button class="btn btn-white" data-act="demo-screen">${I('play', 15)} Try with sample data</button>
        <a class="btn" href="#/method">${I('scale', 15)} How scoring works</a>
      </div>
      <svg class="hero-art" width="230" height="150" viewBox="0 0 230 150" aria-hidden="true">
        ${[0, 1, 2].map(i => `<g transform="translate(${i * 18},${i * 14})" opacity="${0.45 + i * 0.27}">
          <rect width="170" height="96" rx="14" fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.35)"/>
          <circle cx="26" cy="28" r="11" fill="rgba(255,255,255,.55)"/>
          <rect x="46" y="20" width="80" height="7" rx="3.5" fill="rgba(255,255,255,.7)"/>
          <rect x="46" y="32" width="54" height="6" rx="3" fill="rgba(255,255,255,.4)"/>
          <rect x="16" y="56" width="138" height="6" rx="3" fill="rgba(255,255,255,.25)"/>
          <rect x="16" y="56" width="${[96, 120, 70][i]}" height="6" rx="3" fill="#fff"/>
          <rect x="16" y="72" width="44" height="12" rx="6" fill="rgba(255,255,255,.35)"/></g>`).join('')}
      </svg>
    </section>

    <div class="grid g2" style="margin-top:18px">
      <section class="card anim">
        <div class="card-head"><div><h2><span class="step-n ${S.job.text.trim().length > 20 ? 'done' : ''}">${S.job.text.trim().length > 20 ? I('check', 14) : 1}</span>Job description</h2>
          <p>Pick a saved role from your job library, or paste a one-off advert. Must-haves are detected automatically.</p></div></div>
        <div class="card-body">
          <div class="row picker" style="margin-bottom:10px">
            ${jobSelect('job-pick', S.job.id, 'Paste or upload a one-off job')}
            <button class="btn btn-sm btn-ghost" data-act="upload-job">${I('upload', 14)} Upload</button>
          </div>
          <textarea id="job-text" placeholder="Paste the job description here, or pick a saved job above…" aria-label="Job description">${esc(S.job.text)}</textarea>
          <div id="job-link" class="job-link">${jobLink()}</div>
        </div>
      </section>

      <section class="card anim">
        <div class="card-head"><div><h2><span class="step-n ${S.resumes.length ? 'done' : ''}">${S.resumes.length ? I('check', 14) : 2}</span>Resumes</h2>
          <p>PDF, DOCX or TXT, up to 50 at once. Scanned PDFs need selectable text.</p></div></div>
        <div class="card-body">
          <div class="drop" data-drop="multi" data-act="upload-multi" tabindex="0" role="button" aria-label="Upload resumes">
            <span class="hic">${I('upload', 22)}</span>
            <b>Drop resumes here or click to browse</b>
            <span class="small muted">or <a href="#" data-act="sample-resumes">use 6 fictional sample resumes</a></span>
          </div>
          ${S.resumes.length > 1 ? `<div class="row" style="justify-content:space-between;margin-top:12px"><span class="small muted">${S.resumes.length} resumes ready</span><button class="btn btn-sm btn-ghost" data-act="rm-all-resumes">${I('trash', 14)} Remove all</button></div>` : ''}
          <div class="files">${S.resumes.map((r, i) => `
            <div class="file">${I('fileText')}<span>${esc(r.name)}</span><span class="tiny muted" style="flex:none">${r.words || r.text.split(/\s+/).length} words</span>
              <button class="icon-btn" style="width:28px;height:28px" data-act="rm-resume" data-i="${i}" aria-label="Remove ${esc(r.name)}">${I('x', 14)}</button></div>`).join('')}</div>
        </div>
      </section>
    </div>

    <div class="cta-bar anim">
      <div class="row"><span class="hic">${I('users')}</span>
        <div><b>${ready ? `Ready to screen ${S.resumes.length} candidate${S.resumes.length > 1 ? 's' : ''}` : 'Add a job description and at least one resume'}</b>
          <div class="small muted">Takes a second. Resumes are analysed in memory and never stored.</div></div></div>
      <button class="btn btn-lg btn-grad" data-act="run-screen" ${ready ? '' : 'disabled'}>${I('spark', 16)} Screen candidates</button>
    </div>`;
  }

  /* ---------------------------------------------------------------- screen: results */
  function filtered() {
    const q = S.q.toLowerCase();
    return S.screen.candidates.filter(c => !q || [candName(c), c.file, ...c.skills.filter(s => s.status !== 'missing').map(s => s.skill)]
      .join(' ').toLowerCase().includes(q));
  }

  function screenResults() {
    const d = S.screen, j = d.job, n = d.candidates.length;
    return `
    <div class="page-head anim">
      <div><h1>${esc((d.job_id && S.job.name) || j.title || 'Screening results')}</h1>
        <div class="row" style="margin-top:8px">
          ${d.job_id ? `<a class="chip outline" href="#/jobs">${I('folder', 13)}From job library</a>` : ''}
          ${j.seniority ? `<span class="chip">${I('briefcase', 13)}${esc(j.seniority)}</span>` : ''}
          ${j.min_years ? `<span class="chip">${I('clock', 13)}${j.min_years}+ years</span>` : ''}
          ${j.education ? `<span class="chip">${I('cap', 13)}${esc(j.education)}</span>` : ''}
          <span class="chip">${I('target', 13)}${j.must_units.length} must-haves</span>
          <span class="chip">${I('plus', 13)}${j.nice_units.length} nice-to-haves</span>
        </div></div>
    </div>
    ${pipelineBar(d.counts, n, false, true)}

    <div class="toolbar">
      <div class="seg tabseg" role="tablist" aria-label="Results view">
        ${RTABS.map(([v, ic, l, k]) =>
          `<button role="tab" aria-selected="${S.view === v}" class="${S.view === v ? 'on' : ''}" data-act="view" data-v="${v}" title="${l} (${k})">${I(ic, 15)} ${l}</button>`).join('')}
      </div>
      <label class="search" ${['insights', 'fairness'].includes(S.view) ? 'hidden' : ''}>${I('search', 15)}<input type="search" id="q" placeholder="Search name, file or skill" value="${esc(S.q)}"></label>
      <label class="switch" title="Hide names to reduce bias"><input type="checkbox" id="blind" ${S.blind ? 'checked' : ''}><i></i>Blind screening</label>
      <span style="flex:1"></span>
      ${flagged().length ? `<button class="chip flag-chip" data-act="show-flagged">${I('anomaly', 13)}${flagged().length} flagged</button>` : ''}
      <button class="btn btn-sm ${S.weights ? 'btn-tuned' : ''}" data-act="tune" aria-pressed="${!!S.tune}">${I('scale', 14)} ${S.weights ? 'Custom weights' : 'Tune weights'}</button>
    </div>
    <div id="results">${resultsView()}</div>`;
  }

  function ccard(c, i) {
    const shown = c.skills.filter(s => s.importance === 'must' && s.status === 'shown').slice(0, 3);
    const miss = c.skills.filter(s => s.importance === 'must' && s.status === 'missing').length;
    return `<article class="ccard ${S.compare.has(c.id) ? 'sel' : ''} ${S.dealt ? 'dealt' : ''}" data-cand="${c.id}" style="--i:${S.dealt ? c.rank : i}" tabindex="0" aria-label="${esc(candName(c))}, score ${Math.round(c.score)}, ${esc(c.verdict.label)}">
      <div class="ccard-top">${avatar(c)}<div class="who"><b>${esc(candName(c))}${deltaChip(c)}</b><span>${esc(c.file)}</span></div><button class="ring-btn" data-act="explain" data-id="${c.id}" data-tip="Explain this score">${ring(c.score, 44, 5)}</button></div>
      ${c.integrity?.suspicious ? `<div class="flag">${I('anomaly', 13)}Possible keyword stuffing</div>` : ''}
      ${c.close_call ? `<div class="flag close" data-tip="Scores well but misses several must-haves: often someone from a neighbouring field">${I('eye', 13)}Close call: worth a look</div>` : ''}
      <div class="meta"><span>${I('target', 13)}${c.summary.must_matched}/${S.screen.job.must_units.length} must</span>
        <span>${I('clock', 13)}${c.summary.years != null ? c.summary.years + ' yrs' : 'n/a'}</span>
        <span>${I('gauge', 13)}${c.confidence.level}</span></div>
      <div class="chips">${shown.map(s => `<span class="chip shown">${esc(s.matched || s.skill)}</span>`).join('')}
        ${miss ? `<span class="chip missing">${miss} missing</span>` : ''}</div>
      <div class="row" style="margin-top:10px;justify-content:space-between">
        <span class="tiny muted">#${c.rank}${labelOf(c) ? ` · <span class="lab-dot ${agrees(c) ? 'ok' : 'no'}" data-tip="${agrees(c) ? 'You agreed with this verdict' : 'You disagreed with this verdict'}">${I(agrees(c) ? 'check' : 'x', 11)}</span>` : ''}${pipeOf(c).stage !== 'New' ? ` · <span class="stage-chip" style="--c:${STAGE_C[pipeOf(c).stage]}">${esc(pipeOf(c).stage)}</span>` : ''}${pipeOf(c).notes.length ? ` · ${I('note', 11)}${pipeOf(c).notes.length}` : ''}</span>
        <button class="cmp-check ${S.compare.has(c.id) ? 'on' : ''}" data-act="cmp" data-id="${c.id}" aria-label="Compare">${I('check', 13)}</button>
      </div></article>`;
  }

  function board() {
    const list = filtered();
    return `<div class="board">${Object.keys(VERD).map(k => {
      const items = list.filter(c => c.verdict.key === k);
      const cc = k === 'reject' ? items.filter(c => c.close_call).length : 0;
      return `<div class="col"><div class="col-head">${pill(k)}${cc ? `<span class="cc-n" data-tip="${cc} close call${cc > 1 ? 's' : ''} worth a look">${I('eye', 12)}${cc}</span>` : ''}<span class="n">${items.length}</span></div>
        ${items.map((c, i) => ccard(c, i)).join('') || '<div class="empty-col">No candidates here</div>'}</div>`;
    }).join('')}</div>`;
  }

  function table() {
    const list = filtered();
    return `<section class="card" style="overflow:hidden"><div style="overflow-x:auto"><table class="tbl"><thead><tr>
      <th>#</th><th>Candidate</th><th>Score</th><th>Verdict</th><th>Stage</th><th class="num">Must-haves</th><th class="num">Years</th><th>Top risk</th><th></th>
      </tr></thead><tbody>${list.map(c => `<tr data-cand="${c.id}">
        <td class="muted">${c.rank}${deltaChip(c)}</td>
        <td><div class="row" style="flex-wrap:nowrap">${avatar(c)}<div><b>${esc(candName(c))}</b>${c.integrity?.suspicious ? ` <span class="flag inline" data-tip="Possible keyword stuffing">${I('anomaly', 12)}</span>` : ''}${c.close_call ? ` <span class="flag inline close" data-tip="Close call: worth a look">${I('eye', 12)}</span>` : ''}<div class="tiny muted">${esc(c.file)}</div></div></div></td>
        <td><div class="scorecell"><b>${Math.round(c.score)}</b>${bar(c.score, scoreColor(c.score))}</div></td>
        <td>${pill(c.verdict.key)}</td>
        <td><span class="stage-chip" style="--c:${STAGE_C[pipeOf(c).stage]}">${esc(pipeOf(c).stage)}</span></td>
        <td class="num">${c.summary.must_matched}/${S.screen.job.must_units.length}</td>
        <td class="num">${c.summary.years ?? '—'}</td>
        <td class="small" style="max-width:280px">${esc(c.risks[0] || '—')}</td>
        <td><button class="cmp-check ${S.compare.has(c.id) ? 'on' : ''}" data-act="cmp" data-id="${c.id}" aria-label="Compare">${I('check', 13)}</button></td>
      </tr>`).join('')}</tbody></table></div></section>`;
  }

  function heatmap() {
    const cs = S.screen.candidates;
    return `<table><thead><tr><th class="rowh">Must-have</th>${cs.map(c => `<th title="${esc(candName(c))}">${esc(S.blind ? c.id : initials(c))}</th>`).join('')}<th>Pool</th></tr></thead>
      <tbody>${S.screen.skill_coverage.map(sc => `<tr><th class="rowh">${esc(sc.skill)}</th>
        ${cs.map(c => { const row = c.skills.find(s => s.skill === sc.skill); const st = row ? row.status : 'missing';
          return `<td class="${st}" data-tip="${esc(candName(c))}: ${st === 'shown' ? 'shown in work' : st === 'listed' ? 'listed only' : st === 'related' ? 'described, not named' : 'missing'}"></td>`; }).join('')}
        <td class="small muted" style="width:auto;padding-left:8px;white-space:nowrap">${sc.have}/${sc.of}</td></tr>`).join('')}</tbody></table>`;
  }

  /* ---------------------------------------------------------------- drawer */
  function drawer() {
    const c = S.screen.candidates.find(x => x.id === S.drawer);
    if (!c) return '';
    const tab = (k, label, icon) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-t="${k}">${I(icon, 14)}${label}</button>`;
    let body = '';
    if (S.tab === 'overview') body = `
      ${labelBox(c)}
      <div class="decision"><span class="hic" style="background:color-mix(in srgb, ${VERD[c.verdict.key].c} 14%, transparent);color:${VERD[c.verdict.key].c}">${I(VERD[c.verdict.key].icon, 18)}</span>
        <div><h3>${esc(c.verdict.label)}</h3><p>${esc(c.verdict.next)}</p>
          ${c.verdict.knockouts.length ? `<div class="chips" style="margin-top:8px">${c.verdict.knockouts.map(k => `<span class="chip missing">${I('alert', 12)}${esc(k)}</span>`).join('')}</div>` : ''}
          ${c.close_call ? `<div class="chips" style="margin-top:8px"><span class="chip close-chip">${I('eye', 12)}Close call: worth a quick look before declining</span></div>` : ''}</div></div>
      ${c.integrity?.flags?.length ? `<div class="integrity"><div class="row" style="justify-content:space-between"><b>${I('anomaly', 15)} Integrity checks</b><span class="small">−${c.integrity.penalty} points</span></div>
        <ul>${c.integrity.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <p class="small">These patterns usually mean a resume was written for screening software. Read it yourself before deciding.</p></div>` : ''}
      <div class="sec-title">Why</div>
      <ul class="list good">${c.strengths.map(s => `<li>${I('check')}${esc(s)}</li>`).join('') || '<li class="muted">No clear strengths against this job.</li>'}</ul>
      <div class="sec-title">Risks to check</div>
      <ul class="list bad">${c.risks.filter(s => !s.startsWith('Integrity:') && !s.startsWith('Close call:')).map(s => `<li>${I('alert')}${esc(s)}</li>`).join('') || '<li class="muted">No notable risks.</li>'}</ul>
      <div class="sec-title">Score breakdown</div>
      ${c.parts.filter(p => p.value !== null).map(p => `<div class="part"><span>${esc(p.label)} ${tip(PART_TIPS[p.key] || '')}<span class="w">weight ${Math.round(+curWeights()[p.key] || p.weight)}</span></span>
        ${bar(p.value, scoreColor(p.value))}<span>${Math.round(p.value)}</span></div>`).join('')}
      <div class="note" style="margin-top:16px">${I('info')}<div>Decision support only. Read the resume and talk to the person before rejecting anyone.
        ${esc(c.confidence.note)}</div></div>`;
    if (S.tab === 'skills') {
      const grp = imp => c.skills.filter(s => s.importance === imp);
      const chipsFor = rows => rows.map(s => `<span class="chip ${s.status}" data-tip="${s.status === 'shown' ? 'Shown in a job or project bullet' : s.status === 'listed' ? 'Only in the skills list' : s.status === 'related' ? esc('Work described without naming the tool: "' + (s.evidence || '') + '"') : 'Not found'}"><i class="dot"></i>${esc(s.skill)}</span>`).join('');
      body = `
      <div class="legend" style="margin-bottom:6px"><span><i style="background:var(--green)"></i>Shown in work</span><span><i style="background:var(--amber)"></i>Listed only</span><span><i style="background:transparent;box-shadow:inset 0 0 0 1px var(--amber)"></i>Described, not named</span><span><i style="background:var(--red)"></i>Missing</span></div>
      <div class="sec-title">Must-have (${c.summary.must_matched}/${grp('must').length})</div><div class="chips">${chipsFor(grp('must'))}</div>
      <div class="sec-title">Nice-to-have (${c.summary.nice_matched}/${grp('nice').length})</div><div class="chips">${chipsFor(grp('nice')) || '<span class="muted small">None in this job</span>'}</div>
      <div class="sec-title">Other skills on the resume</div>
      ${Object.entries(c.extra_skills).map(([cat, list]) => `<div style="margin-bottom:10px"><div class="tiny muted" style="margin-bottom:6px">${esc(cat)}</div><div class="chips">${list.map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>`).join('') || '<span class="muted small">Nothing beyond the job’s list</span>'}`;
    }
    if (S.tab === 'evidence') body = evidenceTab(c);
    if (S.tab === 'notes') body = notesTab(c);
    if (S.tab === 'interview') body = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px"><span class="small muted">Questions written from this candidate’s gaps and claims.</span>
        <button class="btn btn-sm" data-act="copy-qs">${I('copy', 14)} Copy all</button></div>
      <div class="stack" style="gap:10px">${c.questions.map((q, i) => `<div class="q"><div class="row"><span class="chip outline">${esc(q.topic)}</span><span class="tiny muted">${esc(q.why)}</span></div>
        <p>${esc(q.question)}</p></div>`).join('')}</div>`;
    if (S.tab === 'feedback') body = `
      <p class="small muted" style="margin-bottom:12px">Constructive points you can share with the candidate, whatever the decision.</p>
      <div class="stack" style="gap:10px">${c.suggestions.slice(0, 4).map((s, i) => `<div class="fix" style="--i:${i}"><span class="n">${i + 1}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></div><span></span></div>`).join('')}</div>
      <button class="btn btn-sm" style="margin-top:12px" data-act="copy-fb">${I('copy', 14)} Copy as message</button>`;

    return `<div class="scrim" data-act="close-drawer"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Candidate detail">
      <div class="drawer-head">
        <div class="row">
          <div class="row" style="flex-wrap:nowrap">${avatar(c)}<div><h2>${esc(candName(c))}</h2><div class="small muted">${esc(c.file)} · rank #${c.rank} of ${S.screen.candidates.length}</div></div></div>
          <div class="row" style="gap:2px;flex-wrap:nowrap">
            <button class="icon-btn" data-act="drawer-step" data-d="-1" title="Previous candidate (←)" aria-label="Previous candidate" ${c.rank === 1 ? 'disabled' : ''}>${I('chevronLeft')}</button>
            <button class="icon-btn" data-act="drawer-step" data-d="1" title="Next candidate (→)" aria-label="Next candidate" ${c.rank === S.screen.candidates.length ? 'disabled' : ''}>${I('chevronRight')}</button>
            <button class="icon-btn" data-act="close-drawer" aria-label="Close (Esc)">${I('x')}</button></div>
        </div>
        <div class="row" style="margin-top:16px;gap:16px"><button class="ring-btn" data-act="tab" data-t="evidence" data-tip="Explain this score">${ring(c.score, 76, 8)}</button>
          <div class="stack" style="gap:6px"><div class="row" style="gap:6px">${pill(c.verdict.key)}<span class="stage-chip" style="--c:${STAGE_C[pipeOf(c).stage]}">${esc(pipeOf(c).stage)}</span>${deltaChip(c)}</div><span class="small muted">${I('gauge', 13)} Confidence: <b>${c.confidence.level}</b></span>
            <span class="small muted">${I('target', 13)} ${c.summary.must_matched}/${S.screen.job.must_units.length} must-haves · ${c.summary.years ?? '—'} yrs · ${c.summary.quantified} measurable bullets</span></div></div>
        <div class="tabs">${tab('overview', 'Decision', 'scale')}${tab('evidence', 'Explain', 'search')}${tab('skills', 'Skills', 'target')}${tab('notes', `Notes${pipeOf(c).notes.length ? ` ${pipeOf(c).notes.length}` : ''}`, 'note')}${tab('interview', 'Interview', 'message')}${tab('feedback', 'Feedback', 'wand')}</div>
      </div>
      <div class="drawer-body">${body}</div>
    </aside>`;
  }

  function compareModal() {
    const cs = S.screen.candidates.filter(c => S.compare.has(c.id));
    const best = (fn, hi = true) => { const vals = cs.map(fn); const b = hi ? Math.max(...vals) : Math.min(...vals); return vals.map(v => v === b); };
    const row = (label, cells, wins) => `<div class="cmp-row"><div>${label}</div>${cells.map((x, i) => `<div class="${wins && wins[i] ? 'win' : ''}">${x}</div>`).join('')}</div>`;
    const partRows = cs[0].parts.filter(p => p.value !== null).map(p => row(esc(p.label),
      cs.map(c => Math.round(c.parts.find(x => x.key === p.key).value)), best(c => c.parts.find(x => x.key === p.key).value)));
    return `<div class="modal-scrim" data-act="close-compare"><div class="modal" role="dialog" aria-label="Compare candidates">
      <div class="card-head" style="padding:20px 22px 6px"><div><h2><span class="hic">${I('compare')}</span>Compare candidates</h2><p>Best value in each row is highlighted.</p></div>
        <button class="icon-btn" data-act="close-compare" aria-label="Close">${I('x')}</button></div>
      <div class="cmp" style="--n:${cs.length}">
        <div class="cmp-row head"><div></div>${cs.map(c => `<div><div class="row" style="flex-wrap:nowrap">${avatar(c)}<b>${esc(candName(c))}</b></div></div>`).join('')}</div>
        ${row('Score', cs.map(c => `<b>${Math.round(c.score)}</b>`), best(c => c.score))}
        ${row('Verdict', cs.map(c => pill(c.verdict.key)))}
        ${row('Must-haves', cs.map(c => `${c.summary.must_matched}/${S.screen.job.must_units.length}`), best(c => c.summary.must_matched))}
        ${row('Years', cs.map(c => c.summary.years ?? '—'), best(c => c.summary.years ?? -1))}
        ${row('Education', cs.map(c => esc(c.summary.education || '—')))}
        ${partRows.join('')}
        ${row('Top strength', cs.map(c => `<span class="small">${esc(c.strengths[0] || '—')}</span>`))}
        ${row('Top risk', cs.map(c => `<span class="small">${esc(c.risks[0] || '—')}</span>`))}
      </div></div></div>`;
  }

  function renderOverlays() {
    document.querySelectorAll('.ov').forEach(n => n.remove());
    const add = html => { if (!html) return; const d = document.createElement('div'); d.className = 'ov'; d.innerHTML = html; document.body.appendChild(d); };
    if (route() === 'screen' && S.screen) {
      if (S.drawer) add(drawer());
      if (S.compare.size >= 2 && !S.drawer) add(`<div class="dock">${I('compare', 15)} ${S.compare.size} selected
        <button class="btn btn-sm btn-primary" data-act="open-compare">Compare</button>
        <button class="btn btn-sm btn-ghost" style="color:#fff" data-act="clear-compare">Clear</button></div>`);
      if (S.compareOpen) add(compareModal());
    }
    if (S.tune && route() === 'screen' && S.screen) add(tunePanel());
    if (S.detail) add(detailModal());
    if (S.run) add(runOverlay());
    if (S.palette) add(paletteModal());
    if (S.shortcuts) add(shortcutsModal());
    if (S.editor) add(editorModal());
    if (S.confirm) add(confirmModal());
    document.body.classList.toggle('modal-open', !!(S.editor || S.confirm || S.palette || S.shortcuts || S.run || S.detail));
    if (S.drawer && S.drawer !== S.lastDrawer) { if (S.lastDrawer) document.querySelector('.drawer')?.classList.add('no-slide'); animate(); }
    else document.querySelectorAll('.ov [data-count], .ov .ring-arc').forEach(n => { n.dataset.done = '1'; n.style.animation = 'none'; });
    S.lastDrawer = S.drawer;
  }

  /* ---------------------------------------------------------------- job library */
  function jobSelect(id, current, blank, openOnly) {
    const jobs = (S.jobs || []).filter(j => !openOnly || j.status !== 'Closed');
    const groups = S.jobMeta.statuses.filter(st => st !== 'Closed' || !openOnly).map(st => {
      const list = jobs.filter(j => j.status === st);
      return list.length ? `<optgroup label="${esc(st)}">${list.map(j => `<option value="${j.id}" ${+current === j.id ? 'selected' : ''}>${esc(j.title)}${j.department && !j.title.includes(j.department) ? ` · ${esc(j.department)}` : ''}</option>`).join('')}</optgroup>` : '';
    }).join('');
    return `<label class="select-wrap">${I('folder', 15)}<select id="${id}" aria-label="Pick a job from the library">
      <option value="">${S.jobs === null ? 'Loading job library…' : esc(blank)}</option>${groups}</select></label>`;
  }

  function jobLink() {
    if (S.job.id) {
      const j = jobById(S.job.id);
      return `<span class="small muted">${I('folder', 13)} Saved job${j ? ` · ${esc(j.status)}` : ''}. Screening adds to its counts in the library.</span>
        <button class="btn btn-sm btn-ghost" data-act="edit-job" data-id="${S.job.id}">${I('edit', 14)} Edit job</button>`;
    }
    if (S.job.text.trim().length > 40) return `<span class="small muted">${I('info', 13)} One-off job, not saved.</span>
        <button class="btn btn-sm btn-ghost" data-act="save-to-library">${I('plus', 14)} Save to job library</button>`;
    return '';
  }

  function jobsList() {
    const q = S.jobQ.toLowerCase();
    return (S.jobs || []).filter(j => (S.jobFilter === 'All' || j.status === S.jobFilter)
      && (!q || [j.title, j.department, j.location, j.hiring_manager, ...j.summary.must, ...j.summary.nice].join(' ').toLowerCase().includes(q)));
  }

  function jobsPage() {
    if (S.jobs === null) return `<div class="page-head"><div><h1>Job library</h1><p>Loading…</p></div></div>
      <div class="jobs-grid">${[0, 1, 2].map(() => '<div class="sk" style="height:260px"></div>').join('')}</div>`;
    const all = S.jobs, open = all.filter(j => j.status === 'Open');
    const sum = k => all.reduce((a, j) => a + (j[k] || 0), 0);
    const kpi = (k, label, v, c, help, dk) => `<div class="kpi anim clickable" style="--c:${c}" ${kpiAttrs(dk, label)}><div class="k">${I(k, 16)}${label}<span class="kpi-go">${I('chevronRight', 14)}</span></div><div class="v" data-count>${v}</div>${help ? `<div class="kpi-sub">${esc(help)}</div>` : ''}</div>`;
    const count = st => st === 'All' ? all.length : all.filter(j => j.status === st).length;
    return `
    <div class="page-head anim">
      <div><h1>Job library</h1><p>Every role the company is hiring for, in one place. Save a job description once, edit it as the role changes,
        and screen new applicants against it in one click.</p></div>
      <button class="btn btn-grad" data-act="new-job">${I('plus', 16)} New job</button>
    </div>
    <div class="kpis k4">
      ${kpi('briefcase', 'Open roles', open.length, 'var(--c-blue)', `${all.length} in the library`, 'open')}
      ${kpi('users', 'Open positions', open.reduce((a, j) => a + j.openings, 0), 'var(--c-violet)', 'Headcount still to fill', 'positions')}
      ${kpi('fileText', 'Resumes screened', sum('candidates_screened'), 'var(--c-teal)', 'Counts only, never the resumes', 'screened')}
      ${kpi('star', 'Shortlisted', sum('shortlisted'), 'var(--c-pink)', `${pct(sum('shortlisted'), sum('candidates_screened'))}% of screened`, 'rate')}
    </div>
    <div class="toolbar">
      <div class="seg" role="tablist">${['All', ...S.jobMeta.statuses].map(st => `<button class="${S.jobFilter === st ? 'on' : ''}" data-act="job-filter" data-f="${esc(st)}">${esc(st)}<span class="seg-n">${count(st)}</span></button>`).join('')}</div>
      <label class="search">${I('search', 15)}<input type="search" id="jq" placeholder="Search title, team, location or skill" value="${esc(S.jobQ)}"></label>
    </div>
    <div id="jobs-results">${jobsGrid()}</div>
    <div class="note anim" style="margin-top:18px">${I('lock')}<div><b>What is saved:</b> job descriptions and, for each job, how many resumes were screened and shortlisted.
      Resumes and candidate details are never stored. <span class="muted">Demo note: on the free hosting plan the library resets to the sample roles when the server restarts.</span></div></div>`;
  }

  function jobsGrid() {
    const list = jobsList();
    if (!list.length) return `<div class="empty-state card">${I('folder', 28)}<b>${S.jobs.length ? 'No jobs match' : 'Your job library is empty'}</b>
      <p class="small muted">${S.jobs.length ? 'Try another filter or search.' : 'Add the roles you are hiring for, then screen candidates against them.'}</p>
      ${S.jobs.length ? '' : `<button class="btn btn-primary" data-act="new-job">${I('plus', 15)} New job</button>`}</div>`;
    return `<div class="jobs-grid">${list.map((j, i) => jobCard(j, i)).join('')}</div>`;
  }

  function jobCard(j, i) {
    const m = j.summary, more = m.must.length - 5;
    const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
    return `<article class="jcard anim ${j.status === 'Closed' ? 'closed' : ''}" style="--i:${i}">
      <div class="jtop">
        <span class="hic">${I('briefcase')}</span>
        <div class="jtitle"><h3><a href="#" data-act="edit-job" data-id="${j.id}">${esc(j.title)}</a></h3>
          <div class="small muted">${[j.department, j.location].filter(Boolean).map(esc).join(' · ') || 'No team or location yet'}</div></div>
        ${stPill(j.status)}
      </div>
      <div class="jmeta">
        <span>${I('clock', 13)}${m.min_years ? `${m.min_years}+ yrs` : 'Any experience'}</span>
        <span>${I('users', 13)}${j.openings} opening${j.openings > 1 ? 's' : ''}</span>
        <span>${I('calendar', 13)}${esc(j.employment_type)}</span>
        ${m.seniority ? `<span>${I('gauge', 13)}${esc(m.seniority)}</span>` : ''}
      </div>
      <div class="jreq"><div class="tiny muted">${m.must.length} must-haves · ${m.nice.length} nice-to-haves</div>
        <div class="chips">${m.must.slice(0, 5).map(s => `<span class="chip">${esc(s)}</span>`).join('')}${more > 0 ? `<span class="chip outline">+${more} more</span>` : ''}
          ${m.must.length ? '' : `<span class="chip missing">${I('alert', 12)}No requirements found</span>`}</div></div>
      <div class="jstats">${stat(j.screenings, 'screenings')}${stat(j.candidates_screened, 'screened')}${stat(j.shortlisted, 'shortlisted')}</div>
      <div class="tiny muted jwhen">${j.last_screened_at ? `Last screened ${ago(j.last_screened_at)}` : 'Not screened yet'}${j.hiring_manager ? ` · Manager: ${esc(j.hiring_manager)}` : ''}</div>
      <div class="jactions">
        <button class="btn btn-sm btn-primary" data-act="screen-job" data-id="${j.id}" ${j.status === 'Closed' ? 'disabled title="Reopen the job to screen"' : ''}>${I('users', 14)} Screen</button>
        <span style="flex:1"></span>
        <select class="status-sel" data-job-status="${j.id}" aria-label="Status of ${esc(j.title)}">${S.jobMeta.statuses.map(st => `<option ${st === j.status ? 'selected' : ''}>${esc(st)}</option>`).join('')}</select>
        <button class="icon-btn" data-act="edit-job" data-id="${j.id}" data-tip="Edit" aria-label="Edit">${I('edit', 16)}</button>
        <button class="icon-btn" data-act="dup-job" data-id="${j.id}" data-tip="Duplicate" aria-label="Duplicate">${I('copy', 16)}</button>
        <button class="icon-btn danger" data-act="del-job" data-id="${j.id}" data-tip="Delete" aria-label="Delete">${I('trash', 16)}</button>
      </div>
    </article>`;
  }

  function previewHtml(p) {
    if (!p || (!p.must.length && !p.nice.length && !p.min_years)) return `
      <div class="sec-title" style="margin-top:0">What the screener will check</div>
      <div class="ed-empty">${I('target', 22)}<p class="small muted">Paste the description and the must-haves, nice-to-haves and minimum experience will appear here as you type.</p></div>
      <div class="note" style="margin-top:12px">${I('info')}<div>Tip: put essentials under a <b>Requirements</b> heading and extras under <b>Nice to have</b>. Write “Power BI or Tableau” when either will do.</div></div>`;
    const warn = !p.must.length ? 'No must-haves detected. Add a “Requirements” heading with one skill per line.'
      : p.must.length > 14 ? `${p.must.length} must-haves is a lot: few candidates will match them all. Move the extras under “Nice to have”.` : '';
    return `
      <div class="sec-title" style="margin-top:0">What the screener will check</div>
      <div class="ed-stats">
        <div><span>Experience</span><b>${p.min_years ? `${p.min_years}+ years` : 'Not set'}</b></div>
        <div><span>Education</span><b>${esc(p.education || 'Not set')}</b></div>
        <div><span>Level</span><b>${esc(p.seniority || '—')}</b></div>
      </div>
      <div class="tiny muted" style="margin:14px 0 6px">Must-have (${p.must.length})</div>
      <div class="chips">${p.must.map(s => `<span class="chip shown"><i class="dot"></i>${esc(s)}</span>`).join('') || '<span class="small muted">None yet</span>'}</div>
      <div class="tiny muted" style="margin:14px 0 6px">Nice-to-have (${p.nice.length})</div>
      <div class="chips">${p.nice.map(s => `<span class="chip"><i class="dot"></i>${esc(s)}</span>`).join('') || '<span class="small muted">None</span>'}</div>
      ${warn ? `<div class="note warn" style="margin-top:14px">${I('alert')}<div>${esc(warn)}</div></div>` : ''}`;
  }

  function editorModal() {
    const e = S.editor, f = e.f;
    const opt = (arr, v) => arr.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
    const inp = (k, label, ph = '', cls = '') => `<label class="fld ${cls}"><span class="label">${label}</span>
      <input type="text" data-f="${k}" value="${esc(f[k] || '')}" placeholder="${esc(ph)}" maxlength="120"></label>`;
    return `<div class="modal-scrim" data-act="close-editor"><div class="modal modal-form" role="dialog" aria-modal="true" aria-label="${e.id ? 'Edit job' : 'New job'}">
      <div class="modal-head"><div><h2><span class="hic">${I('briefcase')}</span>${e.id ? 'Edit job' : 'New job'}</h2>
        <p>${e.id ? `Last updated ${ago(jobById(e.id)?.updated_at) || ''}. Changes apply to future screenings.` : 'Saved to the company job library, ready to screen candidates against.'}</p></div>
        <button class="icon-btn" data-act="close-editor" aria-label="Close">${I('x')}</button></div>
      <div class="editor">
        <div class="ed-form">
          <div class="fgrid">
            ${inp('title', 'Job title *', 'e.g. Senior Data Engineer', 'span2')}
            <label class="fld"><span class="label">Openings</span><input type="number" data-f="openings" min="1" max="999" value="${esc(f.openings || 1)}"></label>
            ${inp('department', 'Department', 'e.g. Data Platform')}
            ${inp('location', 'Location', 'e.g. Pune · Hybrid')}
            ${inp('hiring_manager', 'Hiring manager', 'Name')}
            <label class="fld"><span class="label">Employment type</span><select data-f="employment_type">${opt(S.jobMeta.employment_types, f.employment_type)}</select></label>
            <div class="fld span2"><span class="label">Status</span><div class="seg">${S.jobMeta.statuses.map(st => `<button type="button" class="${f.status === st ? 'on' : ''}" data-act="ed-status" data-s="${esc(st)}">${I(ST[st].icon, 14)}${esc(st)}</button>`).join('')}</div></div>
          </div>
          <div class="fld" style="margin-top:14px"><div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="label" style="margin:0">Job description *</span>
            <button type="button" class="btn btn-sm btn-ghost" data-act="upload-editor">${I('upload', 14)} Upload file</button></div>
            <textarea data-f="description" placeholder="Paste the full advert: About the role, Responsibilities, Requirements, Nice to have…">${esc(f.description || '')}</textarea></div>
        </div>
        <aside class="ed-preview" id="ed-preview">${previewHtml(e.preview)}</aside>
      </div>
      <div class="modal-foot"><span class="small err-text" id="ed-err"></span>
        <button class="btn btn-ghost" data-act="close-editor">Cancel</button>
        <button class="btn btn-grad" data-act="save-job">${I('check', 15)} ${e.id ? 'Save changes' : 'Save job'}</button></div>
    </div></div>`;
  }

  function confirmModal() {
    const c = S.confirm;
    return `<div class="modal-scrim" data-act="close-confirm"><div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-label="Delete job">
      <div class="confirm"><span class="hic danger">${I('trash', 18)}</span>
        <div><h2>Delete “${esc(c.title)}”?</h2><p class="small muted" style="margin-top:6px">The job description and its screening counts are removed from the library. This can’t be undone.
          ${c.status !== 'Closed' ? 'If the role is filled, you can set it to <b>Closed</b> instead and keep the history.' : ''}</p></div></div>
      <div class="modal-foot">${c.status !== 'Closed' ? `<button class="btn btn-ghost" data-act="close-instead" data-id="${c.id}">${I('archive', 15)} Close instead</button>` : ''}
        <span style="flex:1"></span><button class="btn" data-act="close-confirm">Cancel</button>
        <button class="btn btn-danger" data-act="confirm-delete" data-id="${c.id}">${I('trash', 15)} Delete job</button></div>
    </div></div>`;
  }

  let previewTimer = null, previewSeq = 0;
  async function refreshPreview(now) {
    clearTimeout(previewTimer);
    const run = async () => {
      if (!S.editor) return;
      const seq = ++previewSeq;
      try {
        const p = await api('/api/jobs/preview', { description: S.editor.f.description || '' });
        if (!S.editor || seq !== previewSeq) return;
        S.editor.preview = p;
        const box = $('ed-preview'); if (box) box.innerHTML = previewHtml(p);
      } catch (e) { }
    };
    if (now) return run();
    previewTimer = setTimeout(run, 350);
  }

  function openEditor(job, origin) {
    const f = job ? { ...job } : { title: '', department: '', location: '', employment_type: 'Full-time', status: 'Open', hiring_manager: '', openings: 1, description: '' };
    S.editor = { id: job?.id || null, f, preview: job?.summary || null, origin };
    renderOverlays();
    if (!job?.summary) refreshPreview(true);
    setTimeout(() => document.querySelector('.modal-form [data-f="title"]')?.focus(), 60);
  }

  async function saveJob() {
    const e = S.editor, f = e.f, err = $('ed-err');
    const fail = m => { if (err) err.textContent = m; };
    if (!String(f.title || '').trim()) return fail('Add a job title.');
    if (String(f.description || '').trim().length < 40) return fail('Add the job description (at least a few lines).');
    const body = {};
    ['title', 'department', 'location', 'employment_type', 'status', 'hiring_manager', 'description'].forEach(k => body[k] = String(f[k] ?? ''));
    body.openings = Math.max(1, Math.min(999, parseInt(f.openings) || 1));
    const btn = document.querySelector('[data-act="save-job"]'); if (btn) { btn.disabled = true; btn.classList.add('busy'); }
    try {
      const saved = e.id ? await api(`/api/jobs/${e.id}`, body, 'PUT') : await api('/api/jobs', body);
      await loadJobs();
      if (e.origin === 'screen' || S.job.id === saved.id) S.job = { id: saved.id, name: saved.title, text: saved.description };
      S.editor = null;
      toast(e.id ? 'Job updated' : 'Job saved to the library');
      render(false);
    } catch (x) { fail(x.message); if (btn) { btn.disabled = false; btn.classList.remove('busy'); } }
  }

  function useJob(j) { S.job = { id: j.id, name: j.title, text: j.description }; }

  /* ---------------------------------------------------------------- improve */
  function improveSetup() {
    const ready = S.imp.resume.text.trim().length > 20 && S.imp.job.trim().length > 20;
    return `
    <section class="hero anim">
      <h1>See your resume the way a screening tool does, and what to fix first.</h1>
      <p>Get your match score for a specific job, the fixes that raise it most, rewrites for weak bullets
        and a what-if simulator. Honest advice only: it never tells you to claim skills you don't have.</p>
      <div class="row"><button class="btn btn-white" data-act="demo-improve">${I('play', 15)} Try with a sample</button></div>
    </section>
    <div class="grid g2" style="margin-top:18px">
      <section class="card anim">
        <div class="card-head"><div><h2><span class="step-n ${S.imp.resume.text.trim().length > 20 ? 'done' : ''}">${S.imp.resume.text.trim().length > 20 ? I('check', 14) : 1}</span>Your resume</h2>
          <p>${S.imp.resume.name ? esc(S.imp.resume.name) : 'Upload a PDF, DOCX or TXT, or paste the text.'}</p></div>
          <button class="btn btn-sm" data-act="upload-imp">${I('upload', 14)} Upload</button></div>
        <div class="card-body"><textarea id="imp-resume" placeholder="Paste your resume text…" aria-label="Resume">${esc(S.imp.resume.text)}</textarea></div>
      </section>
      <section class="card anim">
        <div class="card-head"><div><h2><span class="step-n ${S.imp.job.trim().length > 20 ? 'done' : ''}">${S.imp.job.trim().length > 20 ? I('check', 14) : 2}</span>Target job</h2>
          <p>The job you are applying for. Advice is specific to it.</p></div>
</div>
        <div class="card-body"><div class="row picker" style="margin-bottom:10px">${jobSelect('imp-job-pick', S.imp.jobId, 'Pick an open role, or paste one below', true)}</div>
          <textarea id="imp-job" placeholder="Paste the job description…" aria-label="Job description">${esc(S.imp.job)}</textarea></div>
      </section>
    </div>
    <div class="cta-bar anim">
      <div class="row"><span class="hic">${I('wand')}</span><div><b>${ready ? 'Ready to analyse' : 'Add your resume and the job description'}</b>
        <div class="small muted">Your text is analysed in memory and never stored.</div></div></div>
      <button class="btn btn-lg btn-grad" data-act="run-improve" ${ready ? '' : 'disabled'}>${I('spark', 16)} Analyse my resume</button>
    </div>`;
  }

  function improveResults() {
    const r = S.imp.result, base = S.imp.base;
    const delta = base != null ? Math.round((r.score - base) * 10) / 10 : 0;
    const top3 = r.suggestions.filter(s => s.kind !== 'skill' || S.imp.assume.has(s.members?.[0])).slice(0, 3);
    const potential = Math.min(100, Math.round(r.score + r.suggestions.filter(s => s.kind !== 'skill').slice(0, 3).reduce((a, s) => a + s.gain, 0)));
    const missing = r.skills.filter(s => s.status === 'missing' || s.status === 'related' || S.imp.assume.has(s.members[0]));
    return `
    <div class="grid g-side">
      <div class="stack">
        <section class="card card-pad anim">
          <div class="score-hero">
            <div style="position:relative">${ring(r.score, 132, 12)}</div>
            <div>
              <div class="row"><span class="small muted">Match score for</span><b>${esc((S.imp.jobId && jobById(S.imp.jobId)?.title) || r.job.title || 'this job')}</b>
                ${delta ? `<span class="delta ${delta < 0 ? 'neg' : ''}">${delta > 0 ? '+' : ''}${delta} from what-if</span>` : ''}</div>
              <h1 style="margin-top:6px;font-size:21px">A recruiter's tool would mark this <span style="color:${VERD[r.verdict.key].c}">${esc(r.verdict.label.toLowerCase())}</span>.</h1>
              <p class="small muted" style="margin-top:6px">${r.summary.must_matched} of ${r.job.must_units.length} must-haves · ${r.summary.years ?? 'no dated'} years · ${r.summary.quantified} of ${r.summary.bullets} bullets measurable</p>
              ${potential > r.score ? `<div class="note" style="margin-top:12px">${I('trendUp')}<div>Fixing the top three writing issues below could take you to about <b>${potential}</b>, without adding any new skills.</div></div>` : ''}
            </div>
          </div>
          <div class="sec-title">Score breakdown</div>
          ${r.parts.filter(p => p.value !== null).map(p => `<div class="part"><span>${esc(p.label)} ${tip(PART_TIPS[p.key])}<span class="w">weight ${p.weight}%</span></span>${bar(p.value, scoreColor(p.value))}<span>${Math.round(p.value)}</span></div>`).join('')}
        </section>

        <section class="card anim">
          <div class="card-head"><div><h2><span class="hic">${I('target')}</span>Fix these first</h2><p>Ordered by how much each change should raise your score.</p></div></div>
          <div class="card-body stack" style="gap:10px">${r.suggestions.map((s, i) => `<div class="fix" style="--i:${i}"><span class="n">${i + 1}</span>
            <div><div class="row"><h3>${esc(s.title)}</h3><span class="prio ${s.priority}">${s.priority}</span></div><p>${esc(s.detail)}</p></div>
            <span class="gain">${s.gain > 0 ? `+${s.gain}` : ''}</span></div>`).join('') || '<p class="muted">Nothing major to fix. Nice work.</p>'}</div>
        </section>

        ${r.rewrites.length ? `<section class="card anim">
          <div class="card-head"><div><h2><span class="hic">${I('wand')}</span>Rewrite your weakest bullets</h2><p>A stronger opening and a slot for the result. Fill the brackets with your real numbers.</p></div></div>
          <div class="card-body stack" style="gap:10px">${r.rewrites.map(w => `<div class="rw"><div class="before">${esc(w.before)}</div>
            <div class="after">${I('arrowRight')}<span>${esc(w.after)}</span></div>
            <div><button class="btn btn-sm btn-ghost" data-act="copy" data-text="${esc(w.after)}">${I('copy', 13)} Copy</button></div></div>`).join('')}</div>
        </section>` : ''}
      </div>

      <div class="stack">
        <section class="card anim">
          <div class="card-head"><div><h2><span class="hic">${I('spark')}</span>What-if simulator</h2><p>Tick skills you genuinely have but left off. The score updates live.</p></div></div>
          <div class="card-body">
            <div class="chips">${missing.map(s => `<button class="chip ${S.imp.assume.has(s.members[0]) ? 'on' : 'outline'}" data-act="assume" data-s="${esc(s.members[0])}">
              ${S.imp.assume.has(s.members[0]) ? I('check', 12) : I('plus', 12)}${esc(s.skill)}</button>`).join('') || '<span class="small muted">No missing skills for this job.</span>'}</div>
            <div class="note" style="margin-top:12px">${I('info')}<div>Only add skills you can discuss in an interview. Show each one in a bullet about real work.</div></div>
          </div>
        </section>
        <section class="card anim">
          <div class="card-head"><div><h2><span class="hic">${I('check')}</span>Skill match</h2></div></div>
          <div class="card-body">
            <div class="tiny muted" style="margin-bottom:6px">Must-have</div>
            <div class="chips">${r.skills.filter(s => s.importance === 'must').map(s => `<span class="chip ${s.status}"><i class="dot"></i>${esc(s.skill)}</span>`).join('')}</div>
            <div class="tiny muted" style="margin:12px 0 6px">Nice-to-have</div>
            <div class="chips">${r.skills.filter(s => s.importance === 'nice').map(s => `<span class="chip ${s.status}"><i class="dot"></i>${esc(s.skill)}</span>`).join('') || '<span class="small muted">None listed</span>'}</div>
          </div>
        </section>
        <section class="card anim">
          <div class="card-head"><div><h2><span class="hic">${I('search')}</span>Job keywords you don’t use</h2><p>Mirror the job’s language where it is true for you.</p></div></div>
          <div class="card-body"><div class="chips">${r.keywords.map(k => `<span class="chip outline">${esc(k)}</span>`).join('') || '<span class="small muted">Good coverage.</span>'}</div></div>
        </section>
        <section class="card anim">
          <div class="card-head"><div><h2><span class="hic">${I('shield')}</span>ATS readiness</h2><p>Basics that screening software checks.</p></div>
            <b>${r.ats.filter(a => a.ok).length}/${r.ats.length}</b></div>
          <div class="card-body">${r.ats.map(a => `<div class="check">${a.ok ? `<span class="ok">${I('check')}</span>` : `<span class="no">${I('x')}</span>`}${esc(a.check)}</div>`).join('')}</div>
        </section>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- method */
  function method() {
    if (!S.model && !S.modelLoading) loadModel();
    const W = S.model ? S.model.weights.map(w => [w.label, w.weight]).sort((a, b) => b[1] - a[1])
      : [['Must-have skills', 34], ['Experience', 14], ['Meaning match', 12], ['Evidence of impact', 11], ['Nice-to-have skills', 9], ['Keyword relevance', 8], ['Resume quality', 7], ['Education', 5]];
    const wmax = Math.max(...W.map(w => w[1]));
    return `
    <div class="page-head anim"><div><h1>How scoring works</h1><p>Every number on screen can be traced to a rule below. No black box, no personal data used.</p></div></div>
    <div class="grid g2">
      <section class="card anim"><div class="card-head"><div><h2><span class="hic">${I('scale')}</span>What the score is made of</h2><p>Weights out of 100. Parts that don’t apply (e.g. no education requirement) are left out and the rest re-weighted.</p></div></div>
        <div class="card-body weights">${W.map(([l, w]) => `<div class="weight"><span>${esc(l)}</span>${bar(w / wmax * 100)}<b>${Math.round(w)}%</b></div>`).join('')}</div></section>
      <section class="card anim"><div class="card-head"><div><h2><span class="hic">${I('check')}</span>How a verdict is reached</h2></div></div>
        <div class="card-body stack" style="gap:10px">
          ${[['strong', 'Score 74+, at most 30% of must-haves missing, experience met'], ['shortlist', 'Score 62+ and at most a third of must-haves missing'],
             ['verify', 'Score 48+: borderline, worth a short call'], ['reject', 'More than half the must-haves missing, or score below 48']]
            .map(([k, t]) => `<div class="row" style="flex-wrap:nowrap">${pill(k)}<span class="small">${t}</span></div>`).join('')}
        </div></section>
      <section class="card anim"><div class="card-head"><div><h2><span class="hic">${I('target')}</span>Reading the job</h2></div></div>
        <div class="card-body"><ul class="list good">
          <li>${I('check')}Skills under “Requirements” are must-haves; under “Nice to have”, or in a sentence with “preferred”, “bonus” or “a plus”, they are nice-to-haves.</li>
          <li>${I('check')}“Power BI or Tableau” is one requirement: either skill satisfies it.</li>
          <li>${I('check')}96 skills and 259 aliases (sklearn → Scikit-learn, Postgres → PostgreSQL). Specific tools imply broader skills (PostgreSQL → SQL).</li>
          <li>${I('check')}Minimum years and education are read from phrases like “3+ years of experience” and “Bachelor’s degree”.</li></ul></div></section>
      <section class="card anim"><div class="card-head"><div><h2><span class="hic">${I('fileText')}</span>Reading the resume</h2></div></div>
        <div class="card-body"><ul class="list good">
          <li>${I('check')}A skill shown in a job or project bullet counts fully; only in the skills list it counts 70%; work described without naming the tool (“orchestrated DAG workflows” for Airflow) counts 40%.</li>
          <li>${I('check')}Integrity checks catch lines copied from the job, bullets that cram in every tool, and years claimed far above the dated roles. See <a href="#/model">Model quality</a>.</li>
          <li>${I('check')}Meaning match: a small language model (MiniLM) compares each line of the job with the resume’s work lines, so “orchestrated DAG workflows” counts towards Airflow even without the word.</li>
          <li>${I('check')}Years come from dated roles with overlaps merged, so two parallel jobs are not double counted.</li>
          <li>${I('check')}Evidence rewards measurable results and bullets that start with an action verb.</li>
          <li>${I('check')}Every suggestion’s “+points” is measured by re-scoring your resume with that one fix applied.</li></ul></div></section>
      <section class="card anim" style="grid-column:1/-1"><div class="card-head"><div><h2><span class="hic">${I('shield')}</span>Fairness, privacy and limits</h2></div></div>
        <div class="card-body grid g3">
          <div><b>Blind by default</b><p class="small muted" style="margin-top:4px">Names are hidden behind candidate IDs. Name, gender, age, photo and address are never used in scoring.</p></div>
          <div><b>Resumes never stored</b><p class="small muted" style="margin-top:4px">Resumes are read in memory, analysed and discarded. Only the company’s job library is saved, with screening counts, never candidate data.</p></div>
          <div><b>Decision support, not a decision</b><p class="small muted" style="margin-top:4px">Keyword-style scoring misses context: career changers, unusual titles, scanned PDFs. A person should review every rejection.</p></div>
        </div></section>
    </div>`;
  }

  /* ---------------------------------------------------------------- shared charts */
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const ORDER = ['strong', 'shortlist', 'verify', 'reject'];

  function navTags() {
    const set = (id, v) => { const n = $(id); if (n) { n.textContent = v ?? ''; n.hidden = v == null || v === ''; } };
    set('nav-jobs', S.jobs ? S.jobs.filter(j => j.status === 'Open').length : null);
    set('nav-screen', S.screen ? S.screen.candidates.length : null);
    set('nav-model', S.model?.evaluation ? `κ ${S.model.evaluation.kappa.toFixed(2)}` : null);
  }

  const flagged = () => (S.screen?.candidates || []).filter(c => c.integrity?.suspicious);
  const RTABS = [['board', 'board', 'Board', '1'], ['table', 'table', 'Ranked list', '2'], ['pipeline', 'layers', 'Pipeline', '3'],
    ['insights', 'segments', 'Insights', '4'], ['fairness', 'scale', 'Fairness', '5']];
  const resultsView = () => ({ insights, table, pipeline: pipelineView, fairness: fairnessView }[S.view] || board)();

  /* The verdict pipeline: one stacked bar, 2px surface gaps, labelled legend below. */
  function pipelineBar(counts, n, compact, head) {
    if (!n) return '';
    const segs = ORDER.filter(k => counts[k]), sl = (counts.strong || 0) + (counts.shortlist || 0);
    return `<section class="pipe anim ${compact ? 'compact' : ''}" aria-label="Verdict mix">
      ${head ? `<div class="pipe-head"><div class="ph" ${kpiAttrs('pool', 'Candidates screened')}><b data-count>${n}</b><span>candidates screened</span></div><div class="ph" ${kpiAttrs('short', 'On the shortlist')}><b>${sl}</b><span>on the shortlist (${pct(sl, n)}%)</span></div>
        ${flagged().length ? `<div class="ph warn" ${kpiAttrs('flags', 'Integrity flags')}><b>${flagged().length}</b><span>flagged for integrity</span></div>` : ''}
        ${S.weights ? `<span class="chip tuned-chip">${I('scale', 12)} Ranked with your custom weights</span>` : ''}</div>` : ''}
      <div class="pipe-bar" role="img" aria-label="${ORDER.map(k => `${VERD[k].label} ${counts[k] || 0}`).join(', ')}">
        ${segs.map((k, i) => `<i style="flex:${counts[k]};background:${VERD[k].m};--i:${i}" data-tip="${VERD[k].label}: ${counts[k]} of ${n} (${pct(counts[k], n)}%)"></i>`).join('')}
      </div>
      <div class="pipe-legend">${ORDER.map(k => `<span ${head ? kpiAttrs(k, VERD[k].label) : ''}><i style="background:${VERD[k].m}"></i>${VERD[k].label}<b>${counts[k] || 0}</b><em>${pct(counts[k] || 0, n)}%</em></span>`).join('')}</div>
    </section>`;
  }

  /* Score distribution: 10-point bins, single series, verdict thresholds as hairlines. */
  function histogram(cands) {
    const W = 560, H = 200, padL = 28, padB = 26, padT = 30, bins = Array.from({ length: 10 }, () => []);
    cands.forEach(c => bins[Math.min(9, Math.floor(c.score / 10))].push(c));
    const max = Math.max(1, ...bins.map(b => b.length)), step = (W - padL) / 10, bw = Math.min(24, step - 8);
    const y = v => padT + (H - padT - padB) * (1 - v / max), x = s => padL + s / 100 * (W - padL);
    const ticks = [...new Set([0, Math.ceil(max / 2), max])];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Score distribution">
      ${ticks.map(t => `<line x1="${padL}" x2="${W}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${padL - 8}" y="${y(t)}" class="axis" text-anchor="end" dominant-baseline="middle">${t}</text>`).join('')}
      ${[48, 62, 74].map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="10" y2="${H - padB}" class="thr"/><text x="${x(v)}" y="6" class="axis small-axis" text-anchor="middle">${v}</text>`).join('')}
      ${bins.map((b, i) => { if (!b.length) return ''; const h = H - padB - y(b.length), cx = padL + step * i + (step - bw) / 2;
        return `<g class="hbar" style="--i:${i}" data-tip="${i * 10}–${i * 10 + 9}: ${b.length} candidate${b.length > 1 ? 's' : ''} (${b.map(c => esc(candName(c))).join(', ')})">
          <rect x="${padL + step * i}" y="${padT}" width="${step}" height="${H - padT - padB}" fill="transparent"/>
          <path d="M${cx},${H - padB} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z" fill="var(--iris)"/>
          <text x="${cx + bw / 2}" y="${y(b.length) - 6}" class="val" text-anchor="middle">${b.length}</text></g>`; }).join('')}
      <line x1="${padL}" x2="${W}" y1="${H - padB}" y2="${H - padB}" class="base"/>
      ${[0, 20, 40, 60, 80, 100].map(v => `<text x="${x(v)}" y="${H - 8}" class="axis" text-anchor="middle">${v}</text>`).join('')}
    </svg>`;
  }

  function coverageBars(cov) {
    const rows = [...cov].sort((a, b) => a.have / a.of - b.have / b.of);
    return `<div class="cov">${rows.map((r, i) => { const p = pct(r.have, r.of);
      return `<div class="cov-row" style="--i:${i}" data-tip="${esc(r.skill)}: ${r.have} of ${r.of} candidates show or list it">
        <span class="cov-name">${esc(r.skill)}</span>
        <span class="cov-track"><i style="width:${Math.max(p, 1.5)}%"></i></span>
        <b>${r.have}/${r.of}</b>${p === 0 ? `<span class="cov-warn">${I('alert', 12)}Nobody</span>` : ''}</div>`; }).join('')}</div>`;
  }

  function insights() {
    const d = S.screen, cs = d.candidates, n = cs.length;
    const avg = cs.reduce((a, c) => a + c.score, 0) / n;
    const sorted = cs.map(c => c.score).sort((a, b) => a - b), med = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const gaps = d.skill_coverage.filter(s => s.have === 0).map(s => s.skill);
    const thin = d.skill_coverage.filter(s => s.have > 0 && s.have / s.of < 0.34).map(s => s.skill);
    const fl = flagged(), related = cs.reduce((a, c) => a + (c.summary.must_related || 0), 0);
    const reco = [];
    if (gaps.length) reco.push(['alert', `Nobody in the pool has ${gaps.slice(0, 3).join(', ')}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ''}. Consider moving ${gaps.length > 1 ? 'these' : 'it'} to nice-to-have, or plan to train for ${gaps.length > 1 ? 'them' : 'it'}.`]);
    if (thin.length) reco.push(['trendDown', `${thin.slice(0, 3).join(', ')} ${thin.length > 1 ? 'are' : 'is'} rare in this pool. Ask about ${thin.length > 1 ? 'them' : 'it'} early in phone screens.`]);
    const ccs = cs.filter(c => c.close_call);
    if (ccs.length) reco.push(['eye', `${ccs.length} candidate${ccs.length > 1 ? 's are close calls' : ' is a close call'}: “Not a fit” but scoring well, often from a neighbouring field. Give ${ccs.length > 1 ? 'them' : 'it'} a quick look before declining.`]);
    if (fl.length) reco.push(['anomaly', `${fl.length} resume${fl.length > 1 ? 's' : ''} look${fl.length > 1 ? '' : 's'} written for screening software. Read ${fl.length > 1 ? 'them' : 'it'} before deciding.`]);
    if (related) reco.push(['compass', `${related} must-have match${related > 1 ? 'es are' : ' is'} described without naming the tool. The interview kit asks which tool was used.`]);
    if ((d.counts.strong + d.counts.shortlist) === 0) reco.push(['help', 'No one reached the shortlist. The bar may be set too high for this market, or the advert may need more applicants.']);
    if (!reco.length) reco.push(['check', 'The pool covers the must-haves well. Start with the strong shortlist.']);
    return `<div class="insights">
      <div class="stats4">
        <div class="stat anim clickable" style="--c:var(--c-violet)" ${kpiAttrs('avg', 'details')}><span class="sic">${I('gauge', 16)}</span><span>Average score</span><b data-count>${Math.round(avg)}</b><em>median ${Math.round(med)}</em></div>
        <div class="stat anim clickable" style="--c:var(--c-green)" ${kpiAttrs('short', 'details')}><span class="sic">${I('star', 16)}</span><span>Shortlist rate</span><b>${pct(d.counts.strong + d.counts.shortlist, n)}%</b><em>${d.counts.strong + d.counts.shortlist} of ${n} candidates</em></div>
        <div class="stat anim clickable" style="--c:var(--c-pink)" ${kpiAttrs('gaps', 'details')}><span class="sic">${I('target', 16)}</span><span>Must-haves nobody has</span><b data-count>${gaps.length}</b><em>of ${d.skill_coverage.length} requirements</em></div>
        <div class="stat anim clickable" style="--c:var(--c-orange)" ${kpiAttrs('flags', 'details')}><span class="sic">${I('anomaly', 16)}</span><span>Integrity flags</span><b data-count>${fl.length}</b><em>${fl.length ? 'read before deciding' : 'no stuffing detected'}</em></div>
      </div>
      <div class="grid g2">
        <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-violet)">${I('trendUp', 16)}</span>Score distribution</h2><p>Candidates per 10-point band. Lines mark the verdict thresholds: 48 Interview to verify, 62 Shortlist, 74 Strong shortlist.</p></div></div>
          <div class="card-body">${histogram(cs)}</div></section>
        <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-amber)">${I('compass', 16)}</span>What to do next</h2><p>Read from this pool's gaps and flags.</p></div></div>
          <div class="card-body"><ul class="reco">${reco.map(([ic, t], i) => `<li style="--i:${i}"><span class="hic">${I(ic, 15)}</span><span>${esc(t)}</span></li>`).join('')}</ul></div></section>
        <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-teal)">${I('target', 16)}</span>Must-have coverage</h2><p>Share of candidates who show or list each requirement, rarest first.</p></div></div>
          <div class="card-body">${coverageBars(d.skill_coverage)}</div></section>
        <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-orange)">${I('anomaly', 16)}</span>Integrity checks</h2><p>Copied job text, crammed bullets and inflated years. Flagged resumes stop at <b>Interview to verify</b>.</p></div></div>
          <div class="card-body">${fl.length ? `<div class="stack" style="gap:8px">${fl.map(c => `<button class="flag-row" data-cand="${c.id}">${avatar(c)}<div><b>${esc(candName(c))}</b>
            <div class="small muted">${c.integrity.flags.map(esc).join(' · ')}</div></div><span class="small">−${c.integrity.penalty}</span></button>`).join('')}</div>`
            : `<div class="empty-mini">${I('shield', 22)}<b>No integrity flags</b><span class="small muted">No copied job text, crammed bullets or inflated experience in this pool.</span></div>`}</div></section>
      </div>
      ${agreementCard()}
      <section class="card anim" style="margin-top:16px">
        <div class="card-head"><div><h2><span class="hic" style="--c:var(--c-blue)">${I('layers', 16)}</span>Skill heatmap</h2><p>Every candidate against every must-have. Hover a cell for detail.</p></div>
          <div class="legend"><span><i style="background:var(--green)"></i>Shown in work</span><span><i style="background:color-mix(in srgb,var(--amber) 55%,transparent)"></i>Listed only</span><span><i style="background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--amber) 45%,transparent) 0 3px,var(--surface-3) 3px 6px)"></i>Described, not named</span><span><i style="background:var(--surface-3)"></i>Missing</span></div></div>
        <div class="card-body heat">${heatmap()}</div>
      </section>
    </div>`;
  }

  /* ---------------------------------------------------------------- overview */
  function overviewPage() {
    const jobs = S.jobs || [], open = jobs.filter(j => j.status === 'Open');
    const screened = jobs.reduce((a, j) => a + (j.candidates_screened || 0), 0), short = jobs.reduce((a, j) => a + (j.shortlisted || 0), 0);
    const kpi = (k, label, v, sub, c, suffix = '', dk) => `<div class="kpi anim clickable" style="--c:${c}" ${kpiAttrs(dk, label)}><div class="k">${I(k, 16)}${label}<span class="kpi-go">${I('chevronRight', 14)}</span></div><div class="v"><span data-count>${v}</span>${suffix}</div><div class="kpi-sub">${sub}</div></div>`;
    const tot = { strong: 0, shortlist: 0, verify: 0, reject: 0 };
    S.activity.forEach(a => ORDER.forEach(k => tot[k] += a.counts[k]));
    const sessN = S.activity.reduce((a, x) => a + x.n, 0), ev = S.model?.evaluation;
    if (!S.model && !S.modelLoading) loadModel();
    return `
    <div class="page-head anim"><div><h1>Hiring overview</h1>
      <p>Open roles, screening activity and how far you can trust the screener, on one page.</p></div></div>
    <div class="kpis k4">
      ${kpi('briefcase', 'Open roles', open.length, `${jobs.length} in the library`, 'var(--c-blue)', '', 'open')}
      ${kpi('users', 'Positions to fill', open.reduce((a, j) => a + j.openings, 0), 'across open roles', 'var(--c-violet)', '', 'positions')}
      ${kpi('fileText', 'Resumes screened', screened, 'all time, counts only', 'var(--c-teal)', '', 'screened')}
      ${kpi('star', 'Shortlist rate', pct(short, screened), `${short} shortlisted`, 'var(--c-pink)', '%', 'rate')}
    </div>
    <div class="grid g-ov" style="margin-top:16px">
      <div class="stack">
        <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-teal)">${I('users', 16)}</span>This session</h2><p>Screenings you run here. Nothing about candidates is saved.</p></div>
          ${S.activity.length ? `<a class="btn btn-sm" href="#/screen">${I('board', 14)} Open latest</a>` : ''}</div>
          <div class="card-body">${S.activity.length ? `
            ${pipelineBar(tot, sessN, true)}
            <div class="feed">${S.activity.map((a, i) => `<div class="feed-row" style="--i:${i}"><span class="hic">${I('users', 15)}</span>
              <div><b>${esc(a.title)}</b><div class="small muted">${a.n} candidate${a.n > 1 ? 's' : ''} · ${a.counts.strong + a.counts.shortlist} shortlisted${a.flags ? ` · ${a.flags} flagged` : ''}</div></div>
              <span class="tiny muted">${ago(a.at)}</span><button class="icon-btn danger sm" data-act="rm-activity" data-i="${i}" aria-label="Remove from this list">${I('x', 14)}</button></div>`).join('')}</div>
            <button class="btn btn-sm btn-ghost" style="margin-top:8px" data-act="clear-activity">${I('trash', 14)} Clear session list</button>`
            : `<div class="empty-mini big">${I('play', 24)}<b>No screenings yet</b><span class="small muted">Run the sample to see a full ranked board, insights and interview kits in about a second.</span>
              <button class="btn btn-grad" data-act="demo-screen">${I('play', 15)} Run a sample screening</button></div>`}</div></section>
        <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-blue)">${I('briefcase', 16)}</span>Open roles</h2><p>Screen new applicants against a saved job in one click.</p></div>
          <a class="btn btn-sm btn-ghost" href="#/jobs">View library ${I('chevronRight', 14)}</a></div>
          <div class="card-body roles">${S.jobs === null ? '<div class="sk" style="height:140px"></div>' : open.length ? open.slice(0, 5).map((j, i) => `
            <div class="role" style="--i:${i}"><span class="hic">${I('briefcase', 15)}</span>
              <div class="role-main"><b>${esc(j.title)}</b><div class="small muted">${[j.department, j.location].filter(Boolean).map(esc).join(' · ')}</div></div>
              <div class="role-meter" data-tip="${j.shortlisted} shortlisted of ${j.candidates_screened} screened"><span class="cov-track"><i style="width:${Math.max(pct(j.shortlisted, j.candidates_screened), j.candidates_screened ? 2 : 0)}%"></i></span>
                <span class="tiny muted">${j.candidates_screened ? `${j.shortlisted}/${j.candidates_screened} shortlisted` : 'Not screened yet'}</span></div>
              <button class="btn btn-sm" data-act="screen-job" data-id="${j.id}">${I('users', 14)} Screen</button></div>`).join('')
            : `<div class="empty-mini">${I('folder', 22)}<b>No open roles</b><button class="btn btn-sm btn-primary" data-act="new-job">${I('plus', 14)} New job</button></div>`}</div></section>
      </div>
      <div class="stack">
        <section class="card anim model-card"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-green)">${I('shield', 16)}</span>Model health</h2><p>Agreement with ${ev ? ev.n : '…'} human-labelled decisions.</p></div>
          <span class="pill v-strong"><i class="dot"></i>v${esc(S.model?.version || '2.2')}</span></div>
          <div class="card-body">${ev ? `<div class="mh">${ring(ev.kappa * 100, 92, 9, 'var(--iris)', ev.kappa.toFixed(2))}
              <div><b>Weighted kappa</b><p class="small muted">Agreement beyond chance. Above 0.6 is substantial, above 0.8 near-perfect.</p></div></div>
            <div class="mh-grid"><div><span>Accuracy</span><b>${(ev.accuracy * 100).toFixed(0)}%</b></div><div><span>Spearman</span><b>${ev.spearman.toFixed(2)}</b></div>
              <div><span>Stuffers caught</span><b>${ev.stuffers_caught}/${ev.stuffers}</b></div></div>
            <a class="btn btn-sm btn-ghost" style="margin-top:12px" href="#/model">See the full evaluation ${I('chevronRight', 14)}</a>`
            : '<div class="sk" style="height:170px"></div>'}</div></section>
        <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-pink)">${I('bolt', 16)}</span>Quick actions</h2></div></div>
          <div class="card-body qa">
            <button data-act="new-job" style="--c:var(--c-blue)">${I('plus', 16)}<span><b>New job</b><em>Add a role to the library</em></span></button>
            <a href="#/screen" style="--c:var(--c-teal)">${I('users', 16)}<span><b>Screen candidates</b><em>Rank up to 50 resumes</em></span></a>
            <a href="#/improve" style="--c:var(--c-pink)">${I('wand', 16)}<span><b>Improve a resume</b><em>Candidate coaching</em></span></a>
            <button data-act="palette" style="--c:var(--c-violet)">${I('search', 16)}<span><b>Search everything</b><em><span class="kbd">${MOD} K</span></em></span></button>
          </div></section>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- model quality */
  async function loadModel() {
    S.modelLoading = true;
    try { S.model = await api('/api/model'); navTags(); if (['model', 'overview', 'method'].includes(route()) && !S.editor) render(false); }
    catch (e) { toast(e.message, true); } finally { S.modelLoading = false; }
  }

  function modelPage() {
    if (!S.model) { if (!S.modelLoading) loadModel();
      return `<div class="page-head"><div><h1>Model quality</h1><p>Scoring the labelled set…</p></div></div><div class="kpis k4">${[0, 1, 2, 3].map(() => '<div class="sk" style="height:104px"></div>').join('')}</div>`; }
    const m = S.model, ev = m.evaluation, prev = m.history.length > 1 ? m.history[m.history.length - 2] : null;
    const delta = (v, p, fmt, pctp) => p == null ? '' : (() => { const d = v - p; if (Math.abs(d) < 1e-9) return '<em class="flat">no change</em>';
      return `<em class="${d > 0 ? 'up' : 'down'}">${I(d > 0 ? 'trendUp' : 'trendDown', 12)}${d > 0 ? '+' : ''}${pctp ? (d * 100).toFixed(1) + ' pts' : fmt(d)} vs v${prev.version}</em>`; })();
    const tile = (label, val, sub, dl, help, c, ic, dk) => `<div class="mtile anim clickable" style="--c:${c}" ${kpiAttrs(dk, label)}><div class="k">${I(ic, 16)}${label}<span class="kpi-go">${I('chevronRight', 14)}</span></div><div class="v">${val}</div>${dl || ''}<div class="kpi-sub">${sub}</div></div>`;
    if (!ev) return `<div class="page-head"><div><h1>Model quality</h1><p>The labelled evaluation set is not included in this deployment.</p></div></div>`;
    const maxC = Math.max(...ev.confusion.flat());
    const labels = { reject: 'Not a fit', maybe: 'Interview to verify', shortlist: 'Shortlist' };
    return `
    <div class="page-head anim"><div><h1>Model quality</h1>
      <p>How often the screener agrees with a person, measured on ${ev.n} labelled resume–job pairs. Rules, weights and results are all on this page.</p></div>
      <div class="row" style="gap:8px"><span class="pill ${m.model?.semantic?.available ? 'v-strong' : 'v-verify'}"><i class="dot"></i>${m.model?.semantic?.available ? 'Meaning match on' : 'Keyword matching only'}</span>
        <span class="pill v-shortlist"><i class="dot"></i>Engine v${esc(m.version)}</span></div></div>
    <div class="mtiles">
      ${tile('Verdict accuracy', `${(ev.accuracy * 100).toFixed(1)}%`, 'shortlist / maybe / reject', delta(ev.accuracy, prev?.accuracy, null, true), 'Share of pairs where the verdict class matches the human label.', 'var(--c-blue)', 'check', 'm-accuracy')}
      ${tile('Weighted kappa', ev.kappa.toFixed(2), 'agreement beyond chance', delta(ev.kappa, prev?.kappa, d => d.toFixed(2)), 'Cohen’s kappa with linear weights: a one-step miss costs half a two-step miss. 0.61–0.80 is substantial agreement.', 'var(--c-iris)', 'scale', 'm-kappa')}
      ${tile('Spearman rho', ev.spearman.toFixed(2), 'score order vs labels', delta(ev.spearman, prev?.spearman, d => d.toFixed(2)), 'Whether higher scores go to the people a human rated higher.', 'var(--c-violet)', 'trendUp', 'm-spearman')}
      ${tile('Precision at 3', `${Math.round(ev.p_at_3 * 100)}%`, 'top 3 per job worth interviewing', delta(ev.p_at_3, prev?.p_at_3, null, true), 'For each job, the share of the top three candidates a person labelled shortlist or maybe.', 'var(--c-teal)', 'target', 'm-p3')}
      ${tile('Stuffers caught', `${ev.stuffers_caught}/${ev.stuffers}`, 'kept off the shortlist', prev ? delta(ev.stuffers_caught, prev.stuffers_caught, d => `${d}`) : '', 'Resumes that paste the job description or cram every tool into one line.', 'var(--c-orange)', 'shield', 'm-stuffers')}
      ${tile('Good candidates rejected', `${ev.false_rejections}/${ev.good}`, 'labelled shortlist or maybe', '', 'The costliest error for a screener: someone worth talking to who gets Not a fit.', 'var(--c-pink)', 'alert', 'm-fr')}
    </div>
    ${(ev.holdouts || []).length ? `<div class="holdout anim"><span class="hic" style="--c:var(--c-green)">${I('shield', 16)}</span>
      <div><b>On resumes the rules were not designed on</b>
        <div class="ho-rows">${ev.holdouts.map(h => `<div class="ho-row"><span>${esc(h.name)} <em>${h.n} pairs</em></span><b>${(h.accuracy * 100).toFixed(1)}%</b><span class="small muted">kappa ${h.kappa.toFixed(2)} · ${h.false_rejections}/${h.good} good rejected · ${h.stuffers_caught}/${h.stuffers} stuffers caught</span>
          <span class="tiny muted ho-note">${esc(h.note)}</span></div>`).join('')}</div>
        <p class="small muted">These are the fairer numbers. The tiles above use the development set the rules were built on.</p></div></div>` : ''}
    <div class="grid g2" style="margin-top:16px">
      <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-iris)">${I('table', 16)}</span>Confusion matrix</h2><p>Rows are the human label, columns the engine’s verdict. The diagonal is agreement.</p></div></div>
        <div class="card-body"><div class="cm" role="table" aria-label="Confusion matrix">
          <div class="cm-corner small muted">Human ↓ · Engine →</div>${ev.labels.map(l => `<div class="cm-h">${labels[l]}</div>`).join('')}
          ${ev.labels.map((t, i) => `<div class="cm-h row-h">${labels[t]}</div>${ev.confusion[i].map((v, j) => `<div class="cm-c ${i === j ? 'diag' : ''}" style="--a:${maxC ? v / maxC : 0};--i:${i * 3 + j}" data-tip="Human: ${labels[t]} · Engine: ${labels[ev.labels[j]]} · ${v} pair${v === 1 ? '' : 's'}"><b>${v}</b></div>`).join('')}`).join('')}
        </div>
        <p class="small muted" style="margin-top:12px">Most misses are one step apart (a “maybe” the engine shortlists), which is why weighted kappa is higher than raw accuracy suggests.</p></div></section>
      <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-violet)">${I('clock', 16)}</span>Version history</h2><p>Same labelled set, each engine version.</p></div></div>
        <div class="card-body"><div style="overflow-x:auto"><table class="tbl vh"><thead><tr><th>Version</th><th class="num">Accuracy</th><th class="num">Kappa</th><th class="num">Spearman</th><th class="num">P@3</th><th class="num">Stuffers</th></tr></thead>
          <tbody>${[...m.history].reverse().map((h, i) => `<tr class="${i === 0 ? 'cur' : ''}"><td><b>v${esc(h.version)}</b>${i === 0 ? ' <span class="pill v-strong"><i class="dot"></i>current</span>' : ''}</td>
            <td class="num">${(h.accuracy * 100).toFixed(1)}%</td><td class="num">${h.kappa.toFixed(2)}</td><td class="num">${h.spearman.toFixed(2)}</td>
            <td class="num">${Math.round(h.p_at_3 * 100)}%</td><td class="num">${h.stuffers_caught}/${ev.stuffers}</td></tr>`).join('')}</tbody></table></div>
          <ul class="list good" style="margin-top:14px">
            <li>${I('check')}v2.3 added meaning-based matching with a small sentence-embedding model (MiniLM), and weights you can learn from labelled decisions.</li>
            <li>${I('check')}v2.2 added integrity checks, partial credit for work described without tool names, and batch-independent scores.</li></ul></div></section>
      <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-amber)">${I('scale', 16)}</span>Score weights</h2><p>Parts that don’t apply are dropped and the rest re-weighted.</p></div></div>
        <div class="card-body weights">${m.weights.map(w => `<div class="weight"><span>${esc(w.label)}</span>${bar(w.weight / Math.max(...m.weights.map(x => x.weight)) * 100)}<b>${Math.round(w.weight)}%</b></div>`).join('')}
          <div class="credit-row">${[['Shown in a bullet', m.credits.shown, 'shown'], ['Only in the skills list', m.credits.listed, 'listed'], ['Described, not named', m.credits.related, 'related']]
            .map(([l, v, c]) => `<div><span class="chip ${c}"><i class="dot"></i>${Math.round(v * 100)}%</span><span class="small muted">${l}</span></div>`).join('')}</div></div></section>
      <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-orange)">${I('shield', 16)}</span>Integrity rules</h2><p>Each finding costs points (capped at ${m.integrity.cap}) and is shown to the recruiter.</p></div></div>
        <div class="card-body"><div class="rules">
          <div><span class="hic">${I('copy', 15)}</span><div><b>Lines copied from the job</b><p class="small muted">Ignored when scoring, −${m.integrity.penalties.copied} points, verdict capped at Interview to verify.</p></div></div>
          <div><span class="hic">${I('layers', 15)}</span><div><b>One bullet naming ${m.integrity.cram_skills}+ required tools</b><p class="small muted">Those skills count as listed, not shown. −${m.integrity.penalties.crammed} points.</p></div></div>
          <div><span class="hic">${I('clock', 15)}</span><div><b>Years claimed far above dated roles</b><p class="small muted">More than ${m.integrity.years_gap} years over: the dated figure is used. −${m.integrity.penalties.years} points.</p></div></div>
        </div></div></section>
    </div>
    ${trainingCard(m)}
    <section class="card anim" style="margin-top:16px"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-pink)">${I('alert', 16)}</span>Where the engine and the labels disagree</h2><p>${ev.disagreements.length} of ${ev.n} pairs. Each one is a lead for the next improvement.</p></div></div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Resume</th><th>Job</th><th>Human label</th><th>Engine verdict</th><th class="num">Score</th><th>Why the label</th></tr></thead>
        <tbody>${ev.disagreements.map(d => `<tr class="static"><td><b>${esc(d.resume)}</b></td><td>${esc(ev.jobs[d.job] || d.job)}</td><td>${esc(labels[d.label])}</td><td>${esc(d.verdict)}</td><td class="num">${d.score}</td><td class="small muted">${esc(d.note)}</td></tr>`).join('')}</tbody></table></div></section>
    <div class="note anim" style="margin-top:16px">${I('info')}<div><b>How to read these numbers.</b> The resumes are fictional and the labels were written by the project author before the engine ran on them, so this is a regression baseline that shows the method, not a claim about real-world accuracy. Real recruiter labels on anonymised resumes are the next step.</div></div>`;
  }

  function trainingCard(m) {
    const tr = m.model?.training, labels = m.model?.labels || {};
    if (!tr) return '';
    const hand = m.model.hand_weights, learned = tr.weights, cur = m.model.weights;
    const mx = Math.max(...Object.values(hand), ...Object.values(learned));
    const met = (x, k) => k === 'accuracy' || k === 'p_at_3' ? `${(x[k] * 100).toFixed(1)}%` : x[k].toFixed(2);
    const rows = [['Hand-set weights', tr.hand_metrics], ['Learned, tested on unseen resumes', tr.cross_validated], ['Learned, on the data it was fitted to', tr.in_sample]];
    return `<section class="card anim" style="margin-top:16px"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-violet)">${I('spark', 16)}</span>How the weights were chosen</h2>
        <p>Weights are learned from the labelled set, then tested on resumes the fit never saw (leave-one-resume-out). Learned weights are used only when they beat the hand-set ones on that test.</p></div>
        <span class="pill ${tr.adopted ? 'v-strong' : 'v-verify'}"><i class="dot"></i>${tr.adopted ? 'Learned weights in use' : 'Hand-set weights in use'}</span></div>
      <div class="card-body grid g2">
        <div><div class="wcmp-legend small muted"><span><i class="hand"></i>Hand-set</span><span><i class="learned"></i>Learned</span></div>
          ${Object.keys(hand).map(k => `<div class="wcmp"><span>${esc(labels[k] || k)}</span><span class="wcmp-bars"><i class="hand" style="width:${hand[k] / mx * 100}%"></i><i class="learned" style="width:${learned[k] / mx * 100}%"></i></span>
            <b>${Math.round(cur[k])}</b></div>`).join('')}
          <p class="tiny muted" style="margin-top:8px">The number on the right is the weight in use now.</p></div>
        <div><table class="tbl"><thead><tr><th></th><th class="num">Accuracy</th><th class="num">Kappa</th><th class="num">Spearman</th><th class="num">Rejected good</th></tr></thead>
          <tbody>${rows.map(([l, x]) => `<tr class="static"><td>${l}</td><td class="num">${met(x, 'accuracy')}</td><td class="num">${met(x, 'kappa')}</td><td class="num">${met(x, 'spearman')}</td><td class="num">${x.false_rejections}/${x.good}</td></tr>`).join('')}</tbody></table>
          <div class="note ${tr.adopted ? '' : 'warn'}" style="margin-top:12px">${I(tr.adopted ? 'check' : 'info')}<div>${tr.adopted
            ? 'The learned weights beat the hand-set ones on unseen resumes, so they are in use.'
            : `On ${tr.trained_on} labelled pairs the learned weights do not beat the hand-set ones on unseen resumes, so the hand-set weights stay. More real recruiter labels are what will make learning pay off.`}</div></div></div>
      </div></section>`;
  }

  /* ---------------------------------------------------------------- the screening run */
  const STAGES = [['fileText', 'Reading resumes'], ['target', 'Matching skills to the job'], ['compass', 'Matching by meaning'], ['shield', 'Running integrity checks'], ['board', 'Scoring and ranking']];
  function runOverlay() {
    const r = S.run;
    return `<div class="modal-scrim run-scrim"><div class="run" role="dialog" aria-modal="true" aria-label="Screening in progress">
      <div class="run-head"><span class="logo-mark">${I('spark', 18)}</span><div><b>Screening ${r.n} candidate${r.n > 1 ? 's' : ''}</b><div class="small muted">${esc(r.title)}</div></div></div>
      <div class="run-bar"><i style="width:${Math.round((r.stage + (r.done ? 1 : 0.5)) / STAGES.length * 100)}%"></i></div>
      <ol class="stages">${STAGES.map(([ic, l], i) => `<li class="${i < r.stage || r.done ? 'done' : i === r.stage ? 'now' : ''}"><span class="st-ic">${i < r.stage || r.done ? I('check', 13) : I(ic, 13)}</span>${l}</li>`).join('')}</ol>
      <p class="tiny muted">Read in memory and discarded. Nothing is stored.</p></div></div>`;
  }

  // Update the run dialog in place so its entrance animation plays once.
  function updateRun() {
    const box = document.querySelector('.run');
    if (!box) return renderOverlays();
    const fresh = document.createElement('div'); fresh.innerHTML = runOverlay();
    box.querySelector('.run-bar i').style.width = fresh.querySelector('.run-bar i').style.width;
    box.querySelector('.stages').innerHTML = fresh.querySelector('.stages').innerHTML;
  }

  /* ---------------------------------------------------------------- command palette */
  function commands() {
    const go = (h, l, ic, k) => ({ l, ic, k, g: 'Go to', run: () => { location.hash = h; } });
    const list = [go('#/overview', 'Overview', 'overview'), go('#/jobs', 'Job library', 'folder'), go('#/screen', 'Screen candidates', 'users'),
      go('#/improve', 'Improve a resume', 'wand'), go('#/model', 'Model quality', 'shield'), go('#/method', 'How scoring works', 'scale'),
      { l: 'Run a sample screening', ic: 'play', g: 'Actions', run: () => document.dispatchEvent(new CustomEvent('ri-act', { detail: 'demo-screen' })) },
      { l: 'New job', ic: 'plus', g: 'Actions', run: () => openEditor(null, route() === 'screen' ? 'screen' : 'jobs') },
      { l: 'Try candidate coaching with a sample', ic: 'wand', g: 'Actions', run: () => document.dispatchEvent(new CustomEvent('ri-act', { detail: 'demo-improve' })) },
      { l: `Switch to ${document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'} theme`, ic: 'moon', g: 'Preferences', run: () => $('theme').click() },
      { l: `${S.blind ? 'Show' : 'Hide'} candidate names`, ic: S.blind ? 'eye' : 'eyeOff', g: 'Preferences', run: () => { S.blind = !S.blind; store.set('ri2-blind', S.blind ? 'on' : 'off'); render(false); } },
      { l: 'Keyboard shortcuts', ic: 'keyboard', k: '?', g: 'Preferences', run: () => { S.shortcuts = true; renderOverlays(); } }];
    (S.jobs || []).filter(j => j.status !== 'Closed').forEach(j => list.push({ l: `Screen against ${j.title}`, sub: j.department, ic: 'briefcase', g: 'Jobs',
      run: () => { useJob(j); S.screen = null; S.drawer = null; S.compare.clear(); if (route() === 'screen') render(); else location.hash = '#/screen'; } }));
    (S.screen?.candidates || []).forEach(c => list.push({ l: candName(c), sub: `${Math.round(c.score)} · ${c.verdict.label}`, ic: 'user', g: 'Candidates',
      run: () => { S.drawer = c.id; S.tab = 'overview'; if (route() !== 'screen') location.hash = '#/screen'; setTimeout(renderOverlays, 30); } }));
    return list;
  }
  function paletteResults() {
    const q = S.palette.q.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return commands().filter(c => words.every(w => `${c.l} ${c.sub || ''} ${c.g}`.toLowerCase().includes(w))).slice(0, 40);
  }
  function paletteList() {
    const res = paletteResults(); S.palette.i = Math.min(S.palette.i, Math.max(0, res.length - 1));
    if (!res.length) return `<div class="pal-empty">No matches for “${esc(S.palette.q)}”. Try a page, a job title or “theme”.</div>`;
    let g = '';
    return res.map((c, i) => `${c.g !== g ? `<div class="pal-g">${esc(g = c.g)}</div>` : ''}<button class="pal-item ${i === S.palette.i ? 'on' : ''}" data-act="pal-run" data-i="${i}" role="option" aria-selected="${i === S.palette.i}">
      ${I(c.ic, 16)}<span>${esc(c.l)}${c.sub ? `<em>${esc(c.sub)}</em>` : ''}</span>${c.k ? `<span class="kbd">${esc(c.k)}</span>` : ''}</button>`).join('');
  }
  function paletteModal() {
    return `<div class="modal-scrim pal-scrim" data-act="pal-close"><div class="pal" role="dialog" aria-modal="true" aria-label="Command palette">
      <label class="pal-in">${I('search', 18)}<input id="pal-q" placeholder="Search pages, jobs, candidates and actions" value="${esc(S.palette.q)}" autocomplete="off" role="combobox" aria-expanded="true"><span class="kbd">Esc</span></label>
      <div class="pal-list" id="pal-list" role="listbox">${paletteList()}</div>
      <div class="pal-foot"><span><span class="kbd">↑</span><span class="kbd">↓</span> move</span><span><span class="kbd">Enter</span> open</span><span><span class="kbd">Esc</span> close</span></div>
    </div></div>`;
  }
  function openPalette() { S.palette = { q: '', i: 0 }; renderOverlays(); setTimeout(() => $('pal-q')?.focus(), 20); }
  function runPalette(i) { const c = paletteResults()[i]; S.palette = null; renderOverlays(); if (c) c.run(); }

  function shortcutsModal() {
    const rows = [[`${MOD} K`, 'Search or jump to anything'], ['?', 'Show this sheet'], ['1  2  3', 'Board, ranked list, insights (on results)'], ['←  →', 'Previous or next candidate (in the drawer)'], ['S  M  R', 'Label the verdict Shortlist, Phone screen or Not a fit, then go to the next'], ['Esc', 'Close the drawer or dialog']];
    return `<div class="modal-scrim" data-act="close-shortcuts"><div class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div class="modal-head"><div><h2><span class="hic">${I('keyboard')}</span>Keyboard shortcuts</h2></div><button class="icon-btn" data-act="close-shortcuts" aria-label="Close">${I('x')}</button></div>
      <div class="sc">${rows.map(([k, l]) => `<div><span>${l}</span><span class="kbd">${esc(k)}</span></div>`).join('')}</div></div></div>`;
  }


  /* ================================================================ v2.3: interactive layer
     Everything here works on the screening already in the browser: re-weighting,
     removing candidates, pipeline stages, notes, tags and fairness groups never go
     back to the server and are kept only until the tab is closed. */
  const NEXT = {
    strong: 'Move to a hiring-manager interview this week.',
    shortlist: 'Book a technical screen focused on the risks listed.',
    verify: 'Run a short phone screen to check the gaps before investing more time.',
    reject: 'Decline politely, or keep on file for a more junior or different role.',
  };
  const PART_C = { must: 'var(--c-iris)', nice: 'var(--c-violet)', experience: 'var(--c-blue)', education: 'var(--c-amber)',
    similarity: 'var(--c-teal)', semantic: 'var(--c-green)', evidence: 'var(--c-orange)', quality: 'var(--c-pink)' };
  const PSTAGES = ['New', 'Phone screen', 'Interview', 'Offer', 'Hired', 'Rejected'];
  const STAGE_C = { 'New': 'var(--c-iris)', 'Phone screen': 'var(--c-blue)', 'Interview': 'var(--c-violet)', 'Offer': 'var(--c-amber)', 'Hired': 'var(--c-green)', 'Rejected': 'var(--slate)' };
  const TAG_IDEAS = ['Strong communicator', 'Referral', 'Relocation needed', 'Salary check', 'Notice period', 'Re-check later'];
  const PRESETS = {
    'Skills first': { must: 44, nice: 12, experience: 8, education: 2, similarity: 6, semantic: 16, evidence: 8, quality: 4 },
    'Experience first': { must: 28, nice: 6, experience: 30, education: 6, similarity: 6, semantic: 10, evidence: 10, quality: 4 },
    'Impact first': { must: 28, nice: 6, experience: 12, education: 2, similarity: 6, semantic: 10, evidence: 28, quality: 8 },
  };

  const modelWeights = () => S.screen?.model?.weights || {};
  const curWeights = () => S.weights || modelWeights();
  const pipeOf = c => (S.pipe[c.file] ||= { stage: 'New', tags: [], notes: [] });
  const isShort = c => c.verdict.key === 'strong' || c.verdict.key === 'shortlist';

  function jsVerdict(score, vi, mustTotal) {
    const knock = [];
    if (vi.suspicious) knock.push('Possible keyword stuffing: check the resume yourself');
    if (mustTotal && vi.miss_ratio > 0.5) knock.push(`Missing ${Math.round(vi.missing_ratio * mustTotal)} of ${mustTotal} must-have skills`);
    if (vi.experience < 0.45) knock.push('Well short of the required experience');
    const hard = knock.filter(k => !k.startsWith('Possible'));
    let key;
    if (hard.length && (vi.miss_ratio > 0.5 || score < 55)) key = 'reject';
    else if (vi.suspicious) key = score >= 48 ? 'verify' : 'reject';
    else if (score >= 74 && vi.miss_ratio <= 0.3 && vi.experience >= 0.8) key = 'strong';
    else if (score >= 62 && vi.miss_ratio <= 0.34 && vi.experience >= 0.6) key = 'shortlist';
    else if (score >= 48) key = 'verify';
    else key = 'reject';
    return { key, knockouts: knock };
  }

  /* Re-score with the current weights, then re-rank and rebuild every pool total. */
  function recompute() {
    const d = S.screen; if (!d) return;
    const W = curWeights(), mt = d.job.must_units.length;
    d.candidates.forEach(c => {
      c.base ||= { score: c.score, verdict: c.verdict, rank: c.rank };
      c.base.close_call ??= c.close_call;
      if (!S.weights) { c.score = c.base.score; c.verdict = c.base.verdict; c.close_call = c.base.close_call; return; }
      let num = 0, den = 0;
      c.parts.forEach(p => { if (p.value == null) return; const w = +W[p.key] || 0; num += w * p.value; den += w; });
      c.score = Math.round(Math.max(0, (den ? num / den : 0) - c.verdict_inputs.penalty) * 10) / 10;
      const v = jsVerdict(c.score, c.verdict_inputs, mt);
      c.verdict = { key: v.key, label: VERD[v.key].label, next: NEXT[v.key], knockouts: v.knockouts };
      c.close_call = v.key === 'reject' && c.score >= 52 && !c.verdict_inputs.suspicious;
    });
    const order = { strong: 0, shortlist: 1, verify: 2, reject: 3 };
    d.candidates.sort((a, b) => order[a.verdict.key] - order[b.verdict.key] || b.score - a.score);
    d.candidates.forEach((c, i) => { c.rank = i + 1; });
    d.counts = { strong: 0, shortlist: 0, verify: 0, reject: 0 };
    d.candidates.forEach(c => d.counts[c.verdict.key]++);
    d.skill_coverage = d.job.must_units.map(s => ({ skill: s, of: d.candidates.length,
      have: d.candidates.filter(c => c.skills.some(r => r.skill === s && (r.status === 'shown' || r.status === 'listed'))).length }));
  }

  function refreshResults() {
    if (route() !== 'screen' || !S.screen) return;
    const y = scrollY;
    $('page').innerHTML = screenResults();
    $('top-actions').innerHTML = topActions('screen');
    navTags(); scrollTo(0, y);
  }

  const rankDelta = c => (S.weights && c.base) ? c.base.rank - c.rank : 0;
  const deltaChip = c => { const d = rankDelta(c); return d ? `<span class="rk ${d > 0 ? 'up' : 'down'}" data-tip="Rank ${d > 0 ? 'up' : 'down'} ${Math.abs(d)} with your weights">${I(d > 0 ? 'trendUp' : 'trendDown', 11)}${Math.abs(d)}</span>` : ''; };

  /* ---------------------------------------------------------------- weight tuning */
  function tunePanel() {
    const W = curWeights(), M = modelWeights(), labels = S.screen.model.labels;
    const total = Object.values(W).reduce((a, b) => a + (+b || 0), 0) || 1;
    return `<aside class="tune" role="dialog" aria-label="Tune weights">
      <div class="tune-head"><div><h2><span class="hic" style="--c:var(--c-violet)">${I('scale', 16)}</span>Tune weights</h2>
        <p class="small muted">Change how much each part counts. Ranks and verdicts update live for this screening only.</p></div>
        <button class="icon-btn" data-act="close-tune" aria-label="Close">${I('x')}</button></div>
      <div class="tune-presets">${Object.keys(PRESETS).map(p => `<button class="chip outline" data-act="preset" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="tune-list">${Object.keys(M).map(k => `<label class="tune-row" style="--c:${PART_C[k]}">
        <span class="tr-name"><i></i>${esc(labels[k])}</span>
        <input type="range" min="0" max="50" step="1" value="${Math.round(+W[k] || 0)}" data-w="${k}" aria-label="${esc(labels[k])} weight">
        <b id="tw-${k}">${Math.round((+W[k] || 0) / total * 100)}%</b></label>`).join('')}</div>
      ${tuneFoot()}
    </aside>`;
  }
  const tuneFoot = () => `<div class="tune-foot" id="tune-foot">
        <span class="small muted">${S.weights ? `${I('alert', 13)} Custom weights in use` : `${I('check', 13)} Model weights`}</span>
        <button class="btn btn-sm" data-act="reset-weights" ${S.weights ? '' : 'disabled'}>${I('refresh', 14)} Reset to model</button></div>`;

  function setWeight(k, v) {
    S.weights = { ...curWeights(), [k]: v };
    if (Object.values(S.weights).every(x => !+x)) S.weights[k] = 1;
    recompute(); refreshResults(); updateTuneLabels();
  }
  function updateTuneLabels() {
    const W = curWeights(), total = Object.values(W).reduce((a, b) => a + (+b || 0), 0) || 1;
    Object.keys(W).forEach(k => { const b = $(`tw-${k}`); if (b) b.textContent = `${Math.round((+W[k] || 0) / total * 100)}%`; });
    const f = $('tune-foot'); if (f) f.outerHTML = tuneFoot();
  }

  /* ---------------------------------------------------------------- remove & undo */
  function removeCandidate(id) {
    const d = S.screen, i = d.candidates.findIndex(c => c.id === id); if (i < 0) return;
    const [c] = d.candidates.splice(i, 1);
    S.compare.delete(id); if (S.drawer === id) S.drawer = null;
    recompute(); refreshResults(); renderOverlays();
    toast(`${candName(c)} removed from this screening`, false, { label: 'Undo', run: () => { d.candidates.push(c); recompute(); refreshResults(); renderOverlays(); } });
  }

  /* ---------------------------------------------------------------- pipeline */
  function pipelineView() {
    const list = filtered();
    return `<div class="pboard">${PSTAGES.map(st => {
      const items = list.filter(c => pipeOf(c).stage === st);
      return `<div class="pcol" data-stage="${esc(st)}" style="--c:${STAGE_C[st]}">
        <div class="pcol-head"><span class="pdot"></span><b>${esc(st)}</b><span class="n">${items.length}</span></div>
        <div class="pcol-body">${items.map(c => { const p = pipeOf(c);
          return `<article class="pcard" draggable="true" data-cand="${c.id}" tabindex="0" aria-label="${esc(candName(c))}, ${esc(st)}">
            <div class="row" style="flex-wrap:nowrap">${avatar(c)}<div class="who"><b>${esc(candName(c))}</b><span>${pill(c.verdict.key)}</span></div><span class="ps">${Math.round(c.score)}</span></div>
            ${p.tags.length ? `<div class="chips" style="margin-top:8px">${p.tags.slice(0, 3).map(t => `<span class="chip tag">${esc(t)}</span>`).join('')}</div>` : ''}
            ${p.notes.length ? `<div class="tiny muted" style="margin-top:6px">${I('note', 12)} ${p.notes.length} note${p.notes.length > 1 ? 's' : ''}</div>` : ''}
          </article>`; }).join('') || '<div class="empty-col">Drop candidates here</div>'}</div></div>`;
    }).join('')}</div>
    <p class="small muted" style="margin-top:10px">${I('info', 13)} Drag cards between stages, or set the stage in a candidate's Notes tab. Stages, notes and tags stay in this browser tab only.</p>`;
  }

  function setStage(id, stage) {
    const c = S.screen.candidates.find(x => x.id === id); if (!c) return;
    const prev = pipeOf(c).stage; if (prev === stage) return;
    pipeOf(c).stage = stage;
    if (S.view === 'pipeline') { $('results').innerHTML = resultsView(); }
    if (S.drawer === id) renderOverlays();
    toast(`${candName(c)} moved to ${stage}`, false, { label: 'Undo', run: () => { pipeOf(c).stage = prev; if (S.view === 'pipeline') $('results').innerHTML = resultsView(); if (S.drawer === id) renderOverlays(); } });
  }

  /* ---------------------------------------------------------------- fairness */
  const FAIR_ATTRS = {
    experience: { label: 'Experience band', of: c => c.summary.years == null ? 'Unknown' : c.summary.years < 2 ? 'Under 2 years' : c.summary.years < 5 ? '2–5 years' : '5+ years' },
    education: { label: 'Education level', of: c => c.summary.education || 'Not found' },
    length: { label: 'Resume length', of: c => c.summary.word_count < 250 ? 'Short (under 250 words)' : c.summary.word_count < 600 ? 'Medium (250–600)' : 'Long (600+)' },
    custom: { label: 'Your own groups', of: c => S.groups[c.file] || 'Unassigned' },
  };
  function fairnessData() {
    const cs = S.screen.candidates, attr = FAIR_ATTRS[S.fair.attr];
    const scores = cs.map(c => c.score).sort((a, b) => a - b), med = scores.length ? scores[Math.floor((scores.length - 1) / 2)] : 0;
    const sel = c => S.fair.outcome === 'shortlist' ? isShort(c) : c.score > med;
    const g = {};
    cs.forEach(c => { const k = attr.of(c); (g[k] ||= { group: k, n: 0, sel: 0, ids: [] }); g[k].n++; g[k].ids.push(c.id); if (sel(c)) g[k].sel++; });
    const rows = Object.values(g).map(r => ({ ...r, rate: r.n ? r.sel / r.n : 0 }));
    const best = Math.max(0, ...rows.filter(r => r.n >= 2).map(r => r.rate), ...(rows.every(r => r.n < 2) ? rows.map(r => r.rate) : []));
    rows.forEach(r => { r.ratio = best ? r.rate / best : null; });
    rows.sort((a, b) => b.rate - a.rate || b.n - a.n);
    return { rows, med, best };
  }
  function fairnessView() {
    const { rows, med, best } = fairnessData(), low = rows.filter(r => r.ratio != null && r.ratio < 0.8 && r.n >= 5);
    const small = rows.some(r => r.n < 5);
    return `<div class="fair">
      <section class="card anim"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-teal)">${I('scale', 16)}</span>Fairness audit</h2>
        <p>Compare how often each group is selected. A group whose rate is under 80% of the best group's (the four-fifths rule) deserves a closer look.</p></div></div>
        <div class="card-body">
          <div class="fair-controls">
            <label class="fld"><span class="label">Group candidates by</span><select data-fair="attr">${Object.entries(FAIR_ATTRS).map(([k, a]) => `<option value="${k}" ${S.fair.attr === k ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
            <label class="fld"><span class="label">Count as selected</span><select data-fair="outcome">
              <option value="shortlist" ${S.fair.outcome === 'shortlist' ? 'selected' : ''}>Strong shortlist or Shortlist</option>
              <option value="scoring" ${S.fair.outcome === 'scoring' ? 'selected' : ''}>Scored above the pool median (${Math.round(med)})</option></select></label>
          </div>
          ${low.length ? `<div class="note warn" style="margin-top:14px">${I('alert')}<div><b>${low.map(r => esc(r.group)).join(', ')}</b> ${low.length > 1 ? 'are' : 'is'} selected at under 80% of the best group's rate. Check whether the job's requirements or the scoring explain the gap.</div></div>`
            : `<div class="note" style="margin-top:14px">${I('check')}<div>No group with 5 or more candidates falls under the four-fifths line.</div></div>`}
          <div class="fair-table"><table class="tbl"><thead><tr><th>Group</th><th class="num">Candidates</th><th class="num">Selected</th><th>Selection rate</th><th class="num">Impact ratio</th></tr></thead>
            <tbody>${rows.map(r => `<tr class="static">
              <td><b>${esc(r.group)}</b>${r.n < 5 ? ' <span class="tiny muted">too few to judge</span>' : ''}</td>
              <td class="num">${r.n}</td><td class="num">${r.sel}</td>
              <td><div class="fair-bar" data-tip="${esc(r.group)}: ${r.sel} of ${r.n} selected"><i style="width:${Math.max(r.rate * 100, 1)}%"></i>${best ? `<em style="left:${best * 80}%"></em>` : ''}</div><span class="tiny">${Math.round(r.rate * 100)}%</span></td>
              <td class="num"><span class="ratio ${r.ratio == null || r.n < 5 ? '' : r.ratio < 0.8 ? 'bad' : 'ok'}">${r.ratio == null ? '—' : r.ratio.toFixed(2)}</span></td></tr>`).join('')}</tbody></table></div>
          ${small ? `<p class="tiny muted" style="margin-top:8px">Groups with fewer than 5 candidates are shown but not flagged: a rate based on 1–4 people says little.</p>` : ''}
          <p class="tiny muted" style="margin-top:6px">The dashed mark on each bar is 80% of the best group's rate.</p>
        </div></section>
      ${S.fair.attr === 'custom' ? `<section class="card anim" style="margin-top:16px"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-pink)">${I('users', 16)}</span>Your own groups</h2>
        <p>Assign each candidate to a group from information they shared with you (for example, self-reported in an application form). The screener never infers personal attributes.</p></div>
        <button class="btn btn-sm btn-ghost" data-act="clear-groups" ${Object.keys(S.groups).length ? '' : 'disabled'}>${I('trash', 14)} Clear all groups</button></div>
        <div class="card-body"><datalist id="group-names">${[...new Set(Object.values(S.groups))].map(g => `<option value="${esc(g)}">`).join('')}</datalist>
          <div class="grp-list">${S.screen.candidates.map(c => `<label class="grp-row">${avatar(c)}<span>${esc(candName(c))}</span>
            <input type="text" list="group-names" data-group="${esc(c.file)}" value="${esc(S.groups[c.file] || '')}" placeholder="Group name" maxlength="40"></label>`).join('')}</div></div></section>` : ''}
      <div class="note" style="margin-top:16px">${I('info')}<div>This is an internal check, not a legal audit. Laws such as New York City's Local Law 144 require an independent bias audit of automated hiring tools using real demographic data.</div></div>
    </div>`;
  }

  /* ---------------------------------------------------------------- evidence (explain this score) */
  function evidenceTab(c) {
    const W = curWeights(), act = c.parts.filter(p => p.value != null);
    const den = act.reduce((a, p) => a + (+W[p.key] || 0), 0) || 1;
    const rows = act.map(p => { const max = (+W[p.key] || 0) / den * 100; return { ...p, max, pts: max * p.value / 100 }; });
    const raw = rows.reduce((a, r) => a + r.pts, 0), pen = c.verdict_inputs.penalty;
    const ev = c.evidence, on = S.hl;
    let txt = ev.text, html = '', pos = 0;
    ev.highlights.forEach(h => {
      if (h.start < pos) return;
      html += esc(txt.slice(pos, h.start));
      const frag = esc(txt.slice(h.start, h.end));
      html += on.has(h.kind) ? `<mark class="hl ${h.kind}" data-tip="${esc(h.label)}">${frag}</mark>` : frag;
      pos = h.end;
    });
    html += esc(txt.slice(pos));
    if (S.blind && c.name_guess) html = html.split(esc(c.name_guess)).join(`<mark class="hl other">${esc(c.label)}</mark>`);
    const kinds = [['shown', 'Skill shown in work'], ['listed', 'Skill only listed'], ['related', 'Described, not named'], ['metric', 'Measurable result'], ['other', 'Other skill']];
    return `
      <div class="sec-title" style="margin-top:4px">Where the ${Math.round(c.score)} points come from</div>
      <div class="comp" role="img" aria-label="Score composition">${rows.filter(r => r.pts > 0.2).map(r => `<i style="flex:${r.pts};background:${PART_C[r.key]}" data-tip="${esc(r.label)}: ${r.pts.toFixed(1)} of ${r.max.toFixed(1)} points"></i>`).join('')}<i class="rest" style="flex:${Math.max(0, 100 - raw)}" data-tip="Points not earned: ${(100 - raw).toFixed(1)}"></i></div>
      <div class="pts">${rows.map(r => `<div class="pt-row" style="--c:${PART_C[r.key]}"><span class="pt-name"><i></i>${esc(r.label)} ${tip(PART_TIPS[r.key] || '')}</span>
        <span class="pt-bar"><i style="width:${r.value}%"></i></span><span class="pt-val"><b>${r.pts.toFixed(1)}</b> / ${r.max.toFixed(1)}</span></div>`).join('')}
        ${pen ? `<div class="pt-row pen"><span class="pt-name">${I('anomaly', 13)} Integrity penalty</span><span></span><span class="pt-val"><b>−${pen}</b></span></div>` : ''}
        <div class="pt-row total"><span class="pt-name">Score</span><span></span><span class="pt-val"><b>${Math.round(c.score)}</b> / 100</span></div></div>
      ${ev.pairs.length ? `<div class="sec-title">Closest matches by meaning</div>
        <div class="pairs">${ev.pairs.map(p => `<div class="pair"><div class="pj"><span class="tiny muted">Job asks</span>${esc(p.job)}</div>
          <div class="pr"><span class="tiny muted">Resume says</span>${esc(p.resume)}</div><span class="sim" style="--s:${Math.round(p.sim * 100)}%">${Math.round(p.sim * 100)}%</span></div>`).join('')}</div>` : ''}
      <div class="sec-title">The resume, highlighted</div>
      <div class="hl-legend">${kinds.map(([k, l]) => `<button class="hl-key ${k} ${on.has(k) ? 'on' : ''}" data-act="hl" data-k="${k}" aria-pressed="${on.has(k)}"><i></i>${l}</button>`).join('')}</div>
      <pre class="resume-text">${html}</pre>
      <p class="tiny muted">Emails and phone numbers are masked. Lines copied from the job description were removed before scoring.</p>`;
  }

  /* ---------------------------------------------------------------- notes, stage, tags */
  function notesTab(c) {
    const p = pipeOf(c);
    return `
      <div class="sec-title" style="margin-top:4px">Stage</div>
      <div class="stage-seg">${PSTAGES.map(st => `<button class="${p.stage === st ? 'on' : ''}" style="--c:${STAGE_C[st]}" data-act="set-stage" data-s="${esc(st)}">${esc(st)}</button>`).join('')}</div>
      <div class="sec-title">Tags</div>
      <div class="chips">${p.tags.map((t, i) => `<span class="chip tag">${esc(t)}<button class="chip-x" data-act="rm-tag" data-i="${i}" aria-label="Remove tag ${esc(t)}">${I('x', 11)}</button></span>`).join('') || '<span class="small muted">No tags yet.</span>'}</div>
      <div class="row" style="margin-top:10px;flex-wrap:nowrap"><input type="text" id="tag-in" placeholder="Add a tag and press Enter" maxlength="30">
        <button class="btn btn-sm" data-act="add-tag">${I('plus', 14)} Add</button></div>
      <div class="chips" style="margin-top:8px">${TAG_IDEAS.filter(t => !p.tags.includes(t)).slice(0, 5).map(t => `<button class="chip outline" data-act="add-tag" data-t="${esc(t)}">${I('plus', 11)}${esc(t)}</button>`).join('')}</div>
      <div class="sec-title">Notes</div>
      <textarea id="note-in" placeholder="Write a note about this candidate…" style="min-height:90px"></textarea>
      <div class="row" style="justify-content:space-between;margin-top:8px"><span class="tiny muted">${I('lock', 12)} Kept in this browser tab only.</span>
        <button class="btn btn-sm btn-primary" data-act="add-note">${I('plus', 14)} Add note</button></div>
      <div class="notes">${p.notes.map((n, i) => `<div class="note-item"><p>${esc(n.text)}</p><div class="row" style="justify-content:space-between"><span class="tiny muted">${ago(n.at)}</span>
        <button class="icon-btn danger" data-act="rm-note" data-i="${i}" aria-label="Delete note">${I('trash', 14)}</button></div></div>`).join('')}</div>
      ${p.notes.length > 1 ? `<button class="btn btn-sm btn-ghost" style="margin-top:8px" data-act="clear-notes">${I('trash', 14)} Delete all notes</button>` : ''}
      <div class="danger-zone"><div><b>Remove from this screening</b><p class="small muted">Takes the candidate out of the board, totals and export. You can undo straight after.</p></div>
        <button class="btn btn-sm btn-danger-ghost" data-act="remove-cand" data-id="${c.id}">${I('trash', 14)} Remove</button></div>`;
  }

  /* ---------------------------------------------------------------- KPI details */
  const kpiAttrs = (k, label) => `data-act="kpi" data-k="${k}" role="button" tabindex="0" aria-label="${esc(label)}: show details"`;
  function detailModal() {
    const { k } = S.detail, jobs = S.jobs || [], open = jobs.filter(j => j.status === 'Open');
    const d = S.screen, ev = S.model?.evaluation;
    const listRow = (left, right, pctv, c) => `<div class="dl-row"><span class="dl-l">${left}</span><span class="dl-bar" style="--c:${c || 'var(--iris)'}"><i style="width:${Math.max(pctv, 1)}%"></i></span><span class="dl-r">${right}</span></div>`;
    const candRow = c => `<button class="dl-cand" data-act="open-cand" data-id="${c.id}">${avatar(c)}<span class="dl-l"><b>${esc(candName(c))}</b><span class="tiny muted">${esc(c.file)}</span></span>${pill(c.verdict.key)}<b class="dl-s">${Math.round(c.score)}</b></button>`;
    let title = '', icon = 'info', c = 'var(--iris)', value = '', body = '', note = '';
    const jobRows = (fn, max, color) => jobs.length ? jobs.map(j => listRow(`<b>${esc(j.title)}</b><span class="tiny muted">${esc(j.status)}</span>`, fn(j), max ? fn(j, true) / max * 100 : 0, color)).join('') : '<p class="muted">No jobs yet.</p>';
    if (k === 'open') { title = 'Open roles'; icon = 'briefcase'; c = 'var(--c-blue)'; value = open.length;
      note = 'Roles marked Open in the job library. On hold and Closed roles are left out.';
      body = open.map(j => `<div class="dl-job"><div><b>${esc(j.title)}</b><div class="tiny muted">${[j.department, j.location, j.employment_type].filter(Boolean).map(esc).join(' · ')}</div></div>
        <span class="small">${j.openings} opening${j.openings > 1 ? 's' : ''}</span><button class="btn btn-sm" data-act="screen-job" data-id="${j.id}">${I('users', 14)} Screen</button></div>`).join('') || '<p class="muted">No open roles.</p>'; }
    if (k === 'positions') { title = 'Positions to fill'; icon = 'users'; c = 'var(--c-violet)'; value = open.reduce((a, j) => a + j.openings, 0);
      const mx = Math.max(1, ...open.map(j => j.openings)); note = 'Headcount still to hire across open roles.';
      body = open.map(j => listRow(`<b>${esc(j.title)}</b>`, `${j.openings}`, j.openings / mx * 100, c)).join('') || '<p class="muted">No open roles.</p>'; }
    if (k === 'screened') { title = 'Resumes screened'; icon = 'fileText'; c = 'var(--c-teal)'; value = jobs.reduce((a, j) => a + (j.candidates_screened || 0), 0);
      const mx = Math.max(1, ...jobs.map(j => j.candidates_screened || 0)); note = 'All-time counts per saved job. Only the numbers are kept, never the resumes.';
      body = jobRows((j, raw) => raw ? (j.candidates_screened || 0) : `${j.candidates_screened || 0} in ${j.screenings || 0} run${j.screenings === 1 ? '' : 's'}`, mx, c); }
    if (k === 'rate') { const sc = jobs.reduce((a, j) => a + (j.candidates_screened || 0), 0), sh = jobs.reduce((a, j) => a + (j.shortlisted || 0), 0);
      title = 'Shortlist rate'; icon = 'star'; c = 'var(--c-pink)'; value = `${pct(sh, sc)}%`; note = 'Share of screened resumes that reached Strong shortlist or Shortlist.';
      body = jobs.filter(j => j.candidates_screened).map(j => listRow(`<b>${esc(j.title)}</b>`, `${pct(j.shortlisted, j.candidates_screened)}% <span class="tiny muted">(${j.shortlisted}/${j.candidates_screened})</span>`, pct(j.shortlisted, j.candidates_screened), c)).join('') || '<p class="muted">Screen candidates against a saved job to see rates here.</p>'; }
    if (d && (k in VERD || ['pool', 'short', 'flags', 'avg', 'gaps'].includes(k))) {
      const cs = d.candidates;
      if (k in VERD) { title = VERD[k].label; icon = VERD[k].icon; c = VERD[k].m; const l = cs.filter(x => x.verdict.key === k); value = l.length; note = NEXT[k]; body = l.map(candRow).join('') || '<p class="muted">Nobody here.</p>'; }
      if (k === 'pool') { title = 'Candidates screened'; icon = 'users'; value = cs.length; note = 'Everyone in this screening, by rank.'; body = cs.map(candRow).join(''); }
      if (k === 'short') { title = 'On the shortlist'; icon = 'star'; c = 'var(--c-green)'; const l = cs.filter(isShort); value = `${l.length} (${pct(l.length, cs.length)}%)`; note = 'Strong shortlist and Shortlist together.'; body = l.map(candRow).join('') || '<p class="muted">Nobody reached the shortlist.</p>'; }
      if (k === 'flags') { title = 'Integrity flags'; icon = 'anomaly'; c = 'var(--c-orange)'; const l = flagged(); value = l.length; note = 'Copied job text, crammed bullets or inflated years. Flagged resumes stop at Interview to verify.';
        body = l.map(x => `${candRow(x)}<div class="dl-flags">${x.integrity.flags.map(esc).join('<br>')}</div>`).join('') || '<p class="muted">No integrity flags in this pool.</p>'; }
      if (k === 'avg') { title = 'Scores in this pool'; icon = 'gauge'; c = 'var(--c-violet)'; value = Math.round(cs.reduce((a, x) => a + x.score, 0) / (cs.length || 1)); note = 'Average score. Each bar is one candidate.';
        body = cs.map(x => `<button class="dl-cand" data-act="open-cand" data-id="${x.id}">${avatar(x)}<span class="dl-l"><b>${esc(candName(x))}</b></span><span class="dl-bar" style="--c:${VERD[x.verdict.key].m}"><i style="width:${x.score}%"></i></span><b class="dl-s">${Math.round(x.score)}</b></button>`).join(''); }
      if (k === 'gaps') { title = 'Must-haves nobody has'; icon = 'target'; c = 'var(--c-pink)'; const g = d.skill_coverage.filter(s => s.have === 0); value = g.length;
        note = 'If nobody in the pool shows or lists a requirement, it may be unrealistic for this market, or worth training for.';
        body = d.skill_coverage.slice().sort((a, b) => a.have - b.have).map(s => listRow(`<b>${esc(s.skill)}</b>`, `${s.have}/${s.of}`, pct(s.have, s.of), s.have ? 'var(--c-teal)' : 'var(--red)')).join(''); }
    }
    if (ev && k.startsWith('m-')) {
      const prev = S.model.history.length > 1 ? S.model.history[S.model.history.length - 2] : null;
      const L = { reject: 'Not a fit', maybe: 'Interview to verify', shortlist: 'Shortlist' };
      const M = {
        'm-accuracy': ['Verdict accuracy', 'check', 'var(--c-blue)', `${(ev.accuracy * 100).toFixed(1)}%`, 'Share of labelled pairs where the engine’s verdict class matches the human label (shortlist, maybe or reject).',
          ev.labels.map((t, i) => listRow(`<b>${L[t]}</b><span class="tiny muted">human label</span>`, `${ev.confusion[i][i]} of ${ev.confusion[i].reduce((a, b) => a + b, 0)} agreed`, pct(ev.confusion[i][i], ev.confusion[i].reduce((a, b) => a + b, 0)), 'var(--c-blue)')).join('')],
        'm-kappa': ['Weighted kappa', 'scale', 'var(--c-iris)', ev.kappa.toFixed(2), 'Agreement after removing what chance alone would give. A one-step miss (maybe vs reject) costs half a two-step miss. 0.61–0.80 is substantial, above 0.80 near-perfect.',
          `<div class="kscale">${[[0, 'Poor'], [0.2, 'Fair'], [0.4, 'Moderate'], [0.6, 'Substantial'], [0.8, 'Near-perfect']].map(([v, l]) => `<span class="${ev.kappa >= v && ev.kappa < v + 0.2 + (v === 0.8 ? 0.21 : 0) ? 'on' : ''}">${l}<em>${v.toFixed(1)}+</em></span>`).join('')}</div>`],
        'm-spearman': ['Spearman rho', 'trendUp', 'var(--c-violet)', ev.spearman.toFixed(2), 'How well the 0–100 score orders people the way the labels do. 1.0 would mean every shortlist outscores every maybe, and every maybe outscores every reject.', ''],
        'm-p3': ['Precision at 3', 'target', 'var(--c-teal)', `${Math.round(ev.p_at_3 * 100)}%`, 'For each job, the share of the top three candidates a person labelled shortlist or maybe. This is what a recruiter feels when opening the board.', ''],
        'm-stuffers': ['Stuffers caught', 'shield', 'var(--c-orange)', `${ev.stuffers_caught}/${ev.stuffers}`, 'Resumes that paste the job description or cram every tool into one line, kept off the shortlist.',
          (ev.disagreements || []).filter(x => /stuffer/.test(x.note)).map(x => `<div class="dl-job"><b>${esc(x.resume)}</b><span class="small">${esc(x.verdict)}</span></div>`).join('') || '<p class="small muted">Every stuffer in the set stopped at Interview to verify or below.</p>'],
        'm-fr': ['Good candidates rejected', 'alert', 'var(--c-pink)', `${ev.false_rejections}/${ev.good}`, 'People a human would at least interview who got Not a fit. For a screener this is the costliest error, so it is tracked on its own.',
          (ev.disagreements || []).filter(x => x.label !== 'reject' && x.verdict === 'Not a fit').map(x => `<div class="dl-job"><div><b>${esc(x.resume)}</b><div class="tiny muted">${esc(ev.jobs[x.job] || x.job)} · ${esc(x.note)}</div></div><span class="small">score ${x.score}</span></div>`).join('')],
      };
      [title, icon, c, value, note, body] = M[k];
      if (prev && k in { 'm-accuracy': 1, 'm-kappa': 1, 'm-spearman': 1, 'm-p3': 1 }) {
        const key = { 'm-accuracy': 'accuracy', 'm-kappa': 'kappa', 'm-spearman': 'spearman', 'm-p3': 'p_at_3' }[k];
        body += `<div class="sec-title">By version</div>` + S.model.history.map(h => listRow(`<b>v${esc(h.version)}</b><span class="tiny muted">${esc(h.note || '')}</span>`, key === 'accuracy' || key === 'p_at_3' ? `${Math.round(h[key] * 1000) / 10}%` : h[key].toFixed(2), h[key] * 100, c)).join('');
      }
    }
    if (!title) return '';
    return `<div class="modal-scrim" data-act="close-detail"><div class="modal detail" role="dialog" aria-modal="true" aria-label="${esc(title)}" style="--c:${c}">
      <div class="detail-head"><span class="hic" style="--c:${c}">${I(icon, 18)}</span><div><span class="small muted">${esc(title)}</span><b class="detail-v">${value}</b></div>
        <button class="icon-btn" data-act="close-detail" aria-label="Close">${I('x')}</button></div>
      ${note ? `<p class="detail-note">${esc(note)}</p>` : ''}
      <div class="detail-body">${body}</div></div></div>`;
  }

  /* ---------------------------------------------------------------- recruiter labels
     Each verdict can be marked right or wrong. The labels stay in the tab and
     download as a file that eval/import_labels.py turns into an evaluation and
     training set. This is how the model learns from real recruiters. */
  const LCLASS = { strong: 'shortlist', shortlist: 'shortlist', verify: 'maybe', reject: 'reject' };
  const LOPTS = [['shortlist', 'Shortlist', 'star'], ['maybe', 'Phone screen', 'help'], ['reject', 'Not a fit', 'x']];
  const labelOf = c => S.labels[c.file];
  const agrees = c => labelOf(c) && labelOf(c).label === LCLASS[c.verdict.key];
  function labelStats() {
    const cs = (S.screen?.candidates || []).filter(labelOf);
    return { n: cs.length, agree: cs.filter(agrees).length, total: S.screen?.candidates.length || 0, cs };
  }
  function labelBox(c) {
    const l = labelOf(c), st = labelStats();
    return `<div class="labelbox">
      <div class="row" style="justify-content:space-between"><b>${I('check', 14)} Is this verdict right?</b>
        <span class="tiny muted">${st.n ? `You agreed with ${st.agree} of ${st.n} so far` : 'Your answer trains and tests the model'}</span></div>
      <div class="lab-opts">${LOPTS.map(([k, t, ic]) => `<button class="lab-opt ${l?.label === k ? 'on' : ''} ${LCLASS[c.verdict.key] === k ? 'engine' : ''}" data-act="label" data-l="${k}" aria-pressed="${l?.label === k}">
        ${I(ic, 14)}<span>${t}</span>${LCLASS[c.verdict.key] === k ? '<em>engine</em>' : ''}<kbd class="kbd">${k[0].toUpperCase()}</kbd></button>`).join('')}</div>
      ${l ? `<div class="row" style="justify-content:space-between;margin-top:8px"><span class="small ${agrees(c) ? 'ok-text' : 'warn-text'}">${agrees(c) ? `${I('check', 13)} You agree with the engine` : `${I('alert', 13)} You disagree: this pair is the most useful kind for training`}</span>
        <span class="row" style="gap:4px"><button class="btn btn-sm btn-ghost" data-act="unlabel">${I('x', 13)} Clear</button>${nextUnlabelled(c) ? `<button class="btn btn-sm" data-act="next-unlabelled">Next unlabelled ${I('chevronRight', 13)}</button>` : ''}</span></div>` : ''}
    </div>`;
  }
  function nextUnlabelled(c) {
    const cs = S.screen.candidates, i = cs.findIndex(x => x.id === c.id);
    return [...cs.slice(i + 1), ...cs.slice(0, i)].find(x => !labelOf(x));
  }
  function setLabel(c, label) {
    S.labels[c.file] = { label, at: new Date().toISOString(), engine: LCLASS[c.verdict.key], score: c.score };
    renderOverlays(); if ($('results') && ['board', 'table', 'insights'].includes(S.view)) $('results').innerHTML = resultsView();
    $('top-actions').innerHTML = topActions('screen');
  }
  function agreementCard() {
    const st = labelStats();
    const body = st.n ? (() => {
      const conf = {}; st.cs.forEach(c => { const k = `${labelOf(c).label}|${LCLASS[c.verdict.key]}`; conf[k] = (conf[k] || 0) + 1; });
      const keys = ['shortlist', 'maybe', 'reject'], L = { shortlist: 'Shortlist', maybe: 'Phone screen', reject: 'Not a fit' };
      return `<div class="agree-row"><div class="agree-big"><b>${Math.round(st.agree / st.n * 100)}%</b><span>agreement on ${st.n} of ${st.total} candidates</span></div>
        <div class="cm small-cm"><div class="cm-corner small muted">You ↓ · Engine →</div>${keys.map(k => `<div class="cm-h">${L[k]}</div>`).join('')}
        ${keys.map((t, i) => `<div class="cm-h row-h">${L[t]}</div>${keys.map((p, j) => { const v = conf[`${t}|${p}`] || 0; return `<div class="cm-c ${i === j ? 'diag' : ''}" style="--a:${v / st.n};--i:${i * 3 + j}"><b>${v}</b></div>`; }).join('')}`).join('')}</div></div>
        <div class="row" style="justify-content:space-between;margin-top:12px"><span class="small muted">${I('lock', 13)} The download includes resume text. Keep it private; the import script masks emails and phone numbers.</span>
          <button class="btn btn-sm btn-primary" data-act="dl-labels">${I('download', 14)} Download labels</button></div>`; })()
      : `<div class="empty-mini">${I('check', 22)}<b>Teach the model with your judgement</b><span class="small muted">Open a candidate and answer “Is this verdict right?”. Your labels measure how often the engine agrees with you, and can retrain its weights.</span></div>`;
    return `<section class="card anim" style="margin-top:16px"><div class="card-head"><div><h2><span class="hic" style="--c:var(--c-green)">${I('check', 16)}</span>Your agreement with the engine</h2>
      <p>Real recruiter labels are what make the accuracy numbers trustworthy.</p></div></div><div class="card-body">${body}</div></section>`;
  }

  function downloadLabels() {
    const d = S.screen, st = labelStats();
    if (!st.n) return toast('Label at least one verdict first', true);
    const job = S.job.text, title = (S.job.id && jobById(S.job.id)?.title) || d.job.title || 'Job';
    const lines = st.cs.map(c => { const r = S.resumes.find(x => x.name === c.file); const l = labelOf(c);
      return JSON.stringify({ job_title: title, job_text: job, resume_name: c.file, resume_text: r ? r.text : '',
        label: l.label, engine_verdict: c.verdict.label, engine_score: c.score, labelled_at: l.at,
        note: (pipeOf(c).notes[0]?.text || '') }); });
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'application/x-ndjson' }));
    Object.assign(document.createElement('a'), { href: url, download: 'recruiter_labels.jsonl' }).click();
    URL.revokeObjectURL(url);
    toast(`${st.n} labels downloaded. The file contains resume text: keep it private.`);
  }

  /* ---------------------------------------------------------------- client-side export */
  function exportCsv() {
    const d = S.screen, q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['rank', 'candidate', 'file', 'score', 'verdict', 'your_label', 'stage', 'tags', 'notes', 'must_haves', 'years', 'missing_must_haves', 'top_risk', 'next_step'];
    const rows = d.candidates.map(c => { const p = pipeOf(c); return [c.rank, candName(c), c.file, c.score, c.verdict.label, labelOf(c)?.label || '', p.stage, p.tags.join('; '), p.notes.map(n => n.text).join(' | '),
      `${c.summary.must_matched}/${d.job.must_units.length}`, c.summary.years ?? '', c.skills.filter(s => s.importance === 'must' && s.status === 'missing').map(s => s.skill).join('; '),
      c.risks[0] || '', c.verdict.next]; });
    const csv = [head, ...rows].map(r => r.map(q).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: 'shortlist.csv' }).click();
    URL.revokeObjectURL(url);
    toast(S.weights ? 'Exported with your custom weights' : 'Shortlist exported');
  }

  /* ---------------------------------------------------------------- actions */
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function runScreen() {
    const btn = document.querySelector('[data-act="run-screen"]');
    if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.innerHTML = `${I('refresh', 16)} Screening…`; }
    const title = (S.job.id && jobById(S.job.id)?.title) || S.job.text.trim().split('\n')[0].slice(0, 60) || 'One-off job';
    const call = api('/api/screen', { job: S.job.text, job_id: S.job.id || null, resumes: S.resumes.map(r => ({ name: r.name, text: r.text })) });
    // The one choreographed moment: each stage of the engine ticks off while the request runs.
    if (!reduced) {
      S.run = { n: S.resumes.length, title, stage: 0 }; renderOverlays();
      for (let i = 1; i < STAGES.length; i++) { await wait(230); if (!S.run) break; S.run.stage = i; updateRun(); }
    }
    try {
      S.screen = await call;
      if (S.run) { S.run.done = true; updateRun(); await wait(280); }
      if (S.screen.job_id) loadJobs().catch(() => { });
      S.compare.clear(); S.drawer = null; S.run = null; S.view = ['insights', 'fairness'].includes(S.view) ? 'board' : S.view; S.dealt = !reduced;
      recompute();
      S.activity.unshift({ title: (S.job.id && jobById(S.job.id)?.title) || S.screen.job.title || title, n: S.screen.candidates.length, counts: S.screen.counts,
        flags: S.screen.candidates.filter(c => c.integrity?.suspicious).length, at: new Date().toISOString() });
      S.activity = S.activity.slice(0, 6);
      window.scrollTo(0, 0);
      if (route() !== 'screen') location.hash = '#/screen'; else render();
      setTimeout(() => { S.dealt = false; }, 1600);
      toast(`Screened ${S.screen.candidates.length} candidates`);
    } catch (e) { S.run = null; renderOverlays(); toast(e.message, true); render(false); }
  }

  async function runImprove(keepBase) {
    const btn = document.querySelector('[data-act="run-improve"]');
    if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.innerHTML = `${I('refresh', 16)} Analysing…`; }
    try {
      const r = await api('/api/analyze', { resume: S.imp.resume.text, job: S.imp.job, assume_skills: [...S.imp.assume] });
      if (!keepBase) { S.imp.base = r.score; window.scrollTo(0, 0); }
      S.imp.result = r;
      render(!keepBase);
    } catch (e) { toast(e.message, true); render(false); }
  }

  async function uploadFiles(files, target) {
    for (const f of files) {
      const fd = new FormData(); fd.append('file', f);
      try {
        const r = await api('/api/parse-file', fd);
        if (target === 'multi') {
          if (S.resumes.length >= 50) { toast('Up to 50 resumes at a time', true); break; }
          S.resumes.push({ name: r.name, text: r.text, words: r.words });
        } else if (target === 'job') S.job = { id: null, name: r.name, text: r.text };
        else if (target === 'imp') S.imp.resume = { name: r.name, text: r.text };
        else if (target === 'editor' && S.editor) { S.editor.f.description = r.text; await refreshPreview(true); if (!S.editor.f.title && S.editor.preview?.title) S.editor.f.title = S.editor.preview.title; return renderOverlays(); }
      } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
    render(false);
  }

  function copy(text) {
    navigator.clipboard?.writeText(text).then(() => toast('Copied'), () => toast('Could not copy', true));
  }

  let pendingTarget = 'multi';
  function wire() {
    document.addEventListener('click', async ev => {
      const t = ev.target.closest('[data-act]');
      const card = ev.target.closest('[data-cand]');
      if (t) {
        const a = t.dataset.act;
        if (t.classList.contains('modal-scrim') && ev.target !== t) return;  // clicks inside a modal body
        if (a !== 'upload-multi' || ev.target.tagName !== 'A') ev.preventDefault();
        if (a === 'new-job') return openEditor(null, route() === 'screen' ? 'screen' : 'jobs');
        if (a === 'edit-job') { const j = jobById(t.dataset.id); return j ? openEditor(j) : toast('Job not found', true); }
        if (a === 'save-to-library') {
          openEditor(null, 'screen'); S.editor.f.description = S.job.text; await refreshPreview(true);
          if (S.editor.preview?.title) S.editor.f.title = S.editor.preview.title; return renderOverlays();
        }
        if (a === 'close-editor') { S.editor = null; return renderOverlays(); }
        if (a === 'ed-status') { S.editor.f.status = t.dataset.s; t.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === t)); return; }
        if (a === 'upload-editor') { pendingTarget = 'editor'; return $('file-one').click(); }
        if (a === 'save-job') return saveJob();
        if (a === 'job-filter') { S.jobFilter = t.dataset.f; store.set('ri2-jobfilter', S.jobFilter); return render(false); }
        if (a === 'screen-job') { const j = jobById(t.dataset.id); if (!j) return;
          useJob(j); S.screen = null; S.drawer = null; S.compare.clear();
          if (route() === 'screen') render(); else location.hash = '#/screen';
          return toast(S.resumes.length ? `${j.title} selected. Ready to screen.` : `${j.title} selected. Now add resumes.`); }
        if (a === 'dup-job') {
          try { const copy = await api(`/api/jobs/${t.dataset.id}/duplicate`, {}); await loadJobs(); render(false);
            toast('Copied as a draft (On hold)'); return openEditor(jobById(copy.id)); } catch (e) { return toast(e.message, true); } }
        if (a === 'del-job') { const j = jobById(t.dataset.id); S.confirm = { id: j.id, title: j.title, status: j.status }; return renderOverlays(); }
        if (a === 'close-confirm') { S.confirm = null; return renderOverlays(); }
        if (a === 'close-instead') {
          try { await api(`/api/jobs/${t.dataset.id}`, { status: 'Closed' }, 'PUT'); S.confirm = null; await loadJobs(); render(false); return toast('Job closed. History kept.'); }
          catch (e) { return toast(e.message, true); } }
        if (a === 'confirm-delete') {
          const id = +t.dataset.id;
          try { await api(`/api/jobs/${id}`, null, 'DELETE'); } catch (e) { return toast(e.message, true); }
          if (S.job.id === id) S.job.id = null;
          if (S.imp.jobId === id) S.imp.jobId = null;
          S.confirm = null; await loadJobs(); render(false); return toast('Job deleted');
        }
        if (a === 'demo-screen') { const s = await samples();
          const lib = (S.jobs || []).find(j => j.status === 'Open' && /^data scientist/i.test(j.title));
          if (lib) useJob(lib); else S.job = { id: null, name: 'sample', text: s.jobs[1].text }; S.resumes = s.resumes.map(r => ({ ...r })); render(false); return runScreen(); }
        if (a === 'sample-job') { const s = await samples(); S.job = { id: null, name: s.jobs[+t.dataset.i].id, text: s.jobs[+t.dataset.i].text }; return render(false); }
        if (a === 'sample-resumes') { ev.stopPropagation(); const s = await samples(); S.resumes = s.resumes.map(r => ({ ...r })); return render(false); }
        if (a === 'upload-multi') { if (ev.target.closest('a')) return; pendingTarget = 'multi'; return $('file-multi').click(); }
        if (a === 'upload-job') { pendingTarget = 'job'; return $('file-one').click(); }
        if (a === 'upload-imp') { pendingTarget = 'imp'; return $('file-one').click(); }
        if (a === 'rm-resume') { const i = +t.dataset.i, [r] = S.resumes.splice(i, 1); render(false);
          return toast(`${r.name} removed`, false, { label: 'Undo', run: () => { S.resumes.splice(i, 0, r); render(false); } }); }
        if (a === 'run-screen') return runScreen();
        if (a === 'edit-inputs') { S.screen = null; S.drawer = null; S.compare.clear(); window.scrollTo(0, 0); return render(); }
        if (a === 'export') return exportCsv();
        if (a === 'view') return setView(t.dataset.v);
        if (a === 'palette') return openPalette();
        if (a === 'pal-run') return runPalette(+t.dataset.i);
        if (a === 'pal-close') { if (ev.target === t) { S.palette = null; renderOverlays(); } return; }
        if (a === 'shortcuts') { S.shortcuts = true; return renderOverlays(); }
        if (a === 'close-shortcuts') { if (ev.target === t || t.classList.contains('icon-btn')) { S.shortcuts = false; renderOverlays(); } return; }
        if (a === 'drawer-step') return stepDrawer(+t.dataset.d);
        if (a === 'show-flagged') return setView('insights');
        if (a === 'cmp') { ev.stopPropagation(); const id = t.dataset.id;
          if (S.compare.has(id)) S.compare.delete(id); else if (S.compare.size < 3) S.compare.add(id); else toast('Compare up to 3 at a time', true);
          $('results').innerHTML = resultsView(); return renderOverlays(); }
        if (a === 'open-compare') { S.compareOpen = true; return renderOverlays(); }
        if (a === 'clear-compare') { S.compare.clear(); $('results').innerHTML = resultsView(); return renderOverlays(); }
        if (a === 'close-compare') { if (ev.target === t || t.classList.contains('icon-btn')) { S.compareOpen = false; renderOverlays(); } return; }
        if (a === 'close-drawer') { S.drawer = null; return renderOverlays(); }
        if (a === 'tab') { S.tab = t.dataset.t; return renderOverlays(); }
        if (a === 'copy-qs') { const c = S.screen.candidates.find(x => x.id === S.drawer); return copy(c.questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')); }
        if (a === 'copy-fb') { const c = S.screen.candidates.find(x => x.id === S.drawer);
          return copy('Thank you for applying. A few things that would strengthen your application:\n\n' + c.suggestions.slice(0, 4).map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`).join('\n')); }
        if (a === 'copy') return copy(t.dataset.text);
        if (a === 'demo-improve') { const s = await samples(); S.imp.resume = { name: s.resumes[3].name, text: s.resumes[3].text }; S.imp.job = s.jobs[1].text; S.imp.jobId = null; S.imp.assume.clear(); render(false); return runImprove(); }
        if (a === 'imp-sample-job') { const s = await samples(); S.imp.job = s.jobs[+t.dataset.i].text; return render(false); }
        if (a === 'run-improve') { S.imp.assume.clear(); return runImprove(); }
        if (a === 'imp-reset') { S.imp.result = null; S.imp.base = null; S.imp.assume.clear(); window.scrollTo(0, 0); return render(); }
        if (a === 'assume') { const s = t.dataset.s; S.imp.assume.has(s) ? S.imp.assume.delete(s) : S.imp.assume.add(s); return runImprove(true); }
        // ---- v2.3 interactions
        const cur = () => S.screen?.candidates.find(x => x.id === S.drawer);
        const refreshMain = () => { if ($('results') && ['board', 'table', 'pipeline'].includes(S.view)) $('results').innerHTML = resultsView(); };
        if (a === 'kpi') { S.detail = { k: t.dataset.k }; return renderOverlays(); }
        if (a === 'label') return setLabel(cur(), t.dataset.l);
        if (a === 'unlabel') { delete S.labels[cur().file]; renderOverlays(); refreshMain(); $('top-actions').innerHTML = topActions('screen'); return; }
        if (a === 'next-unlabelled') { const n = nextUnlabelled(cur()); if (n) { S.drawer = n.id; S.tab = 'overview'; renderOverlays(); } return; }
        if (a === 'dl-labels') return downloadLabels();
        if (a === 'close-detail') { if (ev.target === t || t.classList.contains('icon-btn')) { S.detail = null; renderOverlays(); } return; }
        if (a === 'open-cand') { S.detail = null; S.drawer = t.dataset.id; S.tab = 'overview'; if (route() !== 'screen') location.hash = '#/screen'; return renderOverlays(); }
        if (a === 'explain') { ev.stopPropagation(); S.drawer = t.dataset.id; S.tab = 'evidence'; return renderOverlays(); }
        if (a === 'tune') { S.tune = !S.tune; refreshResults(); return renderOverlays(); }
        if (a === 'close-tune') { S.tune = false; refreshResults(); return renderOverlays(); }
        if (a === 'preset') { S.weights = { ...PRESETS[t.dataset.p] }; recompute(); refreshResults(); renderOverlays(); return toast(`${t.dataset.p} weights applied`); }
        if (a === 'reset-weights') { S.weights = null; recompute(); refreshResults(); renderOverlays(); return toast('Back to the model weights'); }
        if (a === 'set-stage') return setStage(S.drawer, t.dataset.s);
        if (a === 'add-tag') { const c = cur(); if (!c) return; const v = (t.dataset.t || $('tag-in')?.value || '').trim(); if (!v) return;
          const p = pipeOf(c); if (!p.tags.includes(v)) p.tags.push(v); renderOverlays(); refreshMain(); setTimeout(() => $('tag-in')?.focus(), 0); return; }
        if (a === 'rm-tag') { const p = pipeOf(cur()), i = +t.dataset.i, [x] = p.tags.splice(i, 1); renderOverlays(); refreshMain();
          return toast(`Tag “${x}” removed`, false, { label: 'Undo', run: () => { p.tags.splice(i, 0, x); renderOverlays(); refreshMain(); } }); }
        if (a === 'add-note') { const v = $('note-in')?.value.trim(); if (!v) return toast('Write the note first', true);
          pipeOf(cur()).notes.unshift({ text: v.slice(0, 2000), at: new Date().toISOString() }); renderOverlays(); refreshMain(); return toast('Note added'); }
        if (a === 'rm-note') { const p = pipeOf(cur()), i = +t.dataset.i, [n] = p.notes.splice(i, 1); renderOverlays(); refreshMain();
          return toast('Note deleted', false, { label: 'Undo', run: () => { p.notes.splice(i, 0, n); renderOverlays(); refreshMain(); } }); }
        if (a === 'clear-notes') { const p = pipeOf(cur()), old = p.notes; p.notes = []; renderOverlays(); refreshMain();
          return toast(`${old.length} notes deleted`, false, { label: 'Undo', run: () => { p.notes = old; renderOverlays(); refreshMain(); } }); }
        if (a === 'remove-cand') return removeCandidate(t.dataset.id);
        if (a === 'hl') { const k = t.dataset.k; S.hl.has(k) ? S.hl.delete(k) : S.hl.add(k); return renderOverlays(); }
        if (a === 'clear-groups') { const old = S.groups; S.groups = {}; $('results').innerHTML = resultsView();
          return toast('Groups cleared', false, { label: 'Undo', run: () => { S.groups = old; $('results').innerHTML = resultsView(); } }); }
        if (a === 'rm-activity') { const i = +t.dataset.i, [x] = S.activity.splice(i, 1); render(false);
          return toast('Removed from the session list', false, { label: 'Undo', run: () => { S.activity.splice(i, 0, x); render(false); } }); }
        if (a === 'clear-activity') { const old = S.activity; S.activity = []; render(false);
          return toast('Session list cleared', false, { label: 'Undo', run: () => { S.activity = old; render(false); } }); }
        if (a === 'rm-all-resumes') { const old = S.resumes; S.resumes = []; render(false);
          return toast(`${old.length} resumes removed`, false, { label: 'Undo', run: () => { S.resumes = old; render(false); } }); }
        return;
      }
      if (card && !ev.target.closest('.cmp-check')) { S.drawer = card.dataset.cand; S.tab = 'overview'; renderOverlays(); }
    });

    document.addEventListener('ri-act', e => { const b = Object.assign(document.createElement('button'), { hidden: true }); b.dataset.act = e.detail;
      document.body.appendChild(b); b.click(); b.remove(); });

    document.addEventListener('keydown', ev => {
      const typing = !!ev.target.matches?.('input, textarea, select, [contenteditable]');
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); if (S.palette) { S.palette = null; return renderOverlays(); } return openPalette(); }
      if (S.palette) {
        const n = paletteResults().length;
        if (ev.key === 'Escape') { S.palette = null; return renderOverlays(); }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); S.palette.i = (S.palette.i + (ev.key === 'ArrowDown' ? 1 : -1) + n) % Math.max(n, 1);
          $('pal-list').innerHTML = paletteList(); document.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' }); return; }
        if (ev.key === 'Enter') { ev.preventDefault(); return runPalette(S.palette.i); }
        return;
      }
      if (S.shortcuts && ev.key === 'Escape') { S.shortcuts = false; return renderOverlays(); }
      if (S.detail && ev.key === 'Escape') { S.detail = null; return renderOverlays(); }
      if (ev.key === 'Enter' && ev.target.id === 'tag-in') { ev.preventDefault(); return document.querySelector('[data-act="add-tag"]:not([data-t])')?.click(); }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('[data-act="kpi"]')) { ev.preventDefault(); return ev.target.click(); }
      if (S.tune && ev.key === 'Escape' && !S.drawer) { S.tune = false; refreshResults(); return renderOverlays(); }
      if (S.run) return;
      if (!typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !S.editor && !S.confirm) {
        if (ev.key === '?') { S.shortcuts = !S.shortcuts; return renderOverlays(); }
        if (S.drawer && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); return stepDrawer(ev.key === 'ArrowRight' ? 1 : -1); }
        if (S.drawer && ['s', 'm', 'r'].includes(ev.key.toLowerCase())) {
          const c = S.screen.candidates.find(x => x.id === S.drawer); if (!c) return;
          setLabel(c, { s: 'shortlist', m: 'maybe', r: 'reject' }[ev.key.toLowerCase()]);
          const n = nextUnlabelled(c); if (n) setTimeout(() => { S.drawer = n.id; S.tab = 'overview'; renderOverlays(); }, 260);
          return;
        }
        if (route() === 'screen' && S.screen && !S.drawer && /^[1-5]$/.test(ev.key)) return setView(RTABS[+ev.key - 1][0]);
      }
      if (ev.key === 'Escape' && (S.confirm || S.editor)) { if (S.confirm) S.confirm = null; else S.editor = null; return renderOverlays(); }
      if (ev.key === 'Escape') { if (S.compareOpen) S.compareOpen = false; else if (S.drawer) S.drawer = null; else return; renderOverlays(); }
      if (ev.key === 'Enter' && ev.target.matches?.('[data-cand]')) { S.drawer = ev.target.dataset.cand; S.tab = 'overview'; renderOverlays(); }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches?.('.drop')) { ev.preventDefault(); pendingTarget = 'multi'; $('file-multi').click(); }
    });

    document.addEventListener('input', ev => {
      if (ev.target.id === 'job-text') {
        S.job.text = ev.target.value;
        if (S.job.id && jobById(S.job.id)?.description !== S.job.text) S.job.id = null;
        const l = $('job-link'); if (l) l.innerHTML = jobLink();
        const pick = $('job-pick'); if (pick && !S.job.id) pick.value = '';
        refreshCta();
      }
      if (ev.target.dataset?.f && S.editor && ev.target.closest('.modal-form')) {
        S.editor.f[ev.target.dataset.f] = ev.target.value;
        if (ev.target.dataset.f === 'description') refreshPreview();
        const err = $('ed-err'); if (err) err.textContent = '';
      }
      if (ev.target.id === 'jq') { S.jobQ = ev.target.value; $('jobs-results').innerHTML = jobsGrid(); }
      if (ev.target.id === 'imp-resume') { S.imp.resume.text = ev.target.value; refreshCta(); }
      if (ev.target.id === 'imp-job') { S.imp.job = ev.target.value; S.imp.jobId = null; const p = $('imp-job-pick'); if (p) p.value = ''; refreshCta(); }
      if (ev.target.id === 'q') { S.q = ev.target.value; $('results').innerHTML = resultsView(); }
      if (ev.target.dataset?.w) return setWeight(ev.target.dataset.w, +ev.target.value);
      if (ev.target.id === 'pal-q') { S.palette.q = ev.target.value; S.palette.i = 0; $('pal-list').innerHTML = paletteList(); }
    });
    document.addEventListener('change', ev => {
      if (ev.target.id === 'job-pick') {
        const j = jobById(ev.target.value);
        if (j) useJob(j); else S.job = { id: null, name: '', text: '' };
        return render(false);
      }
      if (ev.target.id === 'imp-job-pick') {
        const j = jobById(ev.target.value);
        S.imp.jobId = j ? j.id : null; S.imp.job = j ? j.description : '';
        return render(false);
      }
      if (ev.target.dataset?.f === 'employment_type' && S.editor) S.editor.f.employment_type = ev.target.value;
      if (ev.target.dataset?.jobStatus) {
        const id = ev.target.dataset.jobStatus, status = ev.target.value;
        api(`/api/jobs/${id}`, { status }, 'PUT').then(loadJobs).then(() => { render(false); toast(`Status set to ${status}`); })
          .catch(e => { toast(e.message, true); render(false); });
        return;
      }
      if (ev.target.dataset?.fair) { S.fair[ev.target.dataset.fair] = ev.target.value; $('results').innerHTML = resultsView(); return; }
      if (ev.target.dataset?.group !== undefined) { const v = ev.target.value.trim(); if (v) S.groups[ev.target.dataset.group] = v; else delete S.groups[ev.target.dataset.group];
        $('results').innerHTML = resultsView(); return; }
      if (ev.target.id === 'blind') { S.blind = ev.target.checked; store.set('ri2-blind', S.blind ? 'on' : 'off'); render(false); }
      if (ev.target.id === 'file-multi' || ev.target.id === 'file-one') { uploadFiles([...ev.target.files], pendingTarget); ev.target.value = ''; }
    });

    document.addEventListener('dragstart', ev => { const c = ev.target.closest?.('.pcard'); if (!c) return;
      ev.dataTransfer.setData('text/plain', c.dataset.cand); ev.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
    document.addEventListener('dragend', ev => { ev.target.closest?.('.pcard')?.classList.remove('dragging'); document.querySelectorAll('.pcol.over').forEach(n => n.classList.remove('over')); });
    document.addEventListener('dragover', ev => { const col = ev.target.closest?.('.pcol'); if (col) { ev.preventDefault(); document.querySelectorAll('.pcol.over').forEach(n => n !== col && n.classList.remove('over')); col.classList.add('over'); } });
    document.addEventListener('drop', ev => { const col = ev.target.closest?.('.pcol'); if (!col) return; ev.preventDefault(); col.classList.remove('over');
      const id = ev.dataTransfer.getData('text/plain'); if (id) setStage(id, col.dataset.stage); });
    document.addEventListener('dragover', ev => { const d = ev.target.closest('.drop'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
    document.addEventListener('dragleave', ev => { const d = ev.target.closest('.drop'); if (d) d.classList.remove('over'); });
    document.addEventListener('drop', ev => { const d = ev.target.closest('.drop'); if (!d) return; ev.preventDefault(); d.classList.remove('over'); uploadFiles([...ev.dataTransfer.files], 'multi'); });

    document.addEventListener('mouseover', ev => { const t = ev.target.closest('[data-tip]'); if (t) showTip(t); });
    document.addEventListener('mouseout', ev => { if (ev.target.closest('[data-tip]')) $('tipbox').hidden = true; });
    window.addEventListener('scroll', () => { $('top').classList.toggle('scrolled', scrollY > 4); $('tipbox').hidden = true; }, { passive: true });
    window.addEventListener('hashchange', () => { if (document.activeElement?.closest('.side')) document.activeElement.blur(); render(); });
    $('theme').addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
      dark ? document.documentElement.setAttribute('data-theme', 'dark') : document.documentElement.removeAttribute('data-theme');
      store.set('ri2-theme', dark ? 'dark' : 'light'); setThemeIcon();
    });
    $('menu').addEventListener('click', () => $('shell').classList.toggle('menu'));
  }

  function setView(v) {
    if (S.view === v) return;
    S.view = v; store.set('ri2-view', ['board', 'table', 'pipeline'].includes(v) ? v : 'board');
    document.querySelectorAll('.tabseg button').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    const srch = document.querySelector('.toolbar .search'); if (srch) srch.hidden = ['insights', 'fairness'].includes(v);
    const r = $('results'); r.innerHTML = resultsView(); r.classList.remove('swap'); void r.offsetWidth; r.classList.add('swap');
    if (!reduced) r.querySelectorAll('[data-count]').forEach(n => { delete n.dataset.done; });
    animateCounts(r);
  }

  function stepDrawer(d) {
    const cs = S.screen.candidates, i = cs.findIndex(c => c.id === S.drawer), j = i + d;
    if (i < 0 || j < 0 || j >= cs.length) return;
    S.drawer = cs[j].id; renderOverlays();
    document.querySelector('.drawer')?.classList.add(d > 0 ? 'step-next' : 'step-prev');
  }

  function refreshCta() {
    // Update readiness without re-rendering the textarea being typed in.
    const r = route();
    const ready = r === 'screen' ? S.job.text.trim().length > 20 && S.resumes.length
      : S.imp.resume.text.trim().length > 20 && S.imp.job.trim().length > 20;
    const b = document.querySelector('[data-act="run-screen"], [data-act="run-improve"]');
    if (b) b.disabled = !ready;
  }

  function showTip(t, text, side) {
    const box = $('tipbox'); box.textContent = text || t.dataset.tip; box.hidden = false;
    const r = t.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
    if (side) { x = r.right + 10; y = r.top + r.height / 2 - h / 2; }
    box.style.left = Math.min(Math.max(8, x), innerWidth - w - 8) + 'px'; box.style.top = y + 'px';
  }

  function setThemeIcon() {
    $('theme').innerHTML = I(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon', 18);
  }

  const kk = $('kbd-k'); if (kk) kk.textContent = `${MOD} K`;
  Icons.hydrate();
  setThemeIcon();
  wire();
  render();
  return { S, render };
})();
