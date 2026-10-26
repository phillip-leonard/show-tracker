// netlify/functions/lib/heardClient.js
//
// The browser half of /heard/<slug>/: the show picker, the live record, the
// poster, the share link, the setlist.fm import and the hand-off to sign-up.
// heardPages.js inlines createHeardApp.toString() into the page next to
// heardRecord.js's createHeard, the same way and for the same reason: no
// bundle, nothing in out/ or the iOS app.
//
// So this is browser code that lives in a CommonJS file: everything it uses
// is inside createHeardApp or passed in (Heard, boot). Node never runs it;
// the tests check only that it parses and that the page carries it.
//
// ── Storage ───────────────────────────────────────────────────────────
//
// The ticked shows are kept in localStorage under mysetlists_heard_<slug>,
// as a share code. Every read and write is wrapped: with site data blocked
// the page still works, it just forgets on reload.
//
// ── A signed-in user's own shows ──────────────────────────────────────
//
// Read, never written, here (lib/heardLinks.js writes them):
//   #mine=<base64url JSON [[date, venue], ...]>
//                           in every link from the app. A fragment never
//                           reaches the server, and works in the iOS app's
//                           system browser, which shares no storage with it.
//   mysetlists_heard_have   { <slug>: [[date, venue], ...] }, kept by the
//                           app on the web, where it shares this origin.
//   #have=YYYYMMDD.…        dates only, from iOS 3.9's Stats link.
//
// With any of those for this band the page opens in "your shows" mode: the
// matched shows selected (heardRecord.js matchLoggedShows), the picker
// hidden behind "Edit selection", the record and poster first, and every
// logged show that didn't match listed, never dropped. Edits change this
// poster only: nothing here writes to the account, and they aren't kept as
// the page's stored picks either. ?mine=1 with none of them asks the
// visitor to sign in and comes back (AppContext's ?login=1&next=).

function createHeardApp(Heard, boot) {
  'use strict';

  const root = document.getElementById('heard-app');
  const dock = document.getElementById('heard-dock');
  if (!root) return;

  const STORE_KEY = `mysetlists_heard_${boot.slug}`;
  const HAVE_KEY = 'mysetlists_heard_have';
  // lib/signedInHint.js: this browser had a signed-in user last time.
  const SIGNED_IN_KEY = 'mysetlists_signed_in';
  const wantsMine = /[?&]mine=1(&|$)/.test(location.search);
  // A share code longer than this is stored (heard-share.js) and the link
  // carries a short id instead; about 900 shows.
  const MAX_INLINE_CODE = 1500;

  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* blocked: forget on reload */ } },
  };

  const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const num = (n) => Number(n).toLocaleString('en-US');
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || `${one}s`)}`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function shortDate(iso, withYear) {
    const [y, m, d] = iso.split('-').map(Number);
    const day = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${day}, ${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
  }

  let data = null;
  const selected = new Set();
  const rows = new Map(); // show id -> row element
  const filters = { q: '', year: '', tour: '', onlyTicked: false };
  let songSort = 'count';
  let stored = { code: '', id: '' }; // the last code stored by heard-share.js
  let posterUrls = [];
  let notice = '';
  // "Your shows" mode: { count, ids, unmatched, edited }, or null.
  let mine = null;
  let autoPoster = false;

  // ── Load ────────────────────────────────────────────────────────────

  fetch(boot.showsApi, { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((json) => {
      data = { ...json, name: json.artist.name, sourceName: json.artist.sourceName, slug: json.artist.slug };
      start();
    })
    .catch(() => {
      root.innerHTML = '<p class="h-msg err">Couldn\'t load the show list. Please reload the page to try again.</p>';
    });

  function start() {
    markRuns();
    restore();
    root.innerHTML = layout();
    renderList();
    bindControls();
    update();
  }

  // Multi-night runs: consecutive shows at the same venue, at most two
  // days apart. Each show learns its run, and the run its shows.
  const runs = new Map(); // run key -> [show ids]
  const runOf = new Map(); // show id -> run key
  function markRuns() {
    let current = null;
    let prev = null;
    for (const show of data.shows) {
      const close = prev && prev.venue === show.venue && daysBetween(prev.date, show.date) <= 2;
      if (!close) current = show.id;
      if (!runs.has(current)) runs.set(current, []);
      runs.get(current).push(show.id);
      runOf.set(show.id, current);
      prev = show;
    }
  }

  function daysBetween(a, b) {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  }

  // A signed-in user's own shows, if the app gave us any for this band;
  // otherwise the picks stored in this browser.
  function restore() {
    const logged = loggedShows();
    if (/[#&](mine|have)=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    if (logged.length) {
      const matched = Heard.matchLoggedShows(data, logged);
      mine = { count: logged.length, ids: matched.ids, unmatched: matched.unmatched, edited: false };
      matched.ids.forEach((id) => selected.add(id));
      autoPoster = matched.ids.length > 0;
      return;
    }
    const code = store.get(STORE_KEY);
    if (code) {
      const decoded = Heard.decodeSelection(data, code);
      if (decoded) decoded.ids.forEach((id) => selected.add(id));
    }
  }

  // [{ date, venue }], from the fragment if it has them, else storage.
  function loggedShows() {
    const out = [];
    const seen = new Set();
    const add = (date, venue) => {
      const key = `${date}|${venue}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !seen.has(key)) { seen.add(key); out.push({ date, venue: venue || '' }); }
    };
    const fromList = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((e) => (Array.isArray(e) ? add(String(e[0]), String(e[1] || '')) : add(String(e), '')));
    };
    const m = /[#&]mine=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) {
      try { fromList(JSON.parse(fromBase64Url(m[1]))); } catch (e) { /* a mangled link: fall back below */ }
    }
    const have = /[#&]have=([0-9.]+)/.exec(location.hash);
    if (have) have[1].split('.').forEach((d) => { if (/^\d{8}$/.test(d)) add(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, ''); });
    if (!out.length) {
      try { fromList(JSON.parse(store.get(HAVE_KEY) || '{}')[boot.slug]); } catch (e) { /* not ours to fix */ }
    }
    return out;
  }

  function fromBase64Url(text) {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ?mine=1 and nothing from the app: sign in (or load the shows into this
  // browser) and come back here.
  function signInPanel() {
    if (!wantsMine || mine) return '';
    const back = `/?login=1&next=${encodeURIComponent(`${boot.toolPath}?mine=1`)}`;
    let haveOtherBands = false;
    try { haveOtherBands = Object.keys(JSON.parse(store.get(HAVE_KEY) || '{}')).length > 0; } catch (e) { /* no */ }
    if (store.get(SIGNED_IN_KEY) && haveOtherBands) {
      return `<div class="h-panel" style="margin-bottom:14px;"><strong>No ${esc(data.name)} shows in your MySetlists account yet</strong><p class="h-msg">Tick the shows you were at below to make your poster.</p></div>`;
    }
    const signedIn = !!store.get(SIGNED_IN_KEY);
    return `<div class="h-panel" style="margin-bottom:14px;">
      <strong>${signedIn ? `Make your poster from your ${esc(data.name)} shows` : `Sign in to make your poster from your ${esc(data.name)} shows`}</strong>
      <p class="h-msg">${signedIn ? 'Open MySetlists once to bring your shows into this browser, and we\'ll come straight back.' : 'We\'ll use every show you\'ve logged in MySetlists and come straight back here.'} Or tick your shows below.</p>
      <div class="h-actions"><a class="btn" href="${esc(back)}">${signedIn ? 'Load my shows' : 'Sign in'}</a></div>
    </div>`;
  }

  // ── Layout ──────────────────────────────────────────────────────────

  function layout() {
    const years = [...new Set(data.shows.map((s) => s.date.slice(0, 4)))].reverse();
    const tours = data.tours.map((t, i) => [t, i]).filter(([t]) => t && !/^not part of a tour$/i.test(t));
    return `
      ${signInPanel()}
      <div class="h-layout${mine ? ' h-mine' : ''}">
        <section aria-label="${esc(data.name)} shows" id="h-picker"${mine ? ' hidden' : ''}>
          <div class="h-panel" style="margin-bottom:14px;">
            <strong>Import from setlist.fm</strong>
            <p class="h-msg" style="margin-top:2px;">Tick every ${esc(data.name)} show you've marked "I was there" on setlist.fm.</p>
            <form class="h-import" id="h-import">
              <input type="text" id="h-user" name="user" placeholder="setlist.fm username" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="setlist.fm username">
              <button class="btn btn-secondary" type="submit">Import</button>
            </form>
            <div id="h-import-msg"></div>
          </div>
          ${notice ? `<p class="h-msg">${esc(notice)}</p>` : ''}
          <div class="h-controls">
            <input type="search" id="h-q" placeholder="Search venue, city, date or tour" aria-label="Search shows">
            <select id="h-year" aria-label="Year"><option value="">All years</option>${years.map((y) => `<option>${y}</option>`).join('')}</select>
            <select id="h-tour" aria-label="Tour"><option value="">All tours</option>${tours.slice().reverse().map(([t, i]) => `<option value="${i}">${esc(t)}</option>`).join('')}</select>
          </div>
          <div class="h-bar">
            <span id="h-count"></span>
            <label><input type="checkbox" id="h-only"> Only ticked shows</label>
            <button type="button" id="h-clear">Clear all</button>
          </div>
          <div id="h-list"></div>
        </section>
        <aside class="h-results" id="h-results" aria-label="Your record"></aside>
      </div>`;
  }

  function renderList() {
    const byYear = new Map();
    for (let i = data.shows.length - 1; i >= 0; i--) {
      const show = data.shows[i];
      const y = show.date.slice(0, 4);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(show);
    }
    const parts = [];
    for (const [year, shows] of byYear) {
      parts.push(`<div class="h-year" data-year="${year}"><h3>${year} <span data-year-count="${year}"></span></h3>`);
      for (const show of shows) {
        const v = data.venues[show.venue] || ['', ''];
        const run = runs.get(runOf.get(show.id)) || [];
        // The button sits on the run's last night, the first one listed.
        const runButton = run.length > 1 && run[run.length - 1] === show.id
          ? `<button type="button" class="run" data-run="${esc(runOf.get(show.id))}">All ${run.length} nights</button>` : '<span></span>';
        const tour = show.tour >= 0 ? data.tours[show.tour] : '';
        parts.push(`<div class="h-show${show.sets.length ? '' : ' noset'}" data-id="${esc(show.id)}" data-search="${esc(`${show.date} ${shortDate(show.date, true)} ${v[0]} ${v[1]} ${tour}`.toLowerCase())}" data-tour="${show.tour}"><label><input type="checkbox" value="${esc(show.id)}" aria-label="${esc(`${shortDate(show.date, true)}, ${v[0]}`)}"><span class="d">${esc(shortDate(show.date))}</span><span class="v"><b>${esc(v[0])}</b><small>${esc(v[1])}</small></span></label>${runButton}</div>`);
      }
      parts.push('</div>');
    }
    const list = document.getElementById('h-list');
    list.innerHTML = parts.join('');
    list.querySelectorAll('.h-show').forEach((el) => rows.set(el.getAttribute('data-id'), el));
    for (const [id, el] of rows) {
      const on = selected.has(id);
      el.querySelector('input').checked = on;
      el.classList.toggle('on', on);
    }
  }

  // ── Controls ────────────────────────────────────────────────────────

  function bindControls() {
    const list = document.getElementById('h-list');
    list.addEventListener('change', (e) => {
      const box = e.target;
      if (!box || box.type !== 'checkbox') return;
      setTicked(box.value, box.checked);
      edited();
      update();
    });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('button.run');
      if (!btn) return;
      const ids = runs.get(btn.getAttribute('data-run')) || [];
      const all = ids.every((id) => selected.has(id));
      ids.forEach((id) => setTicked(id, !all));
      edited();
      update();
    });
    const q = document.getElementById('h-q');
    q.addEventListener('input', () => { filters.q = q.value.trim().toLowerCase(); applyFilters(); });
    const year = document.getElementById('h-year');
    year.addEventListener('change', () => { filters.year = year.value; applyFilters(); });
    const tour = document.getElementById('h-tour');
    tour.addEventListener('change', () => { filters.tour = tour.value; applyFilters(); });
    const only = document.getElementById('h-only');
    only.addEventListener('change', () => { filters.onlyTicked = only.checked; applyFilters(); });
    document.getElementById('h-clear').addEventListener('click', () => {
      if (!selected.size || !window.confirm(`Untick all ${plural(selected.size, 'show')}?`)) return;
      [...selected].forEach((id) => setTicked(id, false));
      edited();
      update();
    });
    document.getElementById('h-import').addEventListener('submit', (e) => { e.preventDefault(); importAttended(); });
    document.getElementById('h-results').addEventListener('click', onResultsClick);
  }

  function edited() {
    if (mine) mine.edited = true;
  }

  function setTicked(id, on) {
    if (on) selected.add(id); else selected.delete(id);
    const el = rows.get(id);
    if (el) { el.querySelector('input').checked = on; el.classList.toggle('on', on); }
  }

  function applyFilters() {
    const words = filters.q.split(/\s+/).filter(Boolean);
    let visible = 0;
    const perYear = new Map();
    for (const [id, el] of rows) {
      const hay = el.getAttribute('data-search');
      const year = hay.slice(0, 4);
      const ok = (!filters.year || year === filters.year)
        && (!filters.tour || el.getAttribute('data-tour') === filters.tour)
        && (!filters.onlyTicked || selected.has(id))
        && words.every((w) => hay.indexOf(w) >= 0);
      el.hidden = !ok;
      if (ok) { visible++; perYear.set(year, (perYear.get(year) || 0) + 1); }
    }
    document.querySelectorAll('.h-year').forEach((el) => { el.hidden = !perYear.get(el.getAttribute('data-year')); });
    document.getElementById('h-count').textContent = visible === rows.size ? plural(rows.size, 'show') : `${num(visible)} of ${plural(rows.size, 'show')}`;
  }

  // ── The record ──────────────────────────────────────────────────────

  // A run of ticks in one go (a run, an import) renders once, after them.
  // Not requestAnimationFrame: that never fires in a background tab.
  let pending = false;
  function update() {
    if (!mine) store.set(STORE_KEY, Heard.encodeSelection(data, [...selected]));
    posterUrls.forEach((u) => URL.revokeObjectURL(u));
    posterUrls = [];
    if (pending) return;
    pending = true;
    Promise.resolve().then(() => { pending = false; render(); });
  }

  function yearCounts() {
    const counts = new Map();
    for (const id of selected) {
      const el = rows.get(id);
      if (el) { const y = el.getAttribute('data-search').slice(0, 4); counts.set(y, (counts.get(y) || 0) + 1); }
    }
    document.querySelectorAll('[data-year-count]').forEach((el) => {
      const n = counts.get(el.getAttribute('data-year-count')) || 0;
      el.textContent = n ? `${n} ticked` : '';
    });
  }

  function songHref(s) { return `${boot.songPath}${encodeURIComponent(s.slug)}/`; }
  function songCell(s) {
    return `<a href="${esc(songHref(s))}">${esc(s.name)}</a>${s.isOriginal === false ? '<span class="tag">Cover</span>' : ''}`;
  }

  // In "your shows" mode the address bar says ?mine=1, which opens a
  // sign-in prompt for anyone else. The browser's own Share and Copy Link
  // (Safari's and Chrome's on a phone) take the canonical link when there
  // is one, so point it at this record's /r/ link while there is a record.
  // The page is noindex in this mode, and a crawler never gets here.
  const canonical = document.querySelector('link[rel="canonical"]');
  const toolCanonical = canonical ? canonical.href : '';
  function pointCanonical(record) {
    if (!canonical || !mine) return;
    canonical.href = (record.shows && linkNow()) || toolCanonical;
  }

  function render() {
    applyFilters();
    yearCounts();
    const record = Heard.buildRecord(data, selected);
    pointCanonical(record);
    const results = document.getElementById('h-results');
    const pickerOpen = !document.getElementById('h-picker').hidden;
    if (dock) {
      dock.hidden = !record.shows || !pickerOpen;
      dock.innerHTML = record.shows ? `<span><b>${plural(record.shows, 'show')}</b> · ${plural(record.uniqueSongs, 'song')} heard</span><a class="btn" href="#h-results">See your record</a>` : '';
    }
    if (!record.shows) {
      results.innerHTML = `<div class="h-panel"><h2>Your ${esc(data.name)} record</h2>${mineLine(record)}<p class="h-empty">Tick the shows you were at and your record appears here: every song you've heard, your top songs, rarest catches and bust-outs.</p></div>`;
      return;
    }
    const span = Heard.yearSpan(record);
    const stats = [
      [num(record.shows), record.shows === 1 ? 'Show' : 'Shows'],
      [span, record.years === 1 ? 'Year' : `${record.years} years`],
      [num(record.venues), record.venues === 1 ? 'Venue' : 'Venues'],
      [num(record.uniqueSongs), 'Songs'],
      [num(record.totalSongs), 'Performances'],
    ];
    const list = (items, line) => `<ol class="songs">${items.map((s) => `<li>${line(s)}</li>`).join('')}</ol>`;
    const songs = record.songs.slice().sort(songSort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const missingSetlists = record.shows - record.showsWithSetlist;

    results.innerHTML = `
      <div class="h-panel">
        <h2>Your ${esc(data.name)} record</h2>
        ${mineLine(record)}
        <div class="h-stats">${stats.map(([v, l]) => `<div class="stat"><div class="n${String(v).length > 5 ? ' sm' : ''}">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}</div>
        ${missingSetlists ? `<p class="h-msg">${plural(missingSetlists, 'show')} you ticked ${missingSetlists === 1 ? 'has' : 'have'} no known setlist, so ${missingSetlists === 1 ? 'it adds' : 'they add'} no songs.</p>` : ''}
        <div class="h-actions">
          <button type="button" class="btn" data-act="poster">Make my poster</button>
          <button type="button" class="btn btn-secondary" data-act="share">Share link</button>
          <button type="button" class="btn btn-secondary" data-act="copy">Copy link</button>
        </div>
        <div id="h-poster"></div>
        <div id="h-share" class="h-share"></div>
        ${mine ? '' : `<div class="cta" style="margin-top:16px;padding:14px;text-align:left;">
          <strong>Keep these shows</strong>
          <p class="h-msg" style="margin:2px 0 10px;">Save all ${plural(record.shows, 'show')} with their setlists to a free MySetlists account, and track every other band you see.</p>
          <button type="button" class="btn" data-act="save">Save these shows to MySetlists (free)</button>
        </div>`}

        <h2>Your top ${Math.min(10, record.top.length)}</h2>
        ${list(record.top, (s) => `${songCell(s)} <span class="note">· ${s.count}×</span>`)}

        ${record.rarest.length ? `<h2>Rarest catches</h2><p class="h-msg" style="margin-top:0;">Songs you heard that ${esc(data.name)} has played the fewest times.</p>${list(record.rarest, (s) => `${songCell(s)} <span class="note">· played ${plural(s.timesPlayed, 'time')} ever</span>`)}` : ''}

        ${record.bustOuts.length ? `<h2>Bust-outs you witnessed</h2>${list(record.bustOuts, (s) => `${songCell(s)} <span class="note">· after ${plural(s.gap, 'show')}, ${esc(shortDate(s.show.date, true))}</span>`)}` : ''}

        ${record.debuts.length ? `<h2>Debuts you witnessed</h2>${list(record.debuts.slice(0, 15), (s) => `${songCell(s)} <span class="note">· ${esc(shortDate(s.show.date, true))}</span>`)}${record.debuts.length > 15 ? `<p class="h-msg">And ${num(record.debuts.length - 15)} more.</p>` : ''}` : ''}

        ${record.chasing.length ? `<h2>Songs you're still chasing</h2><p class="h-msg" style="margin-top:0;">${esc(data.name)}'s most played originals you haven't heard yet.</p>${list(record.chasing, (s) => `${songCell(s)} <span class="note">· played ${plural(s.timesPlayed, 'time')}</span>`)}` : ''}

        <h2>Every song you've heard (${num(record.uniqueSongs)})</h2>
        <div class="h-sort">Sort by <button type="button" data-sort="count" aria-pressed="${songSort === 'count'}">times heard</button> <button type="button" data-sort="name" aria-pressed="${songSort === 'name'}">name</button></div>
        <table><tbody>${songs.map((s) => `<tr><td>${songCell(s)}</td><td class="num">${s.count}×</td></tr>`).join('')}</tbody></table>
        <p class="source">${esc(boot.credit)}.</p>
      </div>`;
    if (autoPoster) {
      autoPoster = false;
      makePoster(results.querySelector('[data-act="poster"]'));
    }
  }

  // "From your 23 Goose shows in MySetlists · Edit selection", and the
  // logged shows the archive doesn't have.
  function mineLine(record) {
    if (!mine) return '';
    const line = mine.edited
      ? `Your ${esc(data.name)} shows, edited for this poster: ${plural(record.shows, 'show')}. Your shows in MySetlists haven't changed. <button type="button" class="h-link" data-act="reset">Use my shows again</button>`
      : `From your ${plural(mine.count, `${esc(data.name)} show`)} in MySetlists · <button type="button" class="h-link" data-act="edit">Edit selection</button>`;
    const open = mine.unmatched.filter((u) => !(u.nearest && selected.has(u.nearest.id)));
    const missing = open.length ? `
      <details class="h-unmatched"${open.length <= 5 ? ' open' : ''}>
        <summary>${plural(open.length, 'show')} not found on ${esc(data.sourceName)}, so ${open.length === 1 ? 'it isn\'t' : 'they aren\'t'} on this poster</summary>
        <ul>${open.map((u) => `<li>${esc(shortDate(u.date, true))}${u.venue ? `, ${esc(u.venue)}` : ''}${u.nearest ? `<br><span class="h-msg">${esc(data.sourceName)} has ${esc(data.name)} at ${esc(u.nearest.venue)} that day. <button type="button" class="h-link" data-act="add-nearest" data-id="${esc(u.nearest.id)}">Add that show</button></span>` : ''}</li>`).join('')}</ul>
      </details>` : '';
    return `<p class="h-msg h-mine-line">${line}</p>${missing}`;
  }

  function onResultsClick(e) {
    const sort = e.target.closest && e.target.closest('[data-sort]');
    if (sort) { songSort = sort.getAttribute('data-sort'); render(); return; }
    const act = e.target.closest && e.target.closest('[data-act]');
    if (!act) return;
    const what = act.getAttribute('data-act');
    if (what === 'edit') openPicker();
    else if (what === 'reset') resetToMine();
    else if (what === 'add-nearest') { setTicked(act.getAttribute('data-id'), true); edited(); update(); }
    else if (what === 'poster') makePoster(act);
    else if (what === 'share') shareLink(act, false);
    else if (what === 'copy') shareLink(act, true);
    else if (what === 'save') saveToAccount(act);
    else if (what === 'download') download(act.getAttribute('data-kind'));
    else if (what === 'share-image') shareImage(act.getAttribute('data-kind'));
  }

  function openPicker() {
    const picker = document.getElementById('h-picker');
    picker.hidden = false;
    document.querySelector('.h-layout').classList.remove('h-mine');
    render();
    picker.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetToMine() {
    [...selected].forEach((id) => setTicked(id, false));
    mine.ids.forEach((id) => setTicked(id, true));
    mine.edited = false;
    update();
  }

  // ── Share code, link and poster ─────────────────────────────────────

  // The code for a link: inline when it fits, else stored by heard-share.js
  // under a short id.
  async function shareCode() {
    const code = Heard.encodeSelection(data, [...selected]);
    if (code.length <= MAX_INLINE_CODE) return code;
    if (stored.code === code) return stored.id;
    const res = await fetch(boot.shareApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: boot.slug, code }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.id) throw new Error('share failed');
    stored = { code, id: json.id };
    return json.id;
  }

  const shareUrl = (code) => `${location.origin}${boot.toolPath}r/${code}/`;
  const imageUrl = (code, kind) => `${shareUrl(code)}poster-${kind}.png`;

  // The /r/ link for the current selection, without waiting when it can:
  // an inline code, or a long one already stored. Copy link and Share use
  // it inside the tap, since Safari refuses the clipboard and the share
  // sheet once an await has gone by; null means shareCode() must store it.
  function linkNow() {
    const code = Heard.encodeSelection(data, [...selected]);
    if (code.length <= MAX_INLINE_CODE) return shareUrl(code);
    return stored.code === code ? shareUrl(stored.id) : null;
  }

  // Share link and Copy link: the same /r/ link, however the selection was
  // made (ticked, imported from setlist.fm, or the user's logged shows).
  // Share opens the share sheet on a phone and copies elsewhere.
  async function shareLink(btn, copyOnly) {
    const box = document.getElementById('h-share');
    btn.disabled = true;
    try {
      const ready = linkNow();
      const title = Heard.headline(data.name, Heard.buildRecord(data, selected));
      const sheet = !copyOnly && navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      let said = 'Copy the link above to share your record.';
      let done = null;
      if (ready && sheet) done = navigator.share({ title, url: ready }).then(() => '', () => said);
      else if (ready && navigator.clipboard) done = navigator.clipboard.writeText(ready).then(() => 'Link copied.', () => said);
      const url = ready || shareUrl(await shareCode());
      box.innerHTML = `<input type="text" readonly value="${esc(url)}" aria-label="Share link"><p class="h-msg" id="h-share-msg"></p>`;
      const input = box.querySelector('input');
      input.addEventListener('focus', () => input.select());
      if (!done && sheet) done = navigator.share({ title, url }).then(() => '', () => said);
      else if (!done && navigator.clipboard) done = navigator.clipboard.writeText(url).then(() => 'Link copied.', () => said);
      if (done) said = await done;
      document.getElementById('h-share-msg').textContent = said;
    } catch (e) {
      box.innerHTML = '<p class="h-msg err">Couldn\'t make a link just now. Please try again.</p>';
    } finally {
      btn.disabled = false;
    }
  }

  const blobs = {};
  async function makePoster(btn) {
    const box = document.getElementById('h-poster');
    btn.disabled = true;
    box.innerHTML = '<p class="h-msg">Drawing your poster…</p>';
    try {
      const code = await shareCode();
      const kinds = [['feed', 'Feed, 1080×1350'], ['story', 'Story, 1080×1920']];
      // Fetched ahead, so Share can hand the file over inside the tap:
      // Safari refuses navigator.share() once an await has gone by.
      const fetched = await Promise.all(kinds.map(([kind]) => fetchImage(imageUrl(code, kind), code[0] === 'b' ? 6 : 1)));
      const canShareFiles = !!(navigator.canShare && window.File);
      box.innerHTML = `<div class="h-posters">${kinds.map(([kind, label], i) => {
        blobs[kind] = fetched[i];
        const url = URL.createObjectURL(fetched[i]);
        posterUrls.push(url);
        const file = canShareFiles ? new File([fetched[i]], fileName(kind), { type: 'image/png' }) : null;
        const share = file && navigator.canShare({ files: [file] });
        return `<figure><img src="${url}" alt="${esc(`${data.name} poster, ${label}`)}"><figcaption>${label}</figcaption><div class="h-actions"><button type="button" class="btn" data-act="download" data-kind="${kind}">Download</button>${share ? `<button type="button" class="btn btn-secondary" data-act="share-image" data-kind="${kind}">Share</button>` : ''}</div></figure>`;
      }).join('')}</div>`;
    } catch (e) {
      box.innerHTML = '<p class="h-msg err">Couldn\'t draw the poster just now. Please try again.</p>';
    } finally {
      btn.disabled = false;
    }
  }

  // A just-stored code ('b…') can take a few seconds to resolve on every
  // server (heardShares.js), so its images are retried on a 404.
  async function fetchImage(url, tries) {
    for (let i = 1; ; i++) {
      const res = await fetch(url);
      if (res.ok) return res.blob();
      if (res.status !== 404 || i >= tries) throw new Error(`HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  const fileName = (kind) => `${boot.slug}-songs-heard-${kind}.png`;

  function download(kind) {
    const blob = blobs[kind];
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(kind);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function shareImage(kind) {
    const blob = blobs[kind];
    if (!blob) return;
    const file = new File([blob], fileName(kind), { type: 'image/png' });
    const title = Heard.headline(data.name, Heard.buildRecord(data, selected));
    // The record's own /r/ link in the text, not the page's address. In
    // the text rather than as `url`, so the sheet still treats it as an
    // image share; the posters' code is always stored or inline by now.
    const link = linkNow();
    navigator.share({ files: [file], title, text: link ? `${title} ${link}` : `${title} · mysetlists.net/heard` })
      .catch((e) => { if (!e || e.name !== 'AbortError') download(kind); });
  }

  async function saveToAccount(btn) {
    btn.disabled = true;
    try {
      const code = await shareCode();
      window.location.href = `${boot.saveUrl}${encodeURIComponent(`${boot.slug}.${code}`)}`;
    } catch (e) {
      btn.disabled = false;
      btn.insertAdjacentHTML('afterend', '<p class="h-msg err">Something went wrong. Please try again.</p>');
    }
  }

  // ── setlist.fm import ───────────────────────────────────────────────

  async function importAttended() {
    const input = document.getElementById('h-user');
    const msg = document.getElementById('h-import-msg');
    const user = input.value.trim();
    if (!user) { input.focus(); return; }
    msg.innerHTML = '<p class="h-msg">Reading your setlist.fm attendance…</p>';
    try {
      const res = await fetch(`${boot.importApi}?slug=${encodeURIComponent(boot.slug)}&user=${encodeURIComponent(user)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const why = json.error === 'not_found' ? `There's no setlist.fm user called "${esc(user)}". Check the spelling (it's the name in your profile's address).`
          : json.error === 'busy' ? 'setlist.fm is busy right now. Please try again in a minute.'
            : 'Couldn\'t reach setlist.fm just now. Please try again.';
        msg.innerHTML = `<p class="h-msg err">${why}</p>`;
        return;
      }
      let added = 0;
      json.ids.forEach((id) => { if (!selected.has(id)) added++; setTicked(id, true); });
      if (added) edited();
      update();
      const parts = [`Found ${plural(json.attended, `${data.name} show`)} on setlist.fm and matched ${num(json.ids.length)}${added < json.ids.length ? ` (${num(json.ids.length - added)} already ticked)` : ''}.`];
      if (json.truncated) parts.push(`We read your ${num(json.scanned)} most recent attended shows.`);
      let html = `<p class="h-msg">${esc(parts.join(' '))}</p>`;
      if (json.unmatched.length) {
        html += `<details><summary class="h-msg">${plural(json.unmatched.length, 'show')} we couldn't match</summary><ul class="h-msg">${json.unmatched.map((u) => `<li>${esc(shortDate(u.date, true))}, ${esc(u.venue)}${u.city ? `, ${esc(u.city)}` : ''}</li>`).join('')}</ul></details>`;
      }
      msg.innerHTML = html;
    } catch (e) {
      msg.innerHTML = '<p class="h-msg err">Couldn\'t reach setlist.fm just now. Please try again.</p>';
    }
  }
}

module.exports = { createHeardApp };
