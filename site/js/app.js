/* The ICCSD Ledger — main app */
(async function () {
  tooltip.init();

  // ---------------- load data ----------------
  const fill = document.getElementById("loader-fill");
  const note = document.getElementById("loader-note");
  fill.style.width = "12%";
  const resp = await fetch("data/transactions.json");
  const reader = resp.body.getReader();
  const total = +resp.headers.get("Content-Length") || 7.5e6;
  let chunks = [], got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    fill.style.width = Math.min(12 + got / total * 70, 84) + "%";
  }
  note.textContent = "Indexing the ledger…";
  const blob = new Blob(chunks);
  const raw = JSON.parse(await blob.text());
  fill.style.width = "88%";

  const VENDORS = raw.vendors, GROUPS = raw.groups, DOCS = raw.docs || [];
  // decode rows -> typed objects
  // row: [src, date, vendorIdx, desc, acct, amount, ref, po, docIdx, pdfPage]
  const ROWS = raw.rows.map(r => {
    const acct = r[4] || null;
    const a = parseAcct(acct);
    return {
      src: r[0], date: r[1], month: r[1].slice(0, 7), fy: fyOf(r[1]),
      vi: r[2], group: GROUPS[r[2]],
      desc: r[3] || "", acct,
      fund: a ? a.fund : null, loc: a ? a.loc : null,
      func: a ? a.func : null, obj: a ? a.obj : null,
      amount: r[5], ref: r[6] || "", po: r[7] || "",
      doc: r[8], page: r[9],
    };
  });
  const docHref = r => r.doc == null ? "" : "docs/" + encodeURIComponent(DOCS[r.doc]) + "#page=" + r.page;
  const MEETINGS = raw.meetings || {};   // meeting date -> Simbli meeting id
  const agendaHref = file => {
    const mid = MEETINGS[(file || "").slice(0, 10)];
    return mid ? `https://simbli.eboardsolutions.com/SB_Meetings/ViewMeeting.aspx?S=36031992&MID=${mid}&Tab=Agenda` : "";
  };
  // search blob per row (lazy-built lowercase)
  const SEARCH = ROWS.map(r => (VENDORS[r.vi] + " " + r.group + " " + r.desc + " " + r.ref + " " + r.po).toLowerCase());
  fill.style.width = "100%";

  const validation = await fetch("data/validation.json").then(r => r.json()).catch(() => null);

  // ---------------- aggregates ----------------
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const TOTAL = sum(ROWS, r => r.amount);

  const months = [...new Set(ROWS.map(r => r.month))].sort();
  const fundTotals = {};
  const monthFund = {};
  for (const r of ROWS) {
    const fk = r.fund || "uncoded";
    fundTotals[fk] = (fundTotals[fk] || 0) + r.amount;
    (monthFund[r.month] = monthFund[r.month] || {})[fk] = (monthFund[r.month][fk] || 0) + r.amount;
  }

  // vendor aggregates by canonical group
  const vAgg = new Map();
  ROWS.forEach((r, i) => {
    let v = vAgg.get(r.group);
    if (!v) vAgg.set(r.group, v = { name: r.group, total: 0, n: 0, first: r.date, last: r.date, rows: [] });
    v.total += r.amount; v.n++; v.rows.push(i);
    if (r.date < v.first) v.first = r.date;
    if (r.date > v.last) v.last = r.date;
  });
  const vendorsRanked = [...vAgg.values()].sort((a, b) => b.total - a.total);

  // ---------------- header / hero ----------------
  document.getElementById("hero-range").textContent = "JUL 2023 – JUN 2026";
  animateCount(document.getElementById("hero-total"), TOTAL);
  document.getElementById("hero-count").textContent = fmtNum.format(ROWS.length);
  document.getElementById("hero-vendors").textContent = fmtNum.format(vendorsRanked.length);

  const fundOrder = Object.keys(fundTotals).sort((a, b) => fundTotals[b] - fundTotals[a]);
  const heroCards = document.getElementById("hero-cards");
  const maxFund = Math.max(...Object.values(fundTotals));
  heroCards.innerHTML = fundOrder.slice(0, 6).map((f, i) => {
    const info = FUNDS[f] || FUND_UNCODED;
    return `<div class="fund-card" data-fund="${f}" style="animation-delay:${i * 70}ms">
      <div class="fc-name">${esc(info.name)}</div>
      <div class="fc-amt">${moneyShort(fundTotals[f])}</div>
      <div class="fc-bar"><div class="fc-fill" style="width:${(fundTotals[f] / maxFund * 100).toFixed(1)}%;background:${info.color}"></div></div>
    </div>`;
  }).join("");
  heroCards.querySelectorAll(".fund-card").forEach(c =>
    c.addEventListener("click", () => gotoExplore({ fund: c.dataset.fund })));

  // ---------------- monthly stacked chart ----------------
  const topFunds = fundOrder.slice(0, 6);
  const series = topFunds.map(f => ({ key: f, label: (FUNDS[f] || FUND_UNCODED).name, color: (FUNDS[f] || FUND_UNCODED).color }));
  const otherKeys = fundOrder.slice(6);
  if (otherKeys.length) {
    series.push({ key: "__other", label: "All other funds", color: "#b5ad9c" });
    for (const m of months) {
      const mf = monthFund[m] || {};
      mf.__other = otherKeys.reduce((s, k) => s + (mf[k] || 0), 0);
    }
  }
  stackedBars(document.getElementById("chart-monthly"), months, series, monthFund,
    (m, k) => gotoExplore({ month: m, fund: k === "__other" ? null : k }),
    { through: "2024-04", lines: ["PURCHASING-CARD SPENDING ONLY", "check-run reports begin May 2024"] });
  document.getElementById("legend-monthly").innerHTML = series.map(s =>
    `<div class="legend-item" data-f="${s.key}"><div class="legend-swatch" style="background:${s.color}"></div>${esc(s.label)}</div>`).join("");
  document.getElementById("legend-monthly").querySelectorAll(".legend-item").forEach(li =>
    li.addEventListener("click", () => gotoExplore({ fund: li.dataset.f === "__other" ? null : li.dataset.f })));

  // ---------------- top vendors ----------------
  barList(document.getElementById("top-vendors"), vendorsRanked.slice(0, 12).map(v => ({
    name: titleCase(v.name), sub: `${fmtNum.format(v.n)} payments`, value: v.total,
    onClick: () => gotoExplore({ q: v.name }),
  })));

  // ---------------- biggest payments ----------------
  const biggest = [...ROWS].sort((a, b) => b.amount - a.amount).slice(0, 10);
  document.getElementById("biggest-table").innerHTML = biggest.map(r => `
    <tr data-q="${esc(VENDORS[r.vi])}">
      <td class="dt">${fmtDate(r.date)}</td>
      <td><strong>${esc(titleCase(VENDORS[r.vi]))}</strong><br><span class="small">${esc(r.desc.slice(0, 70))}</span></td>
      <td class="amt">${money(r.amount)}</td>
    </tr>`).join("");
  document.getElementById("biggest-table").querySelectorAll("tr").forEach(tr =>
    tr.addEventListener("click", () => gotoExplore({ q: tr.dataset.q })));

  // ---------------- source split + FY compare ----------------
  const apTotal = sum(ROWS.filter(r => r.src === "a"), r => r.amount);
  const cardTotal = TOTAL - apTotal;
  splitBar(document.getElementById("source-split"), [
    { label: "Board-approved check runs", value: apTotal, color: "#234a77" },
    { label: "Purchasing cards (BMO Mastercard)", value: cardTotal, color: "#2f7f8a" },
  ]);

  const fyTotals = {};
  for (const r of ROWS) fyTotals[r.fy] = (fyTotals[r.fy] || 0) + r.amount;
  barList(document.getElementById("fy-compare"), Object.keys(fyTotals).sort().map(fy => ({
    name: "FY " + fy, sub: `Jul ${fy - 1} – Jun ${fy}`, value: fyTotals[fy], color: "#8c6d46",
    onClick: () => gotoExplore({ fy }),
  })));

  // ---------------- explore ----------------
  const state = { q: "", fund: "", src: "", fy: "", loc: "", obj: "", amt: "", month: "", sort: "date", dir: -1, shown: 100 };
  let filtered = [];

  const els = {
    q: document.getElementById("q"), fund: document.getElementById("f-fund"),
    src: document.getElementById("f-src"), fy: document.getElementById("f-fy"),
    loc: document.getElementById("f-loc"), obj: document.getElementById("f-obj"),
    amt: document.getElementById("f-amt"), strip: document.getElementById("result-strip"),
    body: document.getElementById("results-body"), more: document.getElementById("load-more"),
  };

  // populate filter options
  els.fund.innerHTML += fundOrder.map(f => `<option value="${f}">${esc((FUNDS[f] || FUND_UNCODED).name)} (${f === "uncoded" ? "card" : f})</option>`).join("");
  els.fy.innerHTML += Object.keys(fyTotals).sort().map(fy => `<option value="${fy}">FY ${fy}</option>`).join("");
  const locTotals = {};
  for (const r of ROWS) if (r.loc) locTotals[r.loc] = (locTotals[r.loc] || 0) + r.amount;
  const locOrder = Object.keys(locTotals).sort((a, b) => locTotals[b] - locTotals[a]);
  els.loc.innerHTML += locOrder.slice(0, 60).map(l => `<option value="${l}">${esc(locName(l))}</option>`).join("");
  const objFams = {};
  for (const r of ROWS) if (r.obj) { const f = objFamily(r.obj); objFams[f] = (objFams[f] || 0) + r.amount; }
  els.obj.innerHTML += Object.keys(objFams).sort((a, b) => objFams[b] - objFams[a]).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join("");

  // ---------------- shareable URLs ----------------
  // the active explore filters live in the hash (#explore?q=…&fund=…) so any
  // filtered view can be bookmarked, shared, and opened by someone else
  const FILTER_KEYS = ["q", "fund", "src", "fy", "loc", "obj", "amt", "month"];

  function syncURL() {
    if ((location.hash || "").split("?")[0] !== "#explore") return;
    const p = new URLSearchParams();
    for (const k of FILTER_KEYS) if (state[k]) p.set(k, state[k]);
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + "#explore" + (qs ? "?" + qs : ""));
  }

  function applyHashParams(qs) {
    const p = new URLSearchParams(qs);
    for (const k of FILTER_KEYS) state[k] = p.get(k) || "";
    els.q.value = state.q;
    for (const k of ["fund", "src", "fy", "loc", "obj", "amt"]) els[k].value = state[k];
    applyFilters();
  }

  function applyFilters() {
    const q = state.q.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    filtered = [];
    for (let i = 0; i < ROWS.length; i++) {
      const r = ROWS[i];
      if (state.fund) {
        if (state.fund === "uncoded" ? r.fund !== null : r.fund !== state.fund) continue;
      }
      if (state.src && r.src !== state.src) continue;
      if (state.fy && r.fy !== +state.fy) continue;
      if (state.loc && r.loc !== state.loc) continue;
      if (state.obj && (!r.obj || objFamily(r.obj) !== state.obj)) continue;
      if (state.month && r.month !== state.month) continue;
      if (state.amt === "neg") { if (r.amount >= 0) continue; }
      else if (state.amt && Math.abs(r.amount) < +state.amt) continue;
      if (terms.length) {
        const s = SEARCH[i];
        let ok = true;
        for (const t of terms) if (!s.includes(t)) { ok = false; break; }
        if (!ok) continue;
      }
      filtered.push(r);
    }
    sortFiltered();
    state.shown = 100;
    renderResults();
    syncURL();
  }

  function sortFiltered() {
    const { sort, dir } = state;
    const key = sort === "vendor" ? (r => VENDORS[r.vi]) : sort === "amount" ? (r => r.amount) : (r => r.date);
    filtered.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }

  function renderResults() {
    const tot = sum(filtered, r => r.amount);
    const monthsActive = state.month ? ` in ${fmtMonth(state.month)} <button class="btn-ghost btn" id="clear-month" style="padding:2px 8px;font-size:11px">×</button>` : "";
    els.strip.innerHTML = `<strong>${fmtNum.format(filtered.length)}</strong> line items${monthsActive} totaling <strong>${money(tot, true)}</strong>`;
    const cm = document.getElementById("clear-month");
    if (cm) cm.addEventListener("click", () => { state.month = ""; applyFilters(); });

    els.body.innerHTML = filtered.slice(0, state.shown).map(r => {
      const v = VENDORS[r.vi];
      const fundInfo = r.fund ? (FUNDS[r.fund] || { name: r.fund }) : FUND_UNCODED;
      return `<tr>
        <td class="td-date">${r.date}</td>
        <td class="td-vendor"><span class="src-dot src-${r.src}" title="${r.src === "a" ? "check run" : "purchasing card"}"></span><span class="vendor-link" data-q="${esc(v)}">${esc(titleCase(v))}</span></td>
        <td class="td-desc">${esc(r.desc) || "<span style='opacity:.4'>—</span>"}${r.acct ? `<span class="acct-code">${r.acct}${r.po ? " · PO " + esc(r.po) : ""}</span>` : (r.ref && r.src === "c" ? `<span class="acct-code">card ····${esc(r.ref)}</span>` : "")}</td>
        <td class="td-tag">${esc(fundInfo.name)}</td>
        <td class="td-tag">${r.loc ? esc(locName(r.loc)) : ""}</td>
        <td class="td-amt">${money(r.amount, true)}</td>
        <td class="td-doc">${r.doc != null ? `<a class="doc-link" href="${docHref(r)}" target="_blank" rel="noopener" title="Open the district's source document — ${esc(DOCS[r.doc])}, page ${r.page}">PDF<span class="doc-pg"> p.${r.page}</span></a>${agendaHref(DOCS[r.doc]) ? ` <a class="doc-link" href="${agendaHref(DOCS[r.doc])}" target="_blank" rel="noopener" title="ICCSD board meeting agenda of ${fmtDate(DOCS[r.doc].slice(0, 10))}, where this document was published">agenda</a>` : ""}` : ""}</td>
      </tr>`;
    }).join("");
    els.more.style.display = filtered.length > state.shown ? "block" : "none";
    els.more.textContent = `Show more rows (${fmtNum.format(filtered.length - state.shown)} remaining)`;
    els.body.querySelectorAll(".vendor-link").forEach(a =>
      a.addEventListener("click", () => { els.q.value = a.dataset.q; state.q = a.dataset.q; applyFilters(); }));
  }

  let debounce;
  els.q.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => { state.q = els.q.value; applyFilters(); }, 180); });
  for (const k of ["fund", "src", "fy", "loc", "obj", "amt"]) {
    els[k].addEventListener("change", () => { state[k] = els[k].value; applyFilters(); });
  }
  document.getElementById("f-clear").addEventListener("click", () => {
    Object.assign(state, { q: "", fund: "", src: "", fy: "", loc: "", obj: "", amt: "", month: "" });
    els.q.value = ""; for (const k of ["fund", "src", "fy", "loc", "obj", "amt"]) els[k].value = "";
    applyFilters();
  });
  els.more.addEventListener("click", () => { state.shown += 250; renderResults(); });
  document.querySelectorAll("#results-table th.sortable").forEach(th => {
    th.addEventListener("click", () => {
      const s = th.dataset.sort;
      if (state.sort === s) state.dir *= -1; else { state.sort = s; state.dir = s === "date" ? -1 : s === "amount" ? -1 : 1; }
      document.querySelectorAll("#results-table th").forEach(t => t.classList.remove("sorted"));
      th.classList.add("sorted");
      sortFiltered(); renderResults();
    });
  });

  const copyBtn = document.getElementById("copy-link");
  copyBtn.addEventListener("click", async () => {
    syncURL();
    const url = location.href;
    let ok = true;
    try { await navigator.clipboard.writeText(url); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = url; document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
    }
    copyBtn.textContent = ok ? "Link copied ✓" : "Copy failed";
    setTimeout(() => { copyBtn.textContent = "Copy link"; }, 1800);
  });

  document.getElementById("export-csv").addEventListener("click", () => {
    const head = "date,source,vendor,description,account,fund,location,amount,ref,po,source_document,source_page,meeting_agenda\n";
    const csv = head + filtered.map(r => [
      r.date, r.src === "a" ? "check" : "card", q(VENDORS[r.vi]), q(r.desc), r.acct || "",
      r.fund ? (FUNDS[r.fund] || {}).name || r.fund : "card-uncoded",
      r.loc ? locName(r.loc) : "", r.amount.toFixed(2), q(r.ref), q(r.po),
      q(r.doc != null ? DOCS[r.doc] : ""), r.doc != null ? r.page : "",
      q(r.doc != null ? agendaHref(DOCS[r.doc]) : ""),
    ].join(",")).join("\n");
    function q(s) { s = String(s || ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "iccsd-ledger-export.csv";
    a.click();
  });

  function gotoExplore(opts = {}) {
    Object.assign(state, { q: "", fund: "", src: "", fy: "", loc: "", obj: "", amt: "", month: "" }, opts);
    els.q.value = state.q || "";
    els.fund.value = state.fund || ""; els.src.value = state.src || "";
    els.fy.value = state.fy || ""; els.loc.value = state.loc || ""; els.obj.value = state.obj || ""; els.amt.value = state.amt || "";
    location.hash = "#explore";
    applyFilters();
  }

  // ---------------- vendors view ----------------
  const vbody = document.getElementById("vendor-body");
  const vmore = document.getElementById("vendor-more");
  const vq = document.getElementById("vq");
  let vShown = 50, vList = vendorsRanked;

  function renderVendors() {
    vbody.innerHTML = vList.slice(0, vShown).map((v, i) => `
      <tr data-name="${esc(v.name)}" style="cursor:pointer">
        <td class="num mono small">${i + 1}</td>
        <td><strong>${esc(titleCase(v.name))}</strong></td>
        <td class="num mono">${fmtNum.format(v.n)}</td>
        <td class="num mono small">${v.first}</td>
        <td class="num mono small">${v.last}</td>
        <td class="td-amt">${money(v.total)}</td>
      </tr>`).join("");
    vmore.style.display = vList.length > vShown ? "block" : "none";
    vmore.textContent = `Show more vendors (${fmtNum.format(Math.max(vList.length - vShown, 0))} remaining)`;
    vbody.querySelectorAll("tr").forEach(tr =>
      tr.addEventListener("click", () => showVendorDetail(tr.dataset.name)));
  }
  vq.addEventListener("input", () => {
    const t = vq.value.trim().toLowerCase();
    vList = t ? vendorsRanked.filter(v => v.name.toLowerCase().includes(t)) : vendorsRanked;
    vShown = 50; renderVendors();
  });
  vmore.addEventListener("click", () => { vShown += 100; renderVendors(); });

  function showVendorDetail(name) {
    const v = vAgg.get(name);
    if (!v) return;
    const byMonth = {};
    const byAcct = {};
    for (const i of v.rows) {
      const r = ROWS[i];
      byMonth[r.month] = (byMonth[r.month] || 0) + r.amount;
      if (r.func) { const f = funcFamily(r.func); byAcct[f] = (byAcct[f] || 0) + r.amount; }
    }
    const topAccts = Object.entries(byAcct).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const el = document.getElementById("vendor-detail");
    el.innerHTML = `<div class="vendor-card">
      <button class="vc-close" title="close">×</button>
      <h3>${esc(titleCase(name))}</h3>
      <div class="vc-stats">
        <div class="vc-stat"><div class="lab">Total received</div><div class="val">${money(v.total)}</div></div>
        <div class="vc-stat"><div class="lab">Payments</div><div class="val">${fmtNum.format(v.n)}</div></div>
        <div class="vc-stat"><div class="lab">First seen</div><div class="val">${v.first}</div></div>
        <div class="vc-stat"><div class="lab">Last seen</div><div class="val">${v.last}</div></div>
      </div>
      ${sparkline(months, byMonth)}
      ${topAccts.length ? `<div class="vc-accounts">Spending areas: ${topAccts.map(([f, amt]) => `<span>${esc(f)} · ${moneyShort(amt)}</span>`).join("")}</div>` : ""}
      <a class="more-link" href="#explore" data-q="${esc(name)}">See all ${fmtNum.format(v.n)} transactions &rarr;</a>
    </div>`;
    el.querySelector(".vc-close").addEventListener("click", () => el.innerHTML = "");
    el.querySelector(".more-link").addEventListener("click", e => { e.preventDefault(); gotoExplore({ q: name }); });
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------- cards view ----------------
  const CARD_EV = raw.cards || {};   // last4 -> [modal coded location, n at modal, total coded]
  const cAgg = new Map();
  for (const r of ROWS) {
    if (r.src !== "c" || !r.ref) continue;
    let c = cAgg.get(r.ref);
    if (!c) cAgg.set(r.ref, c = { card: r.ref, total: 0, n: 0, first: r.date, last: r.date, byMonth: {}, merchants: {} });
    c.total += r.amount; c.n++;
    if (r.date < c.first) c.first = r.date;
    if (r.date > c.last) c.last = r.date;
    c.byMonth[r.month] = (c.byMonth[r.month] || 0) + r.amount;
    c.merchants[r.group] = (c.merchants[r.group] || 0) + r.amount;
  }
  const cardsRanked = [...cAgg.values()].sort((a, b) => b.total - a.total);

  function cardEvidence(card) {
    const ev = CARD_EV[card];
    if (!ev) return { kind: "none", html: `<span class="small" style="opacity:.55">no coded purchases</span>` };
    const [loc, n, of] = ev;
    if (of >= 5 && n / of >= 0.8)
      return { kind: "strong", loc, n, of, html: `<strong>${esc(locName(loc))}</strong> <span class="small mono">${n}/${of} coded</span>` };
    return { kind: "weak", loc, n, of, html: `<span class="small">inconclusive · ${of} coded purchase${of === 1 ? "" : "s"}</span>` };
  }

  const cbody = document.getElementById("cards-body");
  const cmore = document.getElementById("cards-more");
  let cShown = 50;

  function renderCards() {
    cbody.innerHTML = cardsRanked.slice(0, cShown).map((c, i) => `
      <tr data-card="${c.card}" style="cursor:pointer">
        <td class="num mono small">${i + 1}</td>
        <td class="mono"><strong>····${c.card}</strong></td>
        <td>${cardEvidence(c.card).html}</td>
        <td class="num mono">${fmtNum.format(c.n)}</td>
        <td class="num mono small">${c.first}</td>
        <td class="num mono small">${c.last}</td>
        <td class="td-amt">${money(c.total)}</td>
      </tr>`).join("");
    cmore.style.display = cardsRanked.length > cShown ? "block" : "none";
    cmore.textContent = `Show more cards (${fmtNum.format(Math.max(cardsRanked.length - cShown, 0))} remaining)`;
    cbody.querySelectorAll("tr").forEach(tr =>
      tr.addEventListener("click", () => showCardDetail(tr.dataset.card)));
  }
  cmore.addEventListener("click", () => { cShown += 60; renderCards(); });

  function showCardDetail(card) {
    const c = cAgg.get(card);
    if (!c) return;
    const ev = cardEvidence(card);
    const topMerch = Object.entries(c.merchants).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const evLine = ev.kind === "strong"
      ? `The district's coded P-Card reports tie <strong>${ev.n} of ${ev.of}</strong> of this card's coded purchases to <strong>${esc(locName(ev.loc))}</strong>.`
      : ev.kind === "weak"
        ? `This card has ${ev.of} coded purchase${ev.of === 1 ? "" : "s"} — too few or too inconsistent to support a building assignment.`
        : `None of this card's purchases appear in the district's coded P-Card reports (published only for spring 2026), so no assignment can be supported.`;
    const el = document.getElementById("card-detail");
    el.innerHTML = `<div class="vendor-card">
      <button class="vc-close" title="close">×</button>
      <h3 class="mono">Card ····${esc(card)}</h3>
      <div class="vc-stats">
        <div class="vc-stat"><div class="lab">Total spent</div><div class="val">${money(c.total)}</div></div>
        <div class="vc-stat"><div class="lab">Swipes</div><div class="val">${fmtNum.format(c.n)}</div></div>
        <div class="vc-stat"><div class="lab">First seen</div><div class="val">${c.first}</div></div>
        <div class="vc-stat"><div class="lab">Last seen</div><div class="val">${c.last}</div></div>
      </div>
      ${sparkline(months, c.byMonth)}
      <p class="small" style="margin-top:8px">${evLine}</p>
      <div class="vc-accounts">Top merchants: ${topMerch.map(([m, amt]) => `<span>${esc(titleCase(m))} · ${moneyShort(amt)}</span>`).join("")}</div>
      <a class="more-link" href="#explore" data-card="${esc(card)}">See all ${fmtNum.format(c.n)} swipes &rarr;</a>
    </div>`;
    el.querySelector(".vc-close").addEventListener("click", () => el.innerHTML = "");
    el.querySelector(".more-link").addEventListener("click", e => { e.preventDefault(); gotoExplore({ q: card, src: "c" }); });
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------- schools view ----------------
  const schoolEl = document.getElementById("school-list");
  const schoolCards = locOrder.filter(l => LOCATIONS[l] && l !== "0000").map(l => {
    const rows = ROWS.filter(r => r.loc === l);
    const byFunc = {};
    for (const r of rows) { const f = funcFamily(r.func); byFunc[f] = (byFunc[f] || 0) + r.amount; }
    const top = Object.entries(byFunc).sort((a, b) => b[1] - a[1])[0];
    return { code: l, total: locTotals[l], n: rows.length, top: top ? top[0] : "" };
  });
  schoolEl.innerHTML = schoolCards.map((s, i) => `
    <div class="school-card" data-loc="${s.code}" style="animation-delay:${Math.min(i * 40, 600)}ms">
      <div class="sc-code">${s.code}${SCHOOL_KINDS[s.code] ? " · " + SCHOOL_KINDS[s.code].toUpperCase() : ""}</div>
      <div class="sc-name">${esc(LOCATIONS[s.code])}</div>
      <div class="sc-amt">${moneyShort(s.total)}</div>
      <div class="sc-top">${fmtNum.format(s.n)} items · mostly ${esc(s.top.toLowerCase())}</div>
    </div>`).join("");
  schoolEl.querySelectorAll(".school-card").forEach(c =>
    c.addEventListener("click", () => gotoExplore({ loc: c.dataset.loc })));

  // ---------------- categories view ----------------
  let treemapDone = false;
  function renderCategories() {
    if (treemapDone) return;
    treemapDone = true;
    const byFunc = {};
    for (const r of ROWS) { if (r.amount <= 0) continue; const f = funcFamily(r.func); byFunc[f] = (byFunc[f] || 0) + r.amount; }
    treemap(document.getElementById("treemap-func"),
      Object.entries(byFunc).sort((a, b) => b[1] - a[1]).map(([f, v]) => ({
        name: f, value: v, color: FUNC_COLORS[f] || "#9aa8b5",
        onClick: () => gotoExploreFunc(f),
      })));
    barList(document.getElementById("obj-bars"),
      Object.entries(objFams).sort((a, b) => b[1] - a[1]).map(([o, v]) => ({
        name: o, value: v, color: "#2f7f8a",
        onClick: () => gotoExplore({ obj: o }),
      })));
  }
  // function-family filter needs special handling (not a dropdown filter): reuse obj approach via state
  let funcFilter = "";
  function gotoExploreFunc(f) {
    funcFilter = f;
    gotoExplore({});
    funcFilterApply(f);
  }
  function funcFilterApply(f) {
    // narrow `filtered` post-hoc and annotate the strip
    filtered = filtered.filter(r => funcFamily(r.func) === f);
    sortFiltered(); state.shown = 100; renderResults();
    const tot = sum(filtered, r => r.amount);
    els.strip.innerHTML = `<strong>${fmtNum.format(filtered.length)}</strong> line items in <strong>${esc(f)}</strong> totaling <strong>${money(tot, true)}</strong> <button class="btn-ghost btn" id="clear-func" style="padding:2px 8px;font-size:11px">×</button>`;
    document.getElementById("clear-func").addEventListener("click", () => { funcFilter = ""; applyFilters(); });
  }

  // ---------------- about view ----------------
  document.getElementById("coa-decoder").innerHTML = [
    ["10", "Fund", "General Operating — which pot of money"],
    ["0109", "Location", "City High School — which building"],
    ["1100", "Function", "Regular instruction — what activity"],
    ["100", "Program", "district program code"],
    ["0000", "Project", "grant / project tracking"],
    ["612", "Object", "supplies — what was bought"],
  ].map(([c, w, m]) => `<div class="coa-seg"><div class="code">${c}</div><div class="what">${w}</div><div class="means">${m}</div></div>`).join("");

  document.getElementById("about-stats").innerHTML = [
    ["Documents parsed", "280 PDFs"],
    ["Board meetings", "41"],
    ["Check batches", "102"],
    ["AP line items", fmtNum.format(ROWS.filter(r => r.src === "a").length)],
    ["Card transactions", fmtNum.format(ROWS.filter(r => r.src === "c").length)],
    ["Distinct vendors", fmtNum.format(vendorsRanked.length)],
    ["Total tracked", fmtUSD.format(TOTAL)],
  ].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join("");

  if (validation) {
    const fileByBatch = {};
    for (const b of validation.batches || []) fileByBatch[b.batch_date] = b.file;
    const rows = validation.official_vs_parsed.map(b => {
      const ok = b.official != null && b.parsed != null && Math.abs(b.official - b.parsed) <= 1;
      const status = b.parsed == null ? `<span class="val-bad">report missing</span>`
        : b.official == null ? `<span class="small">not on summary</span>`
        : ok ? `<span class="val-ok">match ✓</span>`
        : `<span class="val-bad">differs ${moneyShort(b.parsed - b.official)}</span>`;
      const f = fileByBatch[b.batch_date];
      const ag = f && agendaHref(f);
      const cell = f ? `<a class="doc-link" href="docs/${encodeURIComponent(f)}" target="_blank" rel="noopener" title="Open the board report PDF — ${esc(f)}">${b.batch_date}</a>${ag ? ` <a class="doc-link val-agenda" href="${ag}" target="_blank" rel="noopener" title="ICCSD board meeting agenda of ${fmtDate(f.slice(0, 10))}">agenda</a>` : ""}` : b.batch_date;
      return `<tr><td>${cell}</td><td class="num">${b.official != null ? fmtUSD.format(b.official) : "—"}</td><td class="num">${b.parsed != null ? fmtUSD.format(b.parsed) : "—"}</td><td>${status}</td></tr>`;
    }).join("");
    document.getElementById("validation-table").innerHTML = `
      <table class="val-table">
        <thead><tr><th>Check run</th><th class="num">Summary sheet</th><th class="num">This ledger</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ---------------- routing ----------------
  function route() {
    const h = (location.hash || "#overview").slice(1);
    const [name, params] = [h.split("?")[0], h.includes("?") ? h.slice(h.indexOf("?") + 1) : ""];
    const tab = ["overview", "explore", "vendors", "cards", "schools", "categories", "about"].includes(name) ? name : "overview";
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + tab).classList.add("active");
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    if (tab === "categories") renderCategories();
    if (tab === "explore" && params) applyHashParams(params);
    window.scrollTo({ top: 0 });
  }
  window.addEventListener("hashchange", route);
  route();

  // initial explore render + vendors (skip if route() already applied a shared link)
  if ((location.hash || "").split("?")[0] !== "#explore" || !location.hash.includes("?")) applyFilters();
  renderVendors();
  renderCards();

  // dismiss loader
  setTimeout(() => document.getElementById("loader").classList.add("done"), 350);

  function animateCount(el, target) {
    const dur = 1400, t0 = performance.now();
    function tick(t) {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmtUSD.format(target * eased);
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
})();
