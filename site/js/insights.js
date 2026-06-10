/* The Paper Trail — citizen-perspective exhibits built from the ledger.
   Rendered lazily by app.js via renderInsights(ctx); every figure is computed
   from the same ROWS the explorer uses, so exhibits and explorer always agree. */

function renderInsights(ctx) {
  const { ROWS, VENDORS, DOCS, gotoExplore, docHref } = ctx;
  const CAP_FUNDS = ["31", "33", "36"];
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

  // ---------------- shared aggregates ----------------
  const apMonths = [];                       // AP coverage window: 2024-05 .. end
  {
    const ms = [...new Set(ROWS.map(r => r.month))].sort();
    for (const m of ms) if (m >= "2024-05") apMonths.push(m);
  }
  const LAST_MONTH = apMonths[apMonths.length - 1];

  const EVENTS = [
    { m: "2025-08", tag: "LOAN MADE", txt: "$10M moved from the health-insurance fund to the general fund — without board approval" },
    { m: "2025-11", tag: "CFO EXITS", txt: "CFO Adam Kurth resigns; the seat stays empty" },
    { m: "2026-01", tag: "BOARD LEARNS", txt: "Jan 27: the board learns of the loan and approves it retroactively" },
    { m: "2026-02", tag: "PUBLIC PUSHBACK", txt: "Feb 10: residents detail omitted funds and unexplained gaps in the financial reports" },
    { m: "2026-03", tag: "$7.5M CUTS", txt: "Mar 24: board approves $7.5M in budget cuts" },
    { m: "2026-04", tag: "LOAN DENIED", txt: "A $25M outside loan proves unavailable — the district is three years behind on audits" },
    { m: "2026-05", tag: "NEW CFO", txt: "May 13: permanent CFO Pat Moore starts" },
  ];

  // ---------------- timeline strip ----------------
  document.getElementById("pt-timeline").innerHTML =
    `<div class="ptl-rail"></div>` + EVENTS.map((e, i) => `
      <div class="ptl-ev" style="animation-delay:${i * 90}ms">
        <div class="ptl-dot"></div>
        <div class="ptl-when">${fmtMonth(e.m).toUpperCase()}</div>
        <div class="ptl-tag">${esc(e.tag)}</div>
        <div class="ptl-txt">${esc(e.txt)}</div>
      </div>`).join("");

  // ---------------- exhibit scaffolding ----------------
  const host = document.getElementById("pt-exhibits");
  host.innerHTML = "";
  function exhibit(letter, kicker, title, lede) {
    const el = document.createElement("div");
    el.className = "panel ex-panel";
    el.innerHTML = `
      <div class="ex-side mono"><span class="ex-letter">EXHIBIT ${letter}</span></div>
      <div class="ex-main">
        <div class="ex-kicker mono">${esc(kicker)}</div>
        <h2 class="ex-title">${title}</h2>
        <p class="ex-lede">${lede}</p>
        <div class="ex-body"></div>
        <div class="ex-foot mono"></div>
      </div>`;
    host.appendChild(el);
    return { body: el.querySelector(".ex-body"), foot: el.querySelector(".ex-foot") };
  }

  function chips(el, items, active, onPick) {
    el.innerHTML = items.map(c =>
      `<button class="chip ${c.key === active ? "on" : ""}" data-k="${c.key}">${esc(c.label)}</button>`).join("");
    el.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => onPick(b.dataset.k)));
  }

  // monthly bar chart with event flags; bars click through to the explorer
  function monthBars(el, months, values, opts = {}) {
    const W = 1040, H = 280, padL = 54, padB = 50, padT = 30, padR = 6;
    const iW = W - padL - padR, iH = H - padT - padB;
    const maxV = Math.max(...values, 1);
    const bw = iW / months.length;
    let g = "";
    const step = niceStep(maxV / 4);
    for (let v = step; v <= maxV * 1.02; v += step) {
      const y = padT + iH - v / maxV * iH;
      g += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#d8cdb9" stroke-dasharray="1 3"/>
            <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8294a8" font-family="IBM Plex Mono">${moneyShort(v)}</text>`;
    }
    months.forEach((m, i) => {
      const v = Math.max(0, values[i]);
      const h = v / maxV * iH, x = padL + i * bw + bw * 0.16, y = padT + iH - h;
      const partial = opts.partial === m;
      g += `<rect class="ib" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.68).toFixed(1)}" height="${Math.max(h, .5).toFixed(1)}"
             fill="${opts.color || "#234a77"}" ${partial ? 'opacity="0.45"' : ""} rx="1" data-m="${m}" data-v="${values[i]}"/>`;
      if (m.slice(5) === "07" || m.slice(5) === "01")
        g += `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#44556b" font-family="IBM Plex Mono">${fmtMonth(m)}</text>`;
    });
    (opts.events || []).forEach(e => {
      const i = months.indexOf(e.m);
      if (i < 0) return;
      const x = padL + i * bw + bw / 2;
      g += `<line x1="${x.toFixed(1)}" y1="${padT - 4}" x2="${x.toFixed(1)}" y2="${padT + iH}" stroke="#b23a2a" stroke-width="1" stroke-dasharray="2 3" opacity=".7"/>
            <text class="ev-flag" x="${x.toFixed(1)}" y="${padT - 10}" text-anchor="middle" font-size="8.5" fill="#b23a2a" font-family="IBM Plex Mono" letter-spacing=".5">${esc(e.tag)}</text>`;
    });
    g += `<line x1="${padL}" y1="${padT + iH}" x2="${W - padR}" y2="${padT + iH}" stroke="#1c2a3a" stroke-width="1.5"/>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
    el.querySelectorAll(".ib").forEach(r => {
      r.addEventListener("mousemove", e => tooltip.show(
        `<div><strong>${fmtMonth(r.dataset.m)}</strong>${opts.partial === r.dataset.m ? " · partial month" : ""}</div>
         <div class="tt-amt">${fmtUSD.format(+r.dataset.v)}</div><div style="opacity:.7">click to see the line items</div>`,
        e.clientX, e.clientY));
      r.addEventListener("mouseleave", () => tooltip.hide());
      r.addEventListener("click", () => { tooltip.hide(); opts.onClick && opts.onClick(r.dataset.m); });
    });
  }

  // ============================================================
  // EXHIBIT A — the construction wind-down
  // ============================================================
  {
    const ex = exhibit("A", "CAPITAL FUNDS 31 · 33 · 36",
      "The construction boom, hitting the brakes",
      `More than half of every dollar in this ledger — <strong>${moneyShort(sum(ROWS.filter(r => CAP_FUNDS.includes(r.fund)), r => r.amount))}</strong> —
       went to construction and equipment, most of it from the <strong>SAVE</strong> statewide-sales-tax fund.
       At its peak in late 2024 the district paid contractors about <strong>$11M a month</strong>. Watch what happens
       as the crisis unfolds: by spring 2026, with the $104M facilities plan on pause, the same funds are spending
       a tenth of that.`);
    ex.body.innerHTML = `<div class="chiprow" id="exa-chips"></div><div id="exa-chart"></div>
      <div class="ex-vendors" id="exa-vendors"></div>`;
    const scopes = [
      { key: "cap", label: "All capital funds", f: r => CAP_FUNDS.includes(r.fund), fund: null },
      { key: "33", label: "SAVE (sales tax)", f: r => r.fund === "33", fund: "33" },
      { key: "36", label: "PPEL (property levy)", f: r => r.fund === "36", fund: "36" },
      { key: "31", label: "GO Bond", f: r => r.fund === "31", fund: "31" },
    ];
    let cur = "cap";
    function draw() {
      const sc = scopes.find(s => s.key === cur);
      chips(document.getElementById("exa-chips"), scopes, cur, k => { cur = k; draw(); });
      const by = {}; for (const r of ROWS) if (sc.f(r)) by[r.month] = (by[r.month] || 0) + r.amount;
      monthBars(document.getElementById("exa-chart"), apMonths, apMonths.map(m => by[m] || 0), {
        color: "#b23a2a", partial: LAST_MONTH,
        events: EVENTS.filter(e => ["LOAN MADE", "BOARD LEARNS", "$7.5M CUTS"].includes(e.tag)),
        onClick: m => gotoExplore(sc.fund ? { month: m, fund: sc.fund } : { month: m, fund: "33" }),
      });
      const vs = {}; for (const r of ROWS) if (sc.f(r)) vs[r.group] = (vs[r.group] || 0) + r.amount;
      document.getElementById("exa-vendors").innerHTML =
        `<span class="mono small" style="margin-right:6px">TOP PAYEES:</span>` +
        Object.entries(vs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, a]) =>
          `<button class="vchip" data-q="${esc(v)}">${esc(titleCase(v))} <span>${moneyShort(a)}</span></button>`).join("");
      document.getElementById("exa-vendors").querySelectorAll(".vchip").forEach(b =>
        b.addEventListener("click", () => gotoExplore({ q: b.dataset.q })));
    }
    draw();
    ex.foot.textContent = "Funds 31 (GO bond), 33 (SAVE statewide sales tax) and 36 (PPEL property levy) — the district's construction money. Check-run data begins May 2024; the last month is partial.";
  }

  // ============================================================
  // EXHIBIT B — can you see the cuts?
  // ============================================================
  {
    const ex = exhibit("B", "FY25 VS FY26, MONTH BY MONTH",
      "Can you see the cuts?",
      `The board approved <strong>$7.5&nbsp;million in cuts</strong> on March&nbsp;24, 2026 — reassigned office staff, delayed
       curriculum purchases, positions left unfilled. Set the two fiscal years side by side and the belt-tightening is
       visible well before that vote: FY26 runs below FY25 in almost every month. Use the buttons to separate
       day-to-day operations from construction.`);
    ex.body.innerHTML = `<div class="chiprow" id="exb-chips"></div><div id="exb-chart"></div>`;
    const scopes = [
      { key: "all", label: "All spending", f: () => true },
      { key: "gen", label: "General fund (day-to-day)", f: r => r.fund === "10", fund: "10" },
      { key: "cap", label: "Capital funds (construction)", f: r => CAP_FUNDS.includes(r.fund) },
      { key: "rest", label: "Everything else", f: r => r.fund !== "10" && !CAP_FUNDS.includes(r.fund) },
    ];
    let cur = "all";
    const ORDER = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
    function draw() {
      const sc = scopes.find(s => s.key === cur);
      chips(document.getElementById("exb-chips"), scopes, cur, k => { cur = k; draw(); });
      const agg = {};
      for (const r of ROWS) {
        if (r.fy !== 2025 && r.fy !== 2026) continue;
        if (!sc.f(r)) continue;
        agg[r.fy + "-" + +r.month.slice(5)] = (agg[r.fy + "-" + +r.month.slice(5)] || 0) + r.amount;
      }
      const a = ORDER.map(m => Math.max(0, agg["2025-" + m] || 0));
      const b = ORDER.map(m => Math.max(0, agg["2026-" + m] || 0));
      const W = 1040, H = 300, padL = 54, padB = 56, padT = 16, padR = 6;
      const iW = W - padL - padR, iH = H - padT - padB;
      const maxV = Math.max(...a, ...b, 1), gw = iW / 12;
      let g = "";
      const step = niceStep(maxV / 4);
      for (let v = step; v <= maxV * 1.02; v += step) {
        const y = padT + iH - v / maxV * iH;
        g += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#d8cdb9" stroke-dasharray="1 3"/>
              <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8294a8" font-family="IBM Plex Mono">${moneyShort(v)}</text>`;
      }
      const NAMES = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
      ORDER.forEach((m, i) => {
        const x0 = padL + i * gw;
        const mk = (v, off, color, fy, faded) => {
          const h = v / maxV * iH;
          return `<rect class="ib" x="${(x0 + gw * off).toFixed(1)}" y="${(padT + iH - h).toFixed(1)}" width="${(gw * 0.3).toFixed(1)}"
            height="${Math.max(h, .5).toFixed(1)}" fill="${color}" ${faded ? 'opacity=".45"' : ""} rx="1"
            data-m="${fy === 2025 ? (m >= 7 ? "2024" : "2025") : (m >= 7 ? "2025" : "2026")}-${String(m).padStart(2, "0")}" data-v="${v}" data-fy="${fy}"/>`;
        };
        g += mk(a[i], 0.14, "#234a77", 2025, false);
        g += mk(b[i], 0.50, "#e09f1f", 2026, m === 6);
        g += `<text x="${(x0 + gw / 2).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#44556b" font-family="IBM Plex Mono">${NAMES[i]}</text>`;
      });
      // event flags on the FY26 series
      [["JAN", "BOARD LEARNS"], ["MAR", "CUTS APPROVED"]].forEach(([nm, tag]) => {
        const i = NAMES.indexOf(nm[0] + nm.slice(1).toLowerCase());
        const x = padL + i * gw + gw / 2;
        g += `<line x1="${x}" y1="${padT + 2}" x2="${x}" y2="${padT + iH}" stroke="#b23a2a" stroke-dasharray="2 3" opacity=".6"/>
              <text x="${x}" y="${padT - 3}" text-anchor="middle" font-size="8.5" fill="#b23a2a" font-family="IBM Plex Mono" letter-spacing=".5">${tag}</text>`;
      });
      g += `<line x1="${padL}" y1="${padT + iH}" x2="${W - padR}" y2="${padT + iH}" stroke="#1c2a3a" stroke-width="1.5"/>`;
      const t25 = sum(a, v => v), t26 = sum(b, v => v);
      g += `<text x="${W - padR}" y="${H - 6}" text-anchor="end" font-size="11" fill="#44556b" font-family="IBM Plex Mono">FY25 ${moneyShort(t25)}  →  FY26 ${moneyShort(t26)}  (${t25 ? Math.round((t26 - t25) / t25 * 100) : 0}%)</text>`;
      const el = document.getElementById("exb-chart");
      el.innerHTML = `<div class="legend" style="margin:2px 0 6px">
          <div class="legend-item"><div class="legend-swatch" style="background:#234a77"></div>FY25 (Jul '24–Jun '25)</div>
          <div class="legend-item"><div class="legend-swatch" style="background:#e09f1f"></div>FY26 (Jul '25–Jun '26)</div>
        </div><svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
      el.querySelectorAll(".ib").forEach(r => {
        r.addEventListener("mousemove", e => tooltip.show(
          `<div><strong>FY${r.dataset.fy - 2000} · ${fmtMonth(r.dataset.m)}</strong></div>
           <div class="tt-amt">${fmtUSD.format(+r.dataset.v)}</div><div style="opacity:.7">click to see the line items</div>`,
          e.clientX, e.clientY));
        r.addEventListener("mouseleave", () => tooltip.hide());
        r.addEventListener("click", () => {
          tooltip.hide();
          gotoExplore(scopes.find(s => s.key === cur).fund ? { month: r.dataset.m, fund: scopes.find(s => s.key === cur).fund } : { month: r.dataset.m });
        });
      });
    }
    draw();
    ex.foot.textContent = "June 2026 (lighter bar) covers only the first days of the month — the last published board packet. FY24 is excluded: check-run reports only begin May 2024.";
  }

  // ============================================================
  // EXHIBIT C — who the money stopped (and started) going to
  // ============================================================
  {
    const ex = exhibit("C", "BIGGEST VENDOR SWINGS, FY25 → FY26",
      "Who the money stopped — and started — going to",
      `Rank every vendor by how much their payments changed between the two fiscal years and the crisis reads like a
       before-and-after photo: construction firms fall off a cliff, while payments surge to the bond trustee,
       the area education agency, and school-bus contractor. Click any bar to see every underlying payment.`);
    ex.body.innerHTML = `<div id="exc-chart" class="dv-wrap"></div>`;
    const byV = {};
    for (const r of ROWS) {
      if (r.fy !== 2025 && r.fy !== 2026) continue;
      (byV[r.group] = byV[r.group] || { 2025: 0, 2026: 0 })[r.fy] += r.amount;
    }
    const swings = Object.entries(byV)
      .filter(([, y]) => Math.max(y[2025], y[2026]) >= 250000)
      .map(([v, y]) => ({ v, a: y[2025], b: y[2026], d: y[2026] - y[2025] }))
      .sort((x, y) => x.d - y.d);
    const items = [...swings.slice(0, 7), ...swings.slice(-7).reverse()];
    const maxD = Math.max(...items.map(i => Math.abs(i.d)));
    document.getElementById("exc-chart").innerHTML = items.map(it => `
      <div class="dv-row" data-q="${esc(it.v)}" title="FY25 ${fmtUSD.format(it.a)} → FY26 ${fmtUSD.format(it.b)}">
        <div class="dv-name">${esc(titleCase(it.v))}</div>
        <div class="dv-track">
          <div class="dv-zero"></div>
          <div class="dv-bar ${it.d < 0 ? "neg" : "pos"}" style="width:${(Math.abs(it.d) / maxD * 50).toFixed(1)}%;${it.d < 0 ? "right:50%" : "left:50%"}"></div>
        </div>
        <div class="dv-amt mono ${it.d < 0 ? "neg" : "pos"}">${it.d < 0 ? "−" : "+"}${moneyShort(Math.abs(it.d))}</div>
      </div>`).join("");
    document.getElementById("exc-chart").querySelectorAll(".dv-row").forEach(row =>
      row.addEventListener("click", () => gotoExplore({ q: row.dataset.q })));
    ex.foot.textContent = "Vendors paid at least $250K in either year; seven largest decreases and seven largest increases shown. FY26 is missing most of June, which slightly understates its totals.";
  }

  // ============================================================
  // EXHIBIT D — the bond bill arrives
  // ============================================================
  {
    const ints = ROWS.filter(r => r.group === "UMB BANK, N.A." && r.date === "2025-12-02" && /INTEREST/i.test(r.desc));
    const tot = sum(ints, r => r.amount);
    const ex = exhibit("D", "DEBT SERVICE · FUND 40",
      "The bond bill arrives",
      `Years of borrowing for construction come due on fixed dates, crisis or not. On <strong>December 2, 2025</strong> —
       weeks after the CFO resigned, weeks before the board learned of the $10M loan — a single check run paid the
       bond trustee <strong>${fmtUSD.format(tot)}</strong> in interest alone. By spring, replenishing the SAVE fund
       for the June 1 bond payment was a stated reason the district sought a $25M loan.`);
    ex.body.innerHTML = `
      <div class="receipt mono">
        <div class="rc-head">UMB BANK, N.A. · BOND TRUSTEE<br><span>CHECK RUN OF DEC 2, 2025 — INTEREST PAYMENTS</span></div>
        ${ints.sort((x, y) => y.amount - x.amount).map(r => `
          <div class="rc-row"><span>BOND INTEREST PAYMENT</span><span class="rc-dots"></span><span>${fmtUSD.format(r.amount)}</span>
            <a class="rc-src" href="${docHref(r)}" target="_blank" rel="noopener" title="${esc(DOCS[r.doc])}, page ${r.page}">PDF</a></div>`).join("")}
        <div class="rc-total"><span>TOTAL, ONE CHECK RUN</span><span class="rc-dots"></span><span>${fmtUSD.format(tot)}</span></div>
      </div>
      <button class="vchip" id="exd-all" style="margin-top:10px">All UMB Bank payments in the ledger →</button>`;
    document.getElementById("exd-all").addEventListener("click", () => gotoExplore({ q: "UMB BANK" }));
    ex.foot.textContent = "Each PDF link opens the board report page this payment appears on. The June 1, 2026 bond payment does not appear in packets published so far.";
  }

  // ============================================================
  // EXHIBIT E — the Center for Innovation
  // ============================================================
  {
    const cfi = ROWS.filter(r => r.loc === "0080");
    const tot = sum(cfi, r => r.amount);
    const ex = exhibit("E", "LOCATION CODE 0080 · FORMER ACT / TYLER BUILDING",
      "What the Center for Innovation has cost since",
      `The district bought the former ACT building for <strong>$8.75&nbsp;million in 2022</strong> — before this ledger begins —
       to create its Center for Innovation. The purchase has drawn criticism as the crisis deepened. The checkbook shows what
       came <em>after</em>: another <strong>${moneyShort(tot)}</strong> in renovation and programming coded to the building
       in just the two years covered here.`);
    ex.body.innerHTML = `<div id="exe-chart"></div><div class="ex-vendors" id="exe-vendors"></div>`;
    const by = {}; for (const r of cfi) by[r.month] = (by[r.month] || 0) + r.amount;
    let acc = 0;
    const cumVals = apMonths.map(m => (acc += (by[m] || 0)));
    // cumulative area
    {
      const W = 1040, H = 240, padL = 54, padB = 34, padT = 14, padR = 6;
      const iW = W - padL - padR, iH = H - padT - padB;
      const maxV = Math.max(...cumVals, 1), bw = iW / apMonths.length;
      let pts = apMonths.map((m, i) => `${(padL + i * bw + bw / 2).toFixed(1)},${(padT + iH - cumVals[i] / maxV * iH).toFixed(1)}`);
      let g = "";
      const step = niceStep(maxV / 3);
      for (let v = step; v <= maxV * 1.02; v += step) {
        const y = padT + iH - v / maxV * iH;
        g += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#d8cdb9" stroke-dasharray="1 3"/>
              <text x="${padL - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="#8294a8" font-family="IBM Plex Mono">${moneyShort(v)}</text>`;
      }
      g += `<polygon points="${padL + bw / 2},${padT + iH} ${pts.join(" ")} ${padL + (apMonths.length - 1) * bw + bw / 2},${padT + iH}" fill="#2f7f8a" opacity=".18"/>`;
      g += `<polyline points="${pts.join(" ")}" fill="none" stroke="#2f7f8a" stroke-width="2"/>`;
      apMonths.forEach((m, i) => {
        if (m.slice(5) === "07" || m.slice(5) === "01")
          g += `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#44556b" font-family="IBM Plex Mono">${fmtMonth(m)}</text>`;
      });
      g += `<text x="${padL + (apMonths.length - 1) * bw - 4}" y="${padT + iH - cumVals[cumVals.length - 1] / maxV * iH - 8}" text-anchor="end" font-size="12" font-weight="600" fill="#2f7f8a" font-family="IBM Plex Mono">${moneyShort(tot)} cumulative</text>`;
      g += `<line x1="${padL}" y1="${padT + iH}" x2="${W - padR}" y2="${padT + iH}" stroke="#1c2a3a" stroke-width="1.5"/>`;
      document.getElementById("exe-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
    }
    const vs = {}; for (const r of cfi) vs[r.group] = (vs[r.group] || 0) + r.amount;
    document.getElementById("exe-vendors").innerHTML =
      `<span class="mono small" style="margin-right:6px">PAID AT 0080:</span>` +
      Object.entries(vs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([v, a]) =>
        `<button class="vchip" data-q="${esc(v)}">${esc(titleCase(v))} <span>${moneyShort(a)}</span></button>`).join("") +
      `<button class="vchip" id="exe-all">All 0080 transactions →</button>`;
    document.getElementById("exe-vendors").querySelectorAll(".vchip[data-q]").forEach(b =>
      b.addEventListener("click", () => gotoExplore({ loc: "0080", q: b.dataset.q })));
    document.getElementById("exe-all").addEventListener("click", () => gotoExplore({ loc: "0080" }));
    ex.foot.textContent = "Cumulative payments carrying location code 0080 (Center for Innovation) since check-run data begins. The 2022 building purchase itself predates this ledger and is not included.";
  }

  // ---------------- what the checkbook can't show ----------------
  {
    const el = document.createElement("div");
    el.className = "panel ex-panel ex-cant";
    el.innerHTML = `
      <div class="ex-side mono"><span class="ex-letter">CAVEAT</span></div>
      <div class="ex-main">
        <h2 class="ex-title">What the checkbook <em>can't</em> show</h2>
        <ul class="ex-list">
          <li><strong>The $10M interfund loan itself.</strong> It was a transfer between district funds, not a payment to a vendor — it never passes through accounts payable. Its absence from these pages is exactly why it went unnoticed.</li>
          <li><strong>Payroll.</strong> Salaries and benefits — the majority of the budget, and most of the $7.5M in cuts — are paid through a separate system.</li>
          <li><strong>Four check runs</strong> (~$6.8M) listed on official summaries but never published, and the January 2026 card statement. <a href="#about">Details on the About page →</a></li>
        </ul>
        <p class="ex-lede" style="margin-top:10px">Reporting on the crisis draws on
          <a href="https://wsspaper.com/116027/news/budget-cuts-loans-denied-and-resignations-a-deep-dive-into-the-iccsds-current-financial-state/" target="_blank" rel="noopener">West Side Story's investigation</a>
          (West High's student newspaper). Every figure in the exhibits above comes from this ledger's own data — click through any chart to the underlying transactions and their source PDFs.</p>
      </div>`;
    host.appendChild(el);
  }
}
