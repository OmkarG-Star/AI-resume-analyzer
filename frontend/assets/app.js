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
  };

  const VERD = {
    strong:    { label: 'Strong shortlist',    cls: 'v-strong',    c: 'var(--green)', icon: 'star' },
    shortlist: { label: 'Shortlist',           cls: 'v-shortlist', c: 'var(--teal)',  icon: 'check' },
    verify:    { label: 'Interview to verify', cls: 'v-verify',    c: 'var(--amber)', icon: 'help' },
    reject:    { label: 'Not a fit',           cls: 'v-reject',    c: 'var(--slate)', icon: 'x' },
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
  async function api(path, body) {
    const opt = body instanceof FormData ? { method: 'POST', body }
      : body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {};
    const r = await fetch(path, opt);
    if (!r.ok) {
      let d = r.statusText;
      try { const j = await r.json(); d = typeof j.detail === 'string' ? j.detail : (j.detail?.[0]?.msg || d); } catch (e) { }
      throw new Error(d);
    }
    return path.endsWith('export') ? r.text() : r.json();
  }

  function toast(msg, err) {
    document.querySelectorAll('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = `${I(err ? 'alert' : 'check')}<span>${esc(msg)}</span>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
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

  async function samples() {
    if (!S.samples) S.samples = await api('/api/samples');
    return S.samples;
  }

  function animate() {
    const page = $('page');
    page.classList.add('enter');
    page.querySelectorAll('.anim').forEach((n, i) => n.style.setProperty('--i', Math.min(i, 12)));
    if (reduced) return;
    document.querySelectorAll('[data-count]').forEach(n => {
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
    screen: { title: 'Screen candidates', crumb: 'Recruiter workspace' },
    improve: { title: 'Improve a resume', crumb: 'Candidate workspace' },
    method: { title: 'How scoring works', crumb: 'Learn' },
  };
  const route = () => (location.hash.replace(/^#\//, '') || 'screen').split('/')[0];

  function render(anim = true) {
    const r = ROUTES[route()] ? route() : 'screen';
    document.querySelectorAll('.nav a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === r));
    $('crumbs').innerHTML = `<span class="crumb-sec">${esc(ROUTES[r].crumb)} ${I('chevronRight', 14)}</span> <b>${esc(ROUTES[r].title)}</b>`;
    $('top-actions').innerHTML = topActions(r);
    const page = $('page');
    page.classList.remove('enter');
    page.innerHTML = r === 'screen' ? (S.screen ? screenResults() : screenSetup())
      : r === 'improve' ? (S.imp.result ? improveResults() : improveSetup()) : method();
    document.title = `${ROUTES[r].title} · Resume Intelligence`;
    $('shell').classList.remove('menu');
    renderOverlays();
    if (anim) animate();
  }

  function topActions(r) {
    if (r === 'screen' && S.screen) return `
      <button class="btn btn-sm btn-ghost" data-act="edit-inputs" title="Edit inputs">${I('arrowLeft', 15)}<span class="lbl">Edit inputs</span></button>
      <button class="btn btn-sm" data-act="export" title="Export CSV">${I('download', 15)}<span class="lbl">Export CSV</span></button>`;
    if (r === 'improve' && S.imp.result) return `
      <button class="btn btn-sm btn-ghost" data-act="imp-reset" title="New analysis">${I('arrowLeft', 15)}<span class="lbl">New analysis</span></button>`;
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
          <p>Paste the advert or upload it. Must-haves and nice-to-haves are detected automatically.</p></div></div>
        <div class="card-body">
          <div class="row" style="margin-bottom:10px">
            <span class="small muted">Use a sample:</span>
            <button class="chip outline" data-act="sample-job" data-i="0">${I('briefcase', 13)} Data Engineer</button>
            <button class="chip outline" data-act="sample-job" data-i="1">${I('briefcase', 13)} Data Scientist</button>
            <span class="spacer" style="flex:1"></span>
            <button class="btn btn-sm btn-ghost" data-act="upload-job">${I('upload', 14)} Upload</button>
          </div>
          <textarea id="job-text" placeholder="Paste the job description here…" aria-label="Job description">${esc(S.job.text)}</textarea>
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
          <div class="small muted">Takes a second. Nothing leaves this session or gets stored.</div></div></div>
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
    const kpi = (k, label, v, c, help) => `<div class="kpi anim" style="--c:${c}"><div class="k">${I(k, 14)}${label}${help ? tip(help) : ''}</div><div class="v" data-count>${v}</div></div>`;
    return `
    <div class="page-head anim">
      <div><h1>${esc(j.title || 'Screening results')}</h1>
        <div class="row" style="margin-top:8px">
          ${j.seniority ? `<span class="chip">${I('briefcase', 13)}${esc(j.seniority)}</span>` : ''}
          ${j.min_years ? `<span class="chip">${I('clock', 13)}${j.min_years}+ years</span>` : ''}
          ${j.education ? `<span class="chip">${I('cap', 13)}${esc(j.education)}</span>` : ''}
          <span class="chip">${I('target', 13)}${j.must_units.length} must-haves</span>
          <span class="chip">${I('plus', 13)}${j.nice_units.length} nice-to-haves</span>
        </div></div>
    </div>
    <div class="kpis">
      ${kpi('users', 'Candidates', n, 'var(--iris)')}
      ${kpi('star', 'Strong shortlist', d.counts.strong, 'var(--green)', 'Score 74+, at most 30% of must-haves missing, experience met.')}
      ${kpi('check', 'Shortlist', d.counts.shortlist, 'var(--teal)', 'Score 62+ with at most a third of must-haves missing.')}
      ${kpi('help', 'Interview to verify', d.counts.verify, 'var(--amber)', 'Borderline: worth a short phone screen to check the gaps.')}
      ${kpi('x', 'Not a fit', d.counts.reject, 'var(--slate)', 'Misses more than half the must-haves, or scores below 48.')}
    </div>

    <div class="toolbar">
      <div class="seg" role="tablist">
        <button class="${S.view === 'board' ? 'on' : ''}" data-act="view" data-v="board">${I('board', 15)} Board</button>
        <button class="${S.view === 'table' ? 'on' : ''}" data-act="view" data-v="table">${I('table', 15)} Ranked list</button>
      </div>
      <label class="search">${I('search', 15)}<input type="search" id="q" placeholder="Search name, file or skill" value="${esc(S.q)}"></label>
      <label class="switch" title="Hide names to reduce bias"><input type="checkbox" id="blind" ${S.blind ? 'checked' : ''}><i></i>Blind screening</label>
      <span style="flex:1"></span>
      <span class="small muted">${I('compare', 14)} Tick up to 3 cards to compare</span>
    </div>
    <div id="results">${S.view === 'board' ? board() : table()}</div>

    <section class="card anim" style="margin-top:18px">
      <div class="card-head"><div><h2><span class="hic">${I('layers')}</span>Must-have coverage across candidates</h2>
        <p>Spot the skills your pool lacks: if nobody has one, the requirement may be unrealistic for this market.</p></div>
        <div class="legend"><span><i style="background:var(--green)"></i>Shown in work</span><span><i style="background:color-mix(in srgb,var(--amber) 55%,transparent)"></i>Listed only</span><span><i style="background:var(--surface-3)"></i>Missing</span></div></div>
      <div class="card-body heat">${heatmap()}</div>
    </section>
    ${S.compare.size >= 2 ? '' : ''}`;
  }

  function ccard(c, i) {
    const shown = c.skills.filter(s => s.importance === 'must' && s.status === 'shown').slice(0, 3);
    const miss = c.skills.filter(s => s.importance === 'must' && s.status === 'missing').length;
    return `<article class="ccard ${S.compare.has(c.id) ? 'sel' : ''}" data-cand="${c.id}" style="--i:${i}" tabindex="0">
      <div class="ccard-top">${avatar(c)}<div class="who"><b>${esc(candName(c))}</b><span>${esc(c.file)}</span></div>${ring(c.score, 44, 5)}</div>
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
        <td><div class="row" style="flex-wrap:nowrap">${avatar(c)}<div><b>${esc(candName(c))}</b><div class="tiny muted">${esc(c.file)}</div></div></div></td>
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
          return `<td class="${st}" data-tip="${esc(candName(c))}: ${st === 'shown' ? 'shown in work' : st === 'listed' ? 'listed only' : 'missing'}"></td>`; }).join('')}
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
      <div class="sec-title">Why</div>
      <ul class="list good">${c.strengths.map(s => `<li>${I('check')}${esc(s)}</li>`).join('') || '<li class="muted">No clear strengths against this job.</li>'}</ul>
      <div class="sec-title">Risks to check</div>
      <ul class="list bad">${c.risks.map(s => `<li>${I('alert')}${esc(s)}</li>`).join('') || '<li class="muted">No notable risks.</li>'}</ul>
      <div class="sec-title">Score breakdown</div>
      ${c.parts.filter(p => p.value !== null).map(p => `<div class="part"><span>${esc(p.label)} ${tip(PART_TIPS[p.key])}<span class="w">weight ${p.weight}%</span></span>
        ${bar(p.value, scoreColor(p.value))}<span>${Math.round(p.value)}</span></div>`).join('')}
      <div class="note" style="margin-top:16px">${I('info')}<div>Decision support only. Read the resume and talk to the person before rejecting anyone.
        ${esc(c.confidence.note)}</div></div>`;
    if (S.tab === 'skills') {
      const grp = imp => c.skills.filter(s => s.importance === imp);
      const chipsFor = rows => rows.map(s => `<span class="chip ${s.status}" data-tip="${s.status === 'shown' ? 'Shown in a job or project bullet' : s.status === 'listed' ? 'Only in the skills list' : 'Not found'}"><i class="dot"></i>${esc(s.skill)}</span>`).join('');
      body = `
      <div class="legend" style="margin-bottom:6px"><span><i style="background:var(--green)"></i>Shown in work</span><span><i style="background:var(--amber)"></i>Listed only</span><span><i style="background:var(--red)"></i>Missing</span></div>
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
          <div class="row" style="flex-wrap:nowrap">${avatar(c)}<div><h2>${esc(candName(c))}</h2><div class="small muted">${esc(c.file)} · rank #${c.rank}</div></div></div>
          <button class="icon-btn" data-act="close-drawer" aria-label="Close">${I('x')}</button>
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
    if (S.drawer && S.drawer !== S.lastDrawer) animate();
    else document.querySelectorAll('.ov [data-count], .ov .ring-arc').forEach(n => { n.dataset.done = '1'; n.style.animation = 'none'; });
    S.lastDrawer = S.drawer;
  }

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
          <div class="row"><button class="chip outline" data-act="imp-sample-job" data-i="0">Data Engineer</button><button class="chip outline" data-act="imp-sample-job" data-i="1">Data Scientist</button></div></div>
        <div class="card-body"><textarea id="imp-job" placeholder="Paste the job description…" aria-label="Job description">${esc(S.imp.job)}</textarea></div>
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
    const missing = r.skills.filter(s => s.status === 'missing' || S.imp.assume.has(s.members[0]));
    return `
    <div class="grid g-side">
      <div class="stack">
        <section class="card card-pad anim">
          <div class="score-hero">
            <div style="position:relative">${ring(r.score, 132, 12)}</div>
            <div>
              <div class="row"><span class="small muted">Match score for</span><b>${esc(r.job.title || 'this job')}</b>
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
          <li>${I('check')}A skill shown in a job or project bullet counts fully; only in the skills list it counts 70%.</li>
          <li>${I('check')}Years come from dated roles with overlaps merged, so two parallel jobs are not double counted.</li>
          <li>${I('check')}Evidence rewards measurable results and bullets that start with an action verb.</li>
          <li>${I('check')}Every suggestion’s “+points” is measured by re-scoring your resume with that one fix applied.</li></ul></div></section>
      <section class="card anim" style="grid-column:1/-1"><div class="card-head"><div><h2><span class="hic">${I('shield')}</span>Fairness, privacy and limits</h2></div></div>
        <div class="card-body grid g3">
          <div><b>Blind by default</b><p class="small muted" style="margin-top:4px">Names are hidden behind candidate IDs. Name, gender, age, photo and address are never used in scoring.</p></div>
          <div><b>Nothing stored</b><p class="small muted" style="margin-top:4px">Files are read in memory, analysed and discarded. There is no database and nothing is logged.</p></div>
          <div><b>Decision support, not a decision</b><p class="small muted" style="margin-top:4px">Keyword-style scoring misses context: career changers, unusual titles, scanned PDFs. A person should review every rejection.</p></div>
        </div></section>
    </div>`;
  }

  /* ---------------------------------------------------------------- actions */
  async function runScreen() {
    const btn = document.querySelector('[data-act="run-screen"]');
    if (btn) { btn.disabled = true; btn.classList.add('busy'); btn.innerHTML = `${I('refresh', 16)} Screening…`; }
    try {
      S.screen = await api('/api/screen', { job: S.job.text, resumes: S.resumes.map(r => ({ name: r.name, text: r.text })) });
      S.compare.clear(); S.drawer = null;
      render();
      toast(`Screened ${S.screen.candidates.length} candidates`);
    } catch (e) { toast(e.message, true); render(false); }
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
        } else if (target === 'job') S.job = { name: r.name, text: r.text };
        else if (target === 'imp') S.imp.resume = { name: r.name, text: r.text };
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
        if (a !== 'upload-multi' || ev.target.tagName !== 'A') ev.preventDefault();
        if (a === 'demo-screen') { const s = await samples(); S.job = { name: 'sample', text: s.jobs[1].text }; S.resumes = s.resumes.map(r => ({ ...r })); render(false); return runScreen(); }
        if (a === 'sample-job') { const s = await samples(); S.job = { name: s.jobs[+t.dataset.i].id, text: s.jobs[+t.dataset.i].text }; return render(false); }
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
        if (a === 'view') { S.view = t.dataset.v; store.set('ri2-view', S.view); $('results').innerHTML = S.view === 'board' ? board() : table(); return animate(); }
        if (a === 'cmp') { ev.stopPropagation(); const id = t.dataset.id;
          if (S.compare.has(id)) S.compare.delete(id); else if (S.compare.size < 3) S.compare.add(id); else toast('Compare up to 3 at a time', true);
          $('results').innerHTML = S.view === 'board' ? board() : table(); return renderOverlays(); }
        if (a === 'open-compare') { S.compareOpen = true; return renderOverlays(); }
        if (a === 'clear-compare') { S.compare.clear(); $('results').innerHTML = S.view === 'board' ? board() : table(); return renderOverlays(); }
        if (a === 'close-compare') { if (ev.target === t || t.classList.contains('icon-btn')) { S.compareOpen = false; renderOverlays(); } return; }
        if (a === 'close-drawer') { S.drawer = null; return renderOverlays(); }
        if (a === 'tab') { S.tab = t.dataset.t; return renderOverlays(); }
        if (a === 'copy-qs') { const c = S.screen.candidates.find(x => x.id === S.drawer); return copy(c.questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')); }
        if (a === 'copy-fb') { const c = S.screen.candidates.find(x => x.id === S.drawer);
          return copy('Thank you for applying. A few things that would strengthen your application:\n\n' + c.suggestions.slice(0, 4).map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`).join('\n')); }
        if (a === 'copy') return copy(t.dataset.text);
        if (a === 'demo-improve') { const s = await samples(); S.imp.resume = { name: s.resumes[3].name, text: s.resumes[3].text }; S.imp.job = s.jobs[1].text; S.imp.assume.clear(); render(false); return runImprove(); }
        if (a === 'imp-sample-job') { const s = await samples(); S.imp.job = s.jobs[+t.dataset.i].text; return render(false); }
        if (a === 'run-improve') { S.imp.assume.clear(); return runImprove(); }
        if (a === 'imp-reset') { S.imp.result = null; S.imp.base = null; S.imp.assume.clear(); return render(); }
        if (a === 'assume') { const s = t.dataset.s; S.imp.assume.has(s) ? S.imp.assume.delete(s) : S.imp.assume.add(s); return runImprove(true); }
        return;
      }
      if (card && !ev.target.closest('.cmp-check')) { S.drawer = card.dataset.cand; S.tab = 'overview'; renderOverlays(); }
    });

    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') { if (S.compareOpen) S.compareOpen = false; else if (S.drawer) S.drawer = null; else return; renderOverlays(); }
      if (ev.key === 'Enter' && ev.target.matches('[data-cand]')) { S.drawer = ev.target.dataset.cand; S.tab = 'overview'; renderOverlays(); }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('.drop')) { ev.preventDefault(); pendingTarget = 'multi'; $('file-multi').click(); }
    });

    document.addEventListener('input', ev => {
      if (ev.target.id === 'job-text') { S.job.text = ev.target.value; refreshCta(); }
      if (ev.target.id === 'imp-resume') { S.imp.resume.text = ev.target.value; refreshCta(); }
      if (ev.target.id === 'imp-job') { S.imp.job = ev.target.value; refreshCta(); }
      if (ev.target.id === 'q') { S.q = ev.target.value; $('results').innerHTML = S.view === 'board' ? board() : table(); }
    });
    document.addEventListener('change', ev => {
      if (ev.target.id === 'blind') { S.blind = ev.target.checked; store.set('ri2-blind', S.blind ? 'on' : 'off'); render(false); }
      if (ev.target.id === 'file-multi' || ev.target.id === 'file-one') { uploadFiles([...ev.target.files], pendingTarget); ev.target.value = ''; }
    });

    document.addEventListener('dragover', ev => { const d = ev.target.closest('.drop'); if (d) { ev.preventDefault(); d.classList.add('over'); } });
    document.addEventListener('dragleave', ev => { const d = ev.target.closest('.drop'); if (d) d.classList.remove('over'); });
    document.addEventListener('drop', ev => { const d = ev.target.closest('.drop'); if (!d) return; ev.preventDefault(); d.classList.remove('over'); uploadFiles([...ev.dataTransfer.files], 'multi'); });

    document.addEventListener('mouseover', ev => { const t = ev.target.closest('[data-tip]'); if (t) showTip(t); });
    document.addEventListener('mouseout', ev => { if (ev.target.closest('[data-tip]')) $('tipbox').hidden = true; });
    window.addEventListener('scroll', () => { $('top').classList.toggle('scrolled', scrollY > 4); $('tipbox').hidden = true; }, { passive: true });
    window.addEventListener('hashchange', () => render());
    $('theme').addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'dark';
      dark ? document.documentElement.setAttribute('data-theme', 'dark') : document.documentElement.removeAttribute('data-theme');
      store.set('ri2-theme', dark ? 'dark' : 'light'); setThemeIcon();
    });
    $('menu').addEventListener('click', () => $('shell').classList.toggle('menu'));
  }

  function refreshCta() {
    // Update readiness without re-rendering the textarea being typed in.
    const r = route();
    const ready = r === 'screen' ? S.job.text.trim().length > 20 && S.resumes.length
      : S.imp.resume.text.trim().length > 20 && S.imp.job.trim().length > 20;
    const b = document.querySelector('[data-act="run-screen"], [data-act="run-improve"]');
    if (b) b.disabled = !ready;
  }

  function showTip(t) {
    const box = $('tipbox'); box.textContent = t.dataset.tip; box.hidden = false;
    const r = t.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8; if (y < 8) y = r.bottom + 8;
    box.style.left = Math.min(Math.max(8, x), innerWidth - w - 8) + 'px'; box.style.top = y + 'px';
  }

  function setThemeIcon() {
    $('theme').innerHTML = I(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon', 18);
  }

  Icons.hydrate();
  setThemeIcon();
  wire();
  render();
  return { S, render };
})();
