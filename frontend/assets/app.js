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

  function toast(msg, err) {
    let host = $('toasts');
    if (!host) { host = Object.assign(document.createElement('div'), { id: 'toasts', className: 'toasts' });
      host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
    while (host.children.length >= 3) host.firstChild.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = `${I(err ? 'alert' : 'check')}<span>${esc(msg)}</span><i class="toast-timer"></i>`;
    host.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, 3400);
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
        ${[['board', 'board', 'Board', '1'], ['table', 'table', 'Ranked list', '2'], ['insights', 'segments', 'Insights', '3']].map(([v, ic, l, k]) =>
          `<button role="tab" aria-selected="${S.view === v}" class="${S.view === v ? 'on' : ''}" data-act="view" data-v="${v}" title="${l} (${k})">${I(ic, 15)} ${l}</button>`).join('')}
      </div>
      <label class="search" ${S.view === 'insights' ? 'hidden' : ''}>${I('search', 15)}<input type="search" id="q" placeholder="Search name, file or skill" value="${esc(S.q)}"></label>
      <label class="switch" title="Hide names to reduce bias"><input type="checkbox" id="blind" ${S.blind ? 'checked' : ''}><i></i>Blind screening</label>
      <span style="flex:1"></span>
      ${flagged().length ? `<button class="chip flag-chip" data-act="show-flagged">${I('anomaly', 13)}${flagged().length} flagged for integrity</button>` : ''}
      <span class="small muted hide-sm">${I('compare', 14)} Tick up to 3 to compare</span>
    </div>
    <div id="results">${resultsView()}</div>`;
  }

  function ccard(c, i) {
    const shown = c.skills.filter(s => s.importance === 'must' && s.status === 'shown').slice(0, 3);
    const miss = c.skills.filter(s => s.importance === 'must' && s.status === 'missing').length;
    return `<article class="ccard ${S.compare.has(c.id) ? 'sel' : ''} ${S.dealt ? 'dealt' : ''}" data-cand="${c.id}" style="--i:${S.dealt ? c.rank : i}" tabindex="0" aria-label="${esc(candName(c))}, score ${Math.round(c.score)}, ${esc(c.verdict.label)}">
      <div class="ccard-top">${avatar(c)}<div class="who"><b>${esc(candName(c))}</b><span>${esc(c.file)}</span></div>${ring(c.score, 44, 5)}</div>
      ${c.integrity?.suspicious ? `<div class="flag">${I('anomaly', 13)}Possible keyword stuffing</div>` : ''}
      <div class="meta"><span>${I('target', 13)}${c.summary.must_matched}/${S.screen.job.must_units.length} must</span>
        <span>${I('clock', 13)}${c.summary.years != null ? c.summary.years + ' yrs' : 'n/a'}</span>
        <span>${I('gauge', 13)}${c.confidence.level}</span></div>
      <div class="chips">${shown.map(s => `<span class="chip shown">${esc(s.matched || s.skill)}</span>`).join('')}
        ${miss ? `<span class="chip missing">${miss} missing</span>` : ''}</div>
      <div class="row" style="margin-top:10px;justify-content:space-between">
        <span class="tiny muted">#${c.rank}</span>
        <button class="cmp-check ${S.compare.has(c.id) ? 'on' : ''}" data-act="cmp" data-id="${c.id}" aria-label="Compare">${I('check', 13)}</button>
      </div></article>`;
  }

  function board() {
    const list = filtered();
    return `<div class="board">${Object.keys(VERD).map(k => {
      const items = list.filter(c => c.verdict.key === k);
      return `<div class="col"><div class="col-head">${pill(k)}<span class="n">${items.length}</span></div>
        ${items.map((c, i) => ccard(c, i)).join('') || '<div class="empty-col">No candidates here</div>'}</div>`;
    }).join('')}</div>`;
  }

  function table() {
    const list = filtered();
    return `<section class="card" style="overflow:hidden"><div style="overflow-x:auto"><table class="tbl"><thead><tr>
      <th>#</th><th>Candidate</th><th>Score</th><th>Verdict</th><th class="num">Must-haves</th><th class="num">Years</th><th>Top risk</th><th></th>
      </tr></thead><tbody>${list.map(c => `<tr data-cand="${c.id}">
        <td class="muted">${c.rank}</td>
        <td><div class="row" style="flex-wrap:nowrap">${avatar(c)}<div><b>${esc(candName(c))}</b>${c.integrity?.suspicious ? ` <span class="flag inline" data-tip="Possible keyword stuffing">${I('anomaly', 12)}</span>` : ''}<div class="tiny muted">${esc(c.file)}</div></div></div></td>
        <td><div class="scorecell"><b>${Math.round(c.score)}</b>${bar(c.score, scoreColor(c.score))}</div></td>
        <td>${pill(c.verdict.key)}</td>
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
      <div class="decision"><span class="hic" style="background:color-mix(in srgb, ${VERD[c.verdict.key].c} 14%, transparent);color:${VERD[c.verdict.key].c}">${I(VERD[c.verdict.key].icon, 18)}</span>
        <div><h3>${esc(c.verdict.label)}</h3><p>${esc(c.verdict.next)}</p>
          ${c.verdict.knockouts.length ? `<div class="chips" style="margin-top:8px">${c.verdict.knockouts.map(k => `<span class="chip missing">${I('alert', 12)}${esc(k)}</span>`).join('')}</div>` : ''}</div></div>
      ${c.integrity?.flags?.length ? `<div class="integrity"><div class="row" style="justify-content:space-between"><b>${I('anomaly', 15)} Integrity checks</b><span class="small">−${c.integrity.penalty} points</span></div>
        <ul>${c.integrity.flags.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <p class="small">These patterns usually mean a resume was written for screening software. Read it yourself before deciding.</p></div>` : ''}
      <div class="sec-title">Why</div>
      <ul class="list good">${c.strengths.map(s => `<li>${I('check')}${esc(s)}</li>`).join('') || '<li class="muted">No clear strengths against this job.</li>'}</ul>
      <div class="sec-title">Risks to check</div>
      <ul class="list bad">${c.risks.filter(s => !s.startsWith('Integrity:')).map(s => `<li>${I('alert')}${esc(s)}</li>`).join('') || '<li class="muted">No notable risks.</li>'}</ul>
      <div class="sec-title">Score breakdown</div>
      ${c.parts.filter(p => p.value !== null).map(p => `<div class="part"><span>${esc(p.label)} ${tip(PART_TIPS[p.key])}<span class="w">weight ${p.weight}%</span></span>
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
        <div class="row" style="margin-top:16px;gap:16px">${ring(c.score, 76, 8)}
          <div class="stack" style="gap:6px">${pill(c.verdict.key)}<span class="small muted">${I('gauge', 13)} Confidence: <b>${c.confidence.level}</b></span>
            <span class="small muted">${I('target', 13)} ${c.summary.must_matched}/${S.screen.job.must_units.length} must-haves · ${c.summary.years ?? '—'} yrs · ${c.summary.quantified} measurable bullets</span></div></div>
        <div class="tabs">${tab('overview', 'Decision', 'scale')}${tab('skills', 'Skills', 'target')}${tab('interview', 'Interview kit', 'message')}${tab('feedback', 'Feedback', 'wand')}</div>
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
    if (S.run) add(runOverlay());
    if (S.palette) add(paletteModal());
    if (S.shortcuts) add(shortcutsModal());
    if (S.editor) add(editorModal());
    if (S.confirm) add(confirmModal());
    document.body.classList.toggle('modal-open', !!(S.editor || S.confirm || S.palette || S.shortcuts || S.run));
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
    const kpi = (k, label, v, c, help) => `<div class="kpi anim" style="--c:${c}"><div class="k">${I(k, 14)}${label}${help ? tip(help) : ''}</div><div class="v" data-count>${v}</div></div>`;
    const count = st => st === 'All' ? all.length : all.filter(j => j.status === st).length;
    return `
    <div class="page-head anim">
      <div><h1>Job library</h1><p>Every role the company is hiring for, in one place. Save a job description once, edit it as the role changes,
        and screen new applicants against it in one click.</p></div>
      <button class="btn btn-grad" data-act="new-job">${I('plus', 16)} New job</button>
    </div>
    <div class="kpis k4">
      ${kpi('briefcase', 'Open roles', open.length, 'var(--iris)')}
      ${kpi('users', 'Open positions', open.reduce((a, j) => a + j.openings, 0), 'var(--teal)', 'Headcount still to fill across open roles.')}
      ${kpi('fileText', 'Resumes screened', sum('candidates_screened'), 'var(--amber)', 'Total across all screenings. Only the count is kept, never the resumes.')}
      ${kpi('star', 'Shortlisted', sum('shortlisted'), 'var(--green)', 'Candidates who reached Strong shortlist or Shortlist.')}
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
    const W = [['Must-have skills', 38], ['Text relevance', 13], ['Experience', 14], ['Evidence of impact', 12], ['Nice-to-have skills', 10], ['Resume quality', 8], ['Education', 5]];
    return `
    <div class="page-head anim"><div><h1>How scoring works</h1><p>Every number on screen can be traced to a rule below. No black box, no personal data used.</p></div></div>
    <div class="grid g2">
      <section class="card anim"><div class="card-head"><div><h2><span class="hic">${I('scale')}</span>What the score is made of</h2><p>Weights out of 100. Parts that don’t apply (e.g. no education requirement) are left out and the rest re-weighted.</p></div></div>
        <div class="card-body weights">${W.map(([l, w]) => `<div class="weight"><span>${l}</span>${bar(w / 38 * 100)}<b>${w}%</b></div>`).join('')}</div></section>
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
  const resultsView = () => S.view === 'insights' ? insights() : S.view === 'table' ? table() : board();

  /* The verdict pipeline: one stacked bar, 2px surface gaps, labelled legend below. */
  function pipelineBar(counts, n, compact, head) {
    if (!n) return '';
    const segs = ORDER.filter(k => counts[k]), sl = (counts.strong || 0) + (counts.shortlist || 0);
    return `<section class="pipe anim ${compact ? 'compact' : ''}" aria-label="Verdict mix">
      ${head ? `<div class="pipe-head"><div><b data-count>${n}</b><span>candidates screened</span></div><div><b>${sl}</b><span>on the shortlist (${pct(sl, n)}%)</span></div>
        ${flagged().length ? `<div class="warn"><b>${flagged().length}</b><span>flagged for integrity</span></div>` : ''}</div>` : ''}
      <div class="pipe-bar" role="img" aria-label="${ORDER.map(k => `${VERD[k].label} ${counts[k] || 0}`).join(', ')}">
        ${segs.map((k, i) => `<i style="flex:${counts[k]};background:${VERD[k].m};--i:${i}" data-tip="${VERD[k].label}: ${counts[k]} of ${n} (${pct(counts[k], n)}%)"></i>`).join('')}
      </div>
      <div class="pipe-legend">${ORDER.map(k => `<span><i style="background:${VERD[k].m}"></i>${VERD[k].label}<b>${counts[k] || 0}</b><em>${pct(counts[k] || 0, n)}%</em></span>`).join('')}</div>
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
    if (fl.length) reco.push(['anomaly', `${fl.length} resume${fl.length > 1 ? 's' : ''} look${fl.length > 1 ? '' : 's'} written for screening software. Read ${fl.length > 1 ? 'them' : 'it'} before deciding.`]);
    if (related) reco.push(['compass', `${related} must-have match${related > 1 ? 'es are' : ' is'} described without naming the tool. The interview kit asks which tool was used.`]);
    if ((d.counts.strong + d.counts.shortlist) === 0) reco.push(['help', 'No one reached the shortlist. The bar may be set too high for this market, or the advert may need more applicants.']);
    if (!reco.length) reco.push(['check', 'The pool covers the must-haves well. Start with the strong shortlist.']);
    return `<div class="insights">
      <div class="stats4">
        <div class="stat anim"><span>Average score</span><b data-count>${Math.round(avg)}</b><em>median ${Math.round(med)}</em></div>
        <div class="stat anim"><span>Shortlist rate</span><b>${pct(d.counts.strong + d.counts.shortlist, n)}%</b><em>${d.counts.strong + d.counts.shortlist} of ${n} candidates</em></div>
        <div class="stat anim"><span>Must-haves nobody has</span><b data-count>${gaps.length}</b><em>of ${d.skill_coverage.length} requirements</em></div>
        <div class="stat anim"><span>Integrity flags</span><b data-count>${fl.length}</b><em>${fl.length ? 'read before deciding' : 'no stuffing detected'}</em></div>
      </div>
      <div class="grid g2">
        <section class="card anim"><div class="card-head"><div><h2>Score distribution</h2><p>Candidates per 10-point band. Lines mark the verdict thresholds: 48 Interview to verify, 62 Shortlist, 74 Strong shortlist.</p></div></div>
          <div class="card-body">${histogram(cs)}</div></section>
        <section class="card anim"><div class="card-head"><div><h2>What to do next</h2><p>Read from this pool's gaps and flags.</p></div></div>
          <div class="card-body"><ul class="reco">${reco.map(([ic, t], i) => `<li style="--i:${i}"><span class="hic">${I(ic, 15)}</span><span>${esc(t)}</span></li>`).join('')}</ul></div></section>
        <section class="card anim"><div class="card-head"><div><h2>Must-have coverage</h2><p>Share of candidates who show or list each requirement, rarest first.</p></div></div>
          <div class="card-body">${coverageBars(d.skill_coverage)}</div></section>
        <section class="card anim"><div class="card-head"><div><h2>Integrity checks</h2><p>Copied job text, crammed bullets and inflated years. Flagged resumes stop at <b>Interview to verify</b>.</p></div></div>
          <div class="card-body">${fl.length ? `<div class="stack" style="gap:8px">${fl.map(c => `<button class="flag-row" data-cand="${c.id}">${avatar(c)}<div><b>${esc(candName(c))}</b>
            <div class="small muted">${c.integrity.flags.map(esc).join(' · ')}</div></div><span class="small">−${c.integrity.penalty}</span></button>`).join('')}</div>`
            : `<div class="empty-mini">${I('shield', 22)}<b>No integrity flags</b><span class="small muted">No copied job text, crammed bullets or inflated experience in this pool.</span></div>`}</div></section>
      </div>
      <section class="card anim" style="margin-top:16px">
        <div class="card-head"><div><h2>Skill heatmap</h2><p>Every candidate against every must-have. Hover a cell for detail.</p></div>
          <div class="legend"><span><i style="background:var(--green)"></i>Shown in work</span><span><i style="background:color-mix(in srgb,var(--amber) 55%,transparent)"></i>Listed only</span><span><i style="background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--amber) 45%,transparent) 0 3px,var(--surface-3) 3px 6px)"></i>Described, not named</span><span><i style="background:var(--surface-3)"></i>Missing</span></div></div>
        <div class="card-body heat">${heatmap()}</div>
      </section>
    </div>`;
  }

  /* ---------------------------------------------------------------- overview */
  function overviewPage() {
    const jobs = S.jobs || [], open = jobs.filter(j => j.status === 'Open');
    const screened = jobs.reduce((a, j) => a + (j.candidates_screened || 0), 0), short = jobs.reduce((a, j) => a + (j.shortlisted || 0), 0);
    const kpi = (k, label, v, sub, suffix = '') => `<div class="kpi anim"><div class="k">${I(k, 14)}${label}</div><div class="v"><span data-count>${v}</span>${suffix}</div><div class="kpi-sub">${sub}</div></div>`;
    const tot = { strong: 0, shortlist: 0, verify: 0, reject: 0 };
    S.activity.forEach(a => ORDER.forEach(k => tot[k] += a.counts[k]));
    const sessN = S.activity.reduce((a, x) => a + x.n, 0), ev = S.model?.evaluation;
    if (!S.model && !S.modelLoading) loadModel();
    return `
    <div class="page-head anim"><div><h1>Hiring overview</h1>
      <p>Open roles, screening activity and how far you can trust the screener, on one page.</p></div></div>
    <div class="kpis k4">
      ${kpi('briefcase', 'Open roles', open.length, `${jobs.length} in the library`)}
      ${kpi('users', 'Positions to fill', open.reduce((a, j) => a + j.openings, 0), 'across open roles')}
      ${kpi('fileText', 'Resumes screened', screened, 'all time, counts only')}
      ${kpi('star', 'Shortlist rate', pct(short, screened), `${short} shortlisted`, '%')}
    </div>
    <div class="grid g-ov" style="margin-top:16px">
      <div class="stack">
        <section class="card anim"><div class="card-head"><div><h2>This session</h2><p>Screenings you run here. Nothing about candidates is saved.</p></div>
          ${S.activity.length ? `<a class="btn btn-sm" href="#/screen">${I('board', 14)} Open latest</a>` : ''}</div>
          <div class="card-body">${S.activity.length ? `
            ${pipelineBar(tot, sessN, true)}
            <div class="feed">${S.activity.map((a, i) => `<div class="feed-row" style="--i:${i}"><span class="hic">${I('users', 15)}</span>
              <div><b>${esc(a.title)}</b><div class="small muted">${a.n} candidate${a.n > 1 ? 's' : ''} · ${a.counts.strong + a.counts.shortlist} shortlisted${a.flags ? ` · ${a.flags} flagged` : ''}</div></div>
              <span class="tiny muted">${ago(a.at)}</span></div>`).join('')}</div>`
            : `<div class="empty-mini big">${I('play', 24)}<b>No screenings yet</b><span class="small muted">Run the sample to see a full ranked board, insights and interview kits in about a second.</span>
              <button class="btn btn-grad" data-act="demo-screen">${I('play', 15)} Run a sample screening</button></div>`}</div></section>
        <section class="card anim"><div class="card-head"><div><h2>Open roles</h2><p>Screen new applicants against a saved job in one click.</p></div>
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
        <section class="card anim model-card"><div class="card-head"><div><h2>Model health</h2><p>Agreement with ${ev ? ev.n : '…'} human-labelled decisions.</p></div>
          <span class="pill v-strong"><i class="dot"></i>v${esc(S.model?.version || '2.2')}</span></div>
          <div class="card-body">${ev ? `<div class="mh">${ring(ev.kappa * 100, 92, 9, 'var(--iris)', ev.kappa.toFixed(2))}
              <div><b>Weighted kappa</b><p class="small muted">Agreement beyond chance. Above 0.6 is substantial, above 0.8 near-perfect.</p></div></div>
            <div class="mh-grid"><div><span>Accuracy</span><b>${(ev.accuracy * 100).toFixed(0)}%</b></div><div><span>Spearman</span><b>${ev.spearman.toFixed(2)}</b></div>
              <div><span>Stuffers caught</span><b>${ev.stuffers_caught}/${ev.stuffers}</b></div></div>
            <a class="btn btn-sm btn-ghost" style="margin-top:12px" href="#/model">See the full evaluation ${I('chevronRight', 14)}</a>`
            : '<div class="sk" style="height:170px"></div>'}</div></section>
        <section class="card anim"><div class="card-head"><div><h2>Quick actions</h2></div></div>
          <div class="card-body qa">
            <button data-act="new-job">${I('plus', 16)}<span><b>New job</b><em>Add a role to the library</em></span></button>
            <a href="#/screen">${I('users', 16)}<span><b>Screen candidates</b><em>Rank up to 50 resumes</em></span></a>
            <a href="#/improve">${I('wand', 16)}<span><b>Improve a resume</b><em>Candidate coaching</em></span></a>
            <button data-act="palette">${I('search', 16)}<span><b>Search everything</b><em><span class="kbd">${MOD} K</span></em></span></button>
          </div></section>
      </div>
    </div>`;
  }

  /* ---------------------------------------------------------------- model quality */
  async function loadModel() {
    S.modelLoading = true;
    try { S.model = await api('/api/model'); navTags(); if (['model', 'overview'].includes(route()) && !S.editor) render(false); }
    catch (e) { toast(e.message, true); } finally { S.modelLoading = false; }
  }

  function modelPage() {
    if (!S.model) { if (!S.modelLoading) loadModel();
      return `<div class="page-head"><div><h1>Model quality</h1><p>Scoring the labelled set…</p></div></div><div class="kpis k4">${[0, 1, 2, 3].map(() => '<div class="sk" style="height:104px"></div>').join('')}</div>`; }
    const m = S.model, ev = m.evaluation, prev = m.history.length > 1 ? m.history[m.history.length - 2] : null;
    const delta = (v, p, fmt, pctp) => p == null ? '' : (() => { const d = v - p; if (Math.abs(d) < 1e-9) return '<em class="flat">no change</em>';
      return `<em class="${d > 0 ? 'up' : 'down'}">${I(d > 0 ? 'trendUp' : 'trendDown', 12)}${d > 0 ? '+' : ''}${pctp ? (d * 100).toFixed(1) + ' pts' : fmt(d)} vs v${prev.version}</em>`; })();
    const tile = (label, val, sub, dl, help) => `<div class="mtile anim"><div class="k">${label}${tip(help)}</div><div class="v">${val}</div>${dl || ''}<div class="kpi-sub">${sub}</div></div>`;
    if (!ev) return `<div class="page-head"><div><h1>Model quality</h1><p>The labelled evaluation set is not included in this deployment.</p></div></div>`;
    const maxC = Math.max(...ev.confusion.flat());
    const labels = { reject: 'Not a fit', maybe: 'Interview to verify', shortlist: 'Shortlist' };
    return `
    <div class="page-head anim"><div><h1>Model quality</h1>
      <p>How often the screener agrees with a person, measured on ${ev.n} labelled resume–job pairs. Rules, weights and results are all on this page.</p></div>
      <span class="pill v-shortlist"><i class="dot"></i>Engine v${esc(m.version)}</span></div>
    <div class="mtiles">
      ${tile('Verdict accuracy', `${(ev.accuracy * 100).toFixed(1)}%`, 'shortlist / maybe / reject', delta(ev.accuracy, prev?.accuracy, null, true), 'Share of pairs where the verdict class matches the human label.')}
      ${tile('Weighted kappa', ev.kappa.toFixed(2), 'agreement beyond chance', delta(ev.kappa, prev?.kappa, d => d.toFixed(2)), 'Cohen’s kappa with linear weights: a one-step miss costs half a two-step miss. 0.61–0.80 is substantial agreement.')}
      ${tile('Spearman rho', ev.spearman.toFixed(2), 'score order vs labels', delta(ev.spearman, prev?.spearman, d => d.toFixed(2)), 'Whether higher scores go to the people a human rated higher.')}
      ${tile('Precision at 3', `${Math.round(ev.p_at_3 * 100)}%`, 'top 3 per job worth interviewing', delta(ev.p_at_3, prev?.p_at_3, null, true), 'For each job, the share of the top three candidates a person labelled shortlist or maybe.')}
      ${tile('Stuffers caught', `${ev.stuffers_caught}/${ev.stuffers}`, 'kept off the shortlist', prev ? delta(ev.stuffers_caught, prev.stuffers_caught, d => `${d}`) : '', 'Resumes that paste the job description or cram every tool into one line.')}
      ${tile('Good candidates rejected', `${ev.false_rejections}/${ev.good}`, 'labelled shortlist or maybe', '', 'The costliest error for a screener: someone worth talking to who gets Not a fit.')}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <section class="card anim"><div class="card-head"><div><h2>Confusion matrix</h2><p>Rows are the human label, columns the engine’s verdict. The diagonal is agreement.</p></div></div>
        <div class="card-body"><div class="cm" role="table" aria-label="Confusion matrix">
          <div class="cm-corner small muted">Human ↓ · Engine →</div>${ev.labels.map(l => `<div class="cm-h">${labels[l]}</div>`).join('')}
          ${ev.labels.map((t, i) => `<div class="cm-h row-h">${labels[t]}</div>${ev.confusion[i].map((v, j) => `<div class="cm-c ${i === j ? 'diag' : ''}" style="--a:${maxC ? v / maxC : 0};--i:${i * 3 + j}" data-tip="Human: ${labels[t]} · Engine: ${labels[ev.labels[j]]} · ${v} pair${v === 1 ? '' : 's'}"><b>${v}</b></div>`).join('')}`).join('')}
        </div>
        <p class="small muted" style="margin-top:12px">Most misses are one step apart (a “maybe” the engine shortlists), which is why weighted kappa is higher than raw accuracy suggests.</p></div></section>
      <section class="card anim"><div class="card-head"><div><h2>Version history</h2><p>Same labelled set, each engine version.</p></div></div>
        <div class="card-body"><div style="overflow-x:auto"><table class="tbl vh"><thead><tr><th>Version</th><th class="num">Accuracy</th><th class="num">Kappa</th><th class="num">Spearman</th><th class="num">P@3</th><th class="num">Stuffers</th></tr></thead>
          <tbody>${[...m.history].reverse().map((h, i) => `<tr class="${i === 0 ? 'cur' : ''}"><td><b>v${esc(h.version)}</b>${i === 0 ? ' <span class="pill v-strong"><i class="dot"></i>current</span>' : ''}</td>
            <td class="num">${(h.accuracy * 100).toFixed(1)}%</td><td class="num">${h.kappa.toFixed(2)}</td><td class="num">${h.spearman.toFixed(2)}</td>
            <td class="num">${Math.round(h.p_at_3 * 100)}%</td><td class="num">${h.stuffers_caught}/${ev.stuffers}</td></tr>`).join('')}</tbody></table></div>
          <ul class="list good" style="margin-top:14px">
            <li>${I('check')}v2.2 added integrity checks, partial credit for work described without tool names, and batch-independent scores.</li></ul></div></section>
      <section class="card anim"><div class="card-head"><div><h2>Score weights</h2><p>Parts that don’t apply are dropped and the rest re-weighted.</p></div></div>
        <div class="card-body weights">${m.weights.map(w => `<div class="weight"><span>${esc(w.label)}</span>${bar(w.weight / 38 * 100)}<b>${w.weight}%</b></div>`).join('')}
          <div class="credit-row">${[['Shown in a bullet', m.credits.shown, 'shown'], ['Only in the skills list', m.credits.listed, 'listed'], ['Described, not named', m.credits.related, 'related']]
            .map(([l, v, c]) => `<div><span class="chip ${c}"><i class="dot"></i>${Math.round(v * 100)}%</span><span class="small muted">${l}</span></div>`).join('')}</div></div></section>
      <section class="card anim"><div class="card-head"><div><h2>Integrity rules</h2><p>Each finding costs points (capped at ${m.integrity.cap}) and is shown to the recruiter.</p></div></div>
        <div class="card-body"><div class="rules">
          <div><span class="hic">${I('copy', 15)}</span><div><b>Lines copied from the job</b><p class="small muted">Ignored when scoring, −${m.integrity.penalties.copied} points, verdict capped at Interview to verify.</p></div></div>
          <div><span class="hic">${I('layers', 15)}</span><div><b>One bullet naming ${m.integrity.cram_skills}+ required tools</b><p class="small muted">Those skills count as listed, not shown. −${m.integrity.penalties.crammed} points.</p></div></div>
          <div><span class="hic">${I('clock', 15)}</span><div><b>Years claimed far above dated roles</b><p class="small muted">More than ${m.integrity.years_gap} years over: the dated figure is used. −${m.integrity.penalties.years} points.</p></div></div>
        </div></div></section>
    </div>
    <section class="card anim" style="margin-top:16px"><div class="card-head"><div><h2>Where the engine and the labels disagree</h2><p>${ev.disagreements.length} of ${ev.n} pairs. Each one is a lead for the next improvement.</p></div></div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Resume</th><th>Job</th><th>Human label</th><th>Engine verdict</th><th class="num">Score</th><th>Why the label</th></tr></thead>
        <tbody>${ev.disagreements.map(d => `<tr class="static"><td><b>${esc(d.resume)}</b></td><td>${esc(ev.jobs[d.job] || d.job)}</td><td>${esc(labels[d.label])}</td><td>${esc(d.verdict)}</td><td class="num">${d.score}</td><td class="small muted">${esc(d.note)}</td></tr>`).join('')}</tbody></table></div></section>
    <div class="note anim" style="margin-top:16px">${I('info')}<div><b>How to read these numbers.</b> The resumes are fictional and the labels were written by the project author before the engine ran on them, so this is a regression baseline that shows the method, not a claim about real-world accuracy. Real recruiter labels on anonymised resumes are the next step.</div></div>`;
  }

  /* ---------------------------------------------------------------- the screening run */
  const STAGES = [['fileText', 'Reading resumes'], ['target', 'Matching skills to the job'], ['shield', 'Running integrity checks'], ['scale', 'Scoring seven parts'], ['board', 'Ranking and deciding']];
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
      { l: `${$('shell').classList.contains('collapsed') ? 'Expand' : 'Collapse'} sidebar`, ic: 'chevronLeft', k: '[', g: 'Preferences', run: toggleCollapse },
      { l: 'Keyboard shortcuts', ic: 'keyboard', k: '?', g: 'Preferences', run: () => { S.shortcuts = true; renderOverlays(); } },
      { l: 'API reference', ic: 'book', g: 'Help', run: () => window.open('/api/docs', '_blank', 'noopener') }];
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
    const rows = [[`${MOD} K`, 'Search or jump to anything'], ['?', 'Show this sheet'], ['[', 'Collapse or expand the sidebar'],
      ['1  2  3', 'Board, ranked list, insights (on results)'], ['←  →', 'Previous or next candidate (in the drawer)'], ['Esc', 'Close the drawer or dialog']];
    return `<div class="modal-scrim" data-act="close-shortcuts"><div class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div class="modal-head"><div><h2><span class="hic">${I('keyboard')}</span>Keyboard shortcuts</h2></div><button class="icon-btn" data-act="close-shortcuts" aria-label="Close">${I('x')}</button></div>
      <div class="sc">${rows.map(([k, l]) => `<div><span>${l}</span><span class="kbd">${esc(k)}</span></div>`).join('')}</div></div></div>`;
  }

  function toggleCollapse() {
    const c = $('shell').classList.toggle('collapsed'); store.set('ri2-collapsed', c ? '1' : '0');
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
      S.compare.clear(); S.drawer = null; S.run = null; S.view = S.view === 'insights' ? 'board' : S.view; S.dealt = !reduced;
      S.activity.unshift({ title: (S.job.id && jobById(S.job.id)?.title) || S.screen.job.title || title, n: S.screen.candidates.length, counts: S.screen.counts,
        flags: S.screen.candidates.filter(c => c.integrity?.suspicious).length, at: new Date().toISOString() });
      S.activity = S.activity.slice(0, 6);
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
      if (!keepBase) S.imp.base = r.score;
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
        if (a === 'rm-resume') { S.resumes.splice(+t.dataset.i, 1); return render(false); }
        if (a === 'run-screen') return runScreen();
        if (a === 'edit-inputs') { S.screen = null; S.drawer = null; S.compare.clear(); return render(); }
        if (a === 'export') {
          const csv = await api('/api/screen/export', { job: S.job.text, resumes: S.resumes.map(r => ({ name: r.name, text: r.text })) });
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          const link = Object.assign(document.createElement('a'), { href: url, download: 'shortlist.csv' });
          link.click(); URL.revokeObjectURL(url); return toast('Shortlist exported');
        }
        if (a === 'view') return setView(t.dataset.v);
        if (a === 'palette') return openPalette();
        if (a === 'pal-run') return runPalette(+t.dataset.i);
        if (a === 'pal-close') { if (ev.target === t) { S.palette = null; renderOverlays(); } return; }
        if (a === 'shortcuts') { S.shortcuts = true; return renderOverlays(); }
        if (a === 'close-shortcuts') { if (ev.target === t || t.classList.contains('icon-btn')) { S.shortcuts = false; renderOverlays(); } return; }
        if (a === 'collapse') return toggleCollapse();
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
        if (a === 'imp-reset') { S.imp.result = null; S.imp.base = null; S.imp.assume.clear(); return render(); }
        if (a === 'assume') { const s = t.dataset.s; S.imp.assume.has(s) ? S.imp.assume.delete(s) : S.imp.assume.add(s); return runImprove(true); }
        return;
      }
      if (card && !ev.target.closest('.cmp-check')) { S.drawer = card.dataset.cand; S.tab = 'overview'; renderOverlays(); }
    });

    document.addEventListener('ri-act', e => { const b = Object.assign(document.createElement('button'), { hidden: true }); b.dataset.act = e.detail;
      document.body.appendChild(b); b.click(); b.remove(); });

    document.addEventListener('keydown', ev => {
      const typing = ev.target.matches('input, textarea, select, [contenteditable]');
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
      if (S.run) return;
      if (!typing && !ev.metaKey && !ev.ctrlKey && !ev.altKey && !S.editor && !S.confirm) {
        if (ev.key === '?') { S.shortcuts = !S.shortcuts; return renderOverlays(); }
        if (ev.key === '[') return toggleCollapse();
        if (S.drawer && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); return stepDrawer(ev.key === 'ArrowRight' ? 1 : -1); }
        if (route() === 'screen' && S.screen && !S.drawer && ['1', '2', '3'].includes(ev.key)) return setView(['board', 'table', 'insights'][+ev.key - 1]);
      }
      if (ev.key === 'Escape' && (S.confirm || S.editor)) { if (S.confirm) S.confirm = null; else S.editor = null; return renderOverlays(); }
      if (ev.key === 'Escape') { if (S.compareOpen) S.compareOpen = false; else if (S.drawer) S.drawer = null; else return; renderOverlays(); }
      if (ev.key === 'Enter' && ev.target.matches('[data-cand]')) { S.drawer = ev.target.dataset.cand; S.tab = 'overview'; renderOverlays(); }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('.drop')) { ev.preventDefault(); pendingTarget = 'multi'; $('file-multi').click(); }
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
      if (ev.target.id === 'blind') { S.blind = ev.target.checked; store.set('ri2-blind', S.blind ? 'on' : 'off'); render(false); }
      if (ev.target.id === 'file-multi' || ev.target.id === 'file-one') { uploadFiles([...ev.target.files], pendingTarget); ev.target.value = ''; }
    });

    document.addEventListener('dragover', ev => { const d = ev.target.closest('.drop'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
    document.addEventListener('dragleave', ev => { const d = ev.target.closest('.drop'); if (d) d.classList.remove('over'); });
    document.addEventListener('drop', ev => { const d = ev.target.closest('.drop'); if (!d) return; ev.preventDefault(); d.classList.remove('over'); uploadFiles([...ev.dataTransfer.files], 'multi'); });

    document.addEventListener('mouseover', ev => {
      const t = ev.target.closest('[data-tip]'); if (t) return showTip(t);
      const n = ev.target.closest('[data-tip-side]'); if (n && $('shell').classList.contains('collapsed') && innerWidth > 860) showTip(n, n.dataset.tipSide, true);
    });
    document.addEventListener('mouseout', ev => { if (ev.target.closest('[data-tip], [data-tip-side]')) $('tipbox').hidden = true; });
    window.addEventListener('scroll', () => { $('top').classList.toggle('scrolled', scrollY > 4); $('tipbox').hidden = true; }, { passive: true });
    window.addEventListener('hashchange', () => render());
    $('theme').addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
      dark ? document.documentElement.setAttribute('data-theme', 'dark') : document.documentElement.removeAttribute('data-theme');
      store.set('ri2-theme', dark ? 'dark' : 'light'); setThemeIcon();
    });
    $('menu').addEventListener('click', () => $('shell').classList.toggle('menu'));
  }

  function setView(v) {
    if (S.view === v) return;
    S.view = v; store.set('ri2-view', v === 'insights' ? 'board' : v);
    document.querySelectorAll('.tabseg button').forEach(b => { const on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    const srch = document.querySelector('.toolbar .search'); if (srch) srch.hidden = v === 'insights';
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

  if (document.documentElement.classList.contains('pre-collapsed')) $('shell').classList.add('collapsed');
  const kk = $('kbd-k'); if (kk) kk.textContent = `${MOD} K`;
  Icons.hydrate();
  setThemeIcon();
  wire();
  render();
  return { S, render };
})();
