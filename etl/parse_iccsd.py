#!/usr/bin/env python3
"""
ICCSD Accounts Payable ETL
Parses extracted text from board AP documents into a unified transaction dataset.

Sources:
  - BoardReport10003 (all 41 meetings): AP invoice line items w/ chart-of-account codes
  - BMO Transactions (monthly card statements, Jul 2023 - Jun 2026): purchasing-card txns
  - P Card coded files (Mar/Apr 2026): card txns w/ account codes (enrich BMO rows)
  - Accounts_Payable_Summaries: official fund totals (validation only)

Outputs site/data/*.json
"""
import csv
import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime

EXTRACTED = os.path.join(os.path.dirname(__file__), "..", "extracted")
OUTDIR = os.path.join(os.path.dirname(__file__), "..", "site", "data")
MANIFEST = os.path.join(os.path.dirname(__file__), "..", "ICCSD_AP_Documents_manifest.csv")

KNOWN_FUNDS = {
    "10": "General Operating",
    "21": "Student Activity",
    "22": "Management Levy",
    "31": "Capital Projects — GO Bond",
    "33": "Capital Projects — SAVE (sales tax)",
    "36": "Physical Plant & Equipment Levy",
    "40": "Debt Service",
    "61": "School Nutrition",
    "71": "Health Self-Insurance",
    "74": "Dental Self-Insurance",
    "82": "School Children's Aid (trust)",
    "84": "School-Based Health Clinics",
}

# ---------------------------------------------------------------- helpers

def parse_amount(s):
    s = s.strip()
    neg = False
    if s.endswith("-"):
        neg, s = True, s[:-1]
    if s.startswith("(") and s.endswith(")"):
        neg, s = True, s[1:-1]
    s = s.replace("$", "").replace(",", "").strip()
    if s in ("", "-"):
        return 0.0
    v = float(s)
    return -v if neg else v


def mdY_to_iso(s):
    m, d, y = s.split("/")
    if len(y) == 2:
        y = "20" + y
    return f"{y}-{int(m):02d}-{int(d):02d}"


AMT = r"\(?\$?\s*-?[\d,]+\.\d{2}\)?-?"
# Account codes: 2-digit fund followed by 3-5 more segments (expense 2-4-4-3-4-3,
# balance-sheet 2-3-3-4-3, revenue 2-4-4-3-4, etc.). Greedy desc + fund-first anchor
# binds the rightmost valid code; fund is validated against KNOWN_FUNDS downstream.
ACCT = r"\d{2}(?: \d{2,4}){3,5}"

RE_DETAIL = re.compile(
    rf"^(?P<desc>.*?)\s+(?P<acct>{ACCT})\s+(?P<amt>\(?[\d,]+\.\d{{2}}\)?-?)\s*$"
)
# invoice numbers may contain single spaces ("City Ph 3"); vendor/invoice columns
# are separated by 2+ spaces, invoice ends at the invoice-date token
RE_VENDOR = re.compile(
    r"^(?P<vendor>\S.*?)\s{2,}(?P<invoice>\S+(?: \S+)*?)\s+(?P<invdate>\d{2}/\d{2}/\d{4})"
    r"(?:\s+(?P<po>\S+))?\s+(?P<amt>\(?[\d,]+\.\d{2}\)?-?)\s*$"
)
# fallback: vendor name fills its column leaving a single space before the invoice;
# greedy vendor + single-token invoice resolves the boundary
RE_VENDOR_TIGHT = re.compile(
    r"^(?P<vendor>\S.*) (?P<invoice>\S+)\s+(?P<invdate>\d{2}/\d{2}/\d{4})"
    r"(?:\s+(?P<po>\S+))?\s+(?P<amt>\(?[\d,]+\.\d{2}\)?-?)\s*$"
)
RE_FUND = re.compile(r"Fund:\s*(?P<code>\d{2})\s+(?P<name>[A-Z][A-Z &\-'./]*[A-Z.])")
RE_VENDOR_TOTAL = re.compile(r"Vendor Total:\s+(?P<amt>\(?[\d,]+\.\d{2}\)?-?)")
RE_FUND_TOTAL = re.compile(r"Fund Total:\s+(?P<amt>[\d,]+\.\d{2}-?)")
RE_ACCT_TOTAL = re.compile(r"Checking Account Total:\s+(?P<amt>[\d,]+\.\d{2}-?)")
RE_PAGEHDR = re.compile(
    r"^(IOWA CITY COMMUNITY SCHOOL|Vendor Name\s+Invoice|Description\s+Account Number)"
)
RE_RUNSTAMP = re.compile(r"^(?P<date>\d{2}/\d{2}/\d{4}) \d{1,2}:\d{2} [AP]M\s+(?P<batch>.*?)\s+User ID")
RE_CHECKING = re.compile(r"^Checking\s+\d+\s*$")


def meeting_date_of(fname):
    return fname[:10]


def batch_date_from_desc(desc, print_date_iso):
    """Pull the true batch date out of the batch description, if plausible.

    Formats seen: 'AP 6/4/24', 'Print Checks 2-24-26', '20240730 Checks',
    'Checks 06242025', '260428'. Falls back to the report print date when the
    extracted date is implausible (e.g. the '20290729' typo) or absent.
    """
    pd = datetime.strptime(print_date_iso, "%Y-%m-%d")

    def ok(d):
        return d is not None and 2023 <= d.year <= 2027 and -2 <= (pd - d).days <= 30

    for tok in re.findall(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{6,8}", desc or ""):
        cands = []
        if re.fullmatch(r"\d{8}", tok):
            for fmt in ("%Y%m%d", "%m%d%Y"):
                try:
                    cands.append(datetime.strptime(tok, fmt))
                except ValueError:
                    pass
        elif re.fullmatch(r"\d{6}", tok):
            try:
                cands.append(datetime.strptime(tok, "%y%m%d"))
            except ValueError:
                pass
        else:
            t = tok.replace("-", "/")
            for fmt in ("%m/%d/%Y", "%m/%d/%y"):
                try:
                    cands.append(datetime.strptime(t, fmt))
                except ValueError:
                    pass
        for d in cands:
            if ok(d):
                return d.strftime("%Y-%m-%d")
    return print_date_iso


# ---------------------------------------------------------------- board reports

def parse_board_report(path):
    """Returns dict with batch info, line items, and embedded totals for validation."""
    fname = os.path.basename(path)
    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    batch_date = None
    batch_desc = None
    fund = None
    rows = []          # line items
    vendor = None      # current vendor name (may accumulate wraps)
    last_kind = None   # 'vendor' | 'detail' | other
    cur_invoice = cur_invdate = cur_po = None
    vendor_totals = []
    fund_totals = {}
    acct_totals = []
    rows_at_last_acct_total = -1
    page = 1

    for raw in lines:
        # pdftotext form feeds prefix the first line of each new page
        page += raw.count("\f")
        line = raw.replace("\f", "").rstrip()
        if not line.strip():
            if last_kind == "vendor":
                last_kind = None  # blank line ends vendor-name wrapping
            continue

        m = RE_RUNSTAMP.match(line)
        if m:
            if batch_date is None:
                batch_date = mdY_to_iso(m.group("date"))
                bd = m.group("batch")
                batch_desc = re.sub(r"^Unposted;\s*Batch Description\s*", "", bd).strip()
            last_kind = None
            continue
        if RE_PAGEHDR.match(line):
            last_kind = None
            continue

        m = RE_FUND.search(line)
        if m and ("Fund:" in line):
            fund = m.group("code")
            last_kind = None
            continue
        if RE_CHECKING.match(line):
            last_kind = None
            continue

        m = RE_VENDOR_TOTAL.search(line)
        if m:
            vendor_totals.append(parse_amount(m.group("amt")))
            last_kind = None
            continue
        m = RE_FUND_TOTAL.search(line)
        if m:
            fund_totals[fund] = fund_totals.get(fund, 0) + parse_amount(m.group("amt"))
            last_kind = None
            continue
        m = RE_ACCT_TOTAL.search(line)
        if m:
            # the total line repeats verbatim across page breaks — count once
            if len(rows) != rows_at_last_acct_total:
                acct_totals.append(parse_amount(m.group("amt")))
                rows_at_last_acct_total = len(rows)
            last_kind = None
            continue

        m = RE_DETAIL.match(line)
        if m:
            acct = m.group("acct")
            if acct.split()[0] in KNOWN_FUNDS or fund is None:
                rows.append({
                    "vendor": (vendor or "").strip(),
                    "invoice": cur_invoice,
                    "inv_date": cur_invdate,
                    "po": cur_po,
                    "desc": m.group("desc").strip(),
                    "acct": acct,
                    "fund": fund or acct.split()[0],
                    "amount": parse_amount(m.group("amt")),
                    "page": page,
                })
                last_kind = "detail"
                continue

        m = RE_VENDOR.match(line) or RE_VENDOR_TIGHT.match(line)
        if m:
            vendor = m.group("vendor").strip()
            cur_invoice = m.group("invoice")
            cur_invdate = mdY_to_iso(m.group("invdate"))
            cur_po = m.group("po")
            last_kind = "vendor"
            continue

        # otherwise: continuation/wrap line. Column-0 lines wrap the leftmost field
        # (vendor name / description); indented lines wrap the invoice number.
        text = line.strip()
        indented = line[:1].isspace()
        if last_kind == "vendor" and vendor is not None:
            if indented:
                joiner = "" if (cur_invoice or "").endswith("-") else " "
                cur_invoice = (cur_invoice or "") + joiner + text
            else:
                vendor = vendor + " " + text
        elif last_kind == "detail" and rows and not indented:
            rows[-1]["desc"] = (rows[-1]["desc"] + " " + text).strip()
        elif re.search(r"\(?[\d,]+\.\d{2}\)?-?\s*$", line):
            print(f"    UNCLASSIFIED AMOUNT LINE [{fname}]: {line.strip()[:100]}")
        # else stray noise — ignore

    return {
        "file": fname,
        "meeting": meeting_date_of(fname),
        "batch_date": batch_date_from_desc(batch_desc, batch_date),
        "print_date": batch_date,
        "batch_desc": batch_desc,
        "rows": rows,
        "vendor_totals_sum": round(sum(vendor_totals), 2),
        "fund_totals": {k: round(v, 2) for k, v in fund_totals.items()},
        "acct_totals_sum": round(sum(acct_totals), 2),
    }


# ---------------------------------------------------------------- BMO card txns

RE_BMO = re.compile(
    r"^\s*(?P<post>\d{1,2}/\d{1,2}/\d{4})\s+(?P<tran>\d{1,2}/\d{1,2}/\d{4})\s+"
    r"X{4}-X{4}-X{4}-(?P<card>\d{4})\s+(?P<rest>.*?)\s*(?P<neg>-\s*)?\$\s*(?P<amt>\(?-?[\d,]+\.\d{2}\)?)\s*$",
    re.IGNORECASE,
)


def parse_bmo(path):
    """Raw card statements. Some exports add a 'Narrative Details' column (staff
    purchase justifications) between Supplier and Amount — split on 2+ spaces."""
    fname = os.path.basename(path)
    has_narrative = False
    rows = []
    page = 1
    for raw in open(path, encoding="utf-8", errors="replace"):
        page += raw.count("\f")
        raw = raw.replace("\f", "")
        if "Narrative Details" in raw:
            has_narrative = True
            continue
        m = RE_BMO.match(raw.rstrip())
        if m:
            rest = m.group("rest").strip()
            supplier, desc = rest, ""
            if has_narrative:
                parts = re.split(r"\s{2,}", rest, maxsplit=1)
                if len(parts) == 2:
                    supplier, desc = parts[0], re.sub(r"\s{2,}", " ", parts[1])
            if supplier.lower().startswith("payment -"):
                continue  # the district paying its card bill — not spending
            amt = parse_amount(m.group("amt"))
            if m.group("neg"):
                amt = -abs(amt)
            rows.append({
                "post_date": mdY_to_iso(m.group("post")),
                "tran_date": mdY_to_iso(m.group("tran")),
                "card": m.group("card"),
                "supplier": supplier.strip(),
                "desc": desc.strip(),
                "amount": amt,
                "page": page,
            })
    return {"file": fname, "meeting": meeting_date_of(fname), "rows": rows,
            "narrative": has_narrative}


# ---------------------------------------------------------------- P-Card coded

RE_PCARD = re.compile(
    rf"^(?P<acct>{ACCT})\s+(?P<date>\d{{2}}/\d{{2}}/\d{{4}})\s+(?P<rest>.*?)\s+(?P<amt>-?[\d,]+\.\d{{2}})\s*$"
)


def parse_pcard(path):
    """Coded P-card lines: acct, tran date, supplier (fixed ~24 col), description, amount."""
    fname = os.path.basename(path)
    rows = []
    page = 1
    for raw in open(path, encoding="utf-8", errors="replace"):
        page += raw.count("\f")
        line = raw.replace("\f", "").rstrip()
        m = RE_PCARD.match(line)
        if not m:
            continue
        rest = m.group("rest")
        # supplier column is ~24 chars wide; split on 2+ spaces if present, else fixed cut
        parts = re.split(r"\s{2,}", rest, maxsplit=1)
        if len(parts) == 2:
            supplier, desc = parts
        else:
            supplier, desc = rest[:24].strip(), rest[24:].strip()
        rows.append({
            "acct": m.group("acct"),
            "tran_date": mdY_to_iso(m.group("date")),
            "supplier": supplier.strip(),
            "desc": desc.strip(),
            "amount": parse_amount(m.group("amt")),
            "page": page,
        })
    return {"file": fname, "meeting": meeting_date_of(fname), "rows": rows}


# ---------------------------------------------------------------- AP summaries

RE_SUMM_TOTAL = re.compile(r"Total Accounts Payable\s+\(\$?\s*(?P<amt>[\d,. -]+)\)")
RE_SUMM_BATCH = re.compile(
    r"Detailed Accounts? Payable:?\s+(?P<date>[A-Z][a-z]+ \d{1,2},\s*\d{4})\s+\(\$?\s*(?P<amt>[\d,. -]+)\)"
)


def parse_summary(path):
    """Official per-batch-date totals (summed across funds) + grand total."""
    txt = open(path, encoding="utf-8", errors="replace").read()
    per_batch = defaultdict(float)
    for m in RE_SUMM_BATCH.finditer(txt):
        d = datetime.strptime(m.group("date").replace(",", ", ").replace("  ", " "), "%B %d, %Y")
        amt = m.group("amt").replace(" ", "")
        per_batch[d.strftime("%Y-%m-%d")] += parse_amount(amt) if amt not in ("-", "") else 0.0
    mt = RE_SUMM_TOTAL.search(txt)
    total = parse_amount(mt.group("amt")) if mt else None
    return {k: round(v, 2) for k, v in per_batch.items()}, total


# ---------------------------------------------------------------- main

def classify(fname):
    f = fname.lower()
    if "bmo_statement" in f:
        return "skip"           # per-card statements duplicate the Transactions files
    if "bmo transactions" in f:
        return "bmo"
    if "p card" in f:
        return "pcard"
    if "boardreport" in f.replace(" ", "") and "ap board report" not in f:
        return "board"
    if "board report 10003" in f or re.search(r"board ?report ?10003", f):
        return "board"
    if "accounts_payable_summaries" in f or "accounts payable summaries" in f or "ap board report" in f:
        return "summary"
    if "detailcheckregister" in f or "checkregisterbycheckingaccount" in f:
        return "register"        # redundant with board reports; not loaded
    return "unknown"


def main():
    files = sorted(os.listdir(EXTRACTED))
    by_type = defaultdict(list)
    for f in files:
        if f.endswith(".txt"):
            by_type[classify(f)].append(f)

    print("File classification:")
    for k, v in sorted(by_type.items()):
        print(f"  {k:10s} {len(v)}")
    if by_type.get("unknown"):
        for f in by_type["unknown"]:
            print("  UNKNOWN:", f)

    # ---- board reports, deduped by content hash then by (batch_date, batch_desc, total)
    seen_hash, seen_batch = {}, {}
    batches = []
    for f in by_type["board"]:
        path = os.path.join(EXTRACTED, f)
        h = hashlib.md5(re.sub(rb"\s+", b" ", open(path, "rb").read())).hexdigest()
        if h in seen_hash:
            print(f"  DEDUPE (content): {f} == {seen_hash[h]}")
            continue
        seen_hash[h] = f
        b = parse_board_report(path)
        key = (b["batch_date"], b["batch_desc"], b["acct_totals_sum"])
        if key in seen_batch:
            print(f"  DEDUPE (batch):   {f} == {seen_batch[key]}")
            continue
        seen_batch[key] = f
        batches.append(b)

    # validation: parsed sum vs embedded checking-account totals
    print("\nBoard report validation (parsed line-item sum vs report's own totals):")
    bad = 0
    for b in batches:
        s = round(sum(r["amount"] for r in b["rows"]), 2)
        ref = b["acct_totals_sum"]
        if abs(s - ref) > 0.01:
            bad += 1
            print(f"  MISMATCH {b['file']}: parsed {s:,.2f} vs total {ref:,.2f} (diff {s-ref:,.2f})")
    n_rows = sum(len(b["rows"]) for b in batches)
    print(f"  {len(batches)} batches, {n_rows} line items, {bad} mismatching batches")

    # ---- BMO card files: dedupe identical statement periods, prefer the
    # narrative-bearing export when the same period was uploaded twice
    bmo_parsed = {}
    for f in by_type["bmo"]:
        b = parse_bmo(os.path.join(EXTRACTED, f))
        if not b["rows"]:
            print(f"  BMO EMPTY: {f}")
            continue
        key = (b["rows"][0]["post_date"], b["rows"][-1]["post_date"], len(b["rows"]),
               round(sum(r["amount"] for r in b["rows"]), 2))
        prev = bmo_parsed.get(key)
        if prev is not None:
            keep, drop = (b, prev) if (b["narrative"] and not prev["narrative"]) else (prev, b)
            print(f"  DEDUPE (bmo): {drop['file']} == {keep['file']}"
                  + (" [kept narrative version]" if keep["narrative"] else ""))
            bmo_parsed[key] = keep
        else:
            bmo_parsed[key] = b
    card_rows = []
    for b in bmo_parsed.values():
        for r in b["rows"]:
            r["meeting"] = b["meeting"]
            r["file"] = b["file"]
        card_rows.extend(b["rows"])

    # cross-file txn-level dedupe (overlapping statement exports)
    ded = {}
    for r in card_rows:
        k = (r["post_date"], r["tran_date"], r["card"], r["supplier"], r["amount"])
        ded.setdefault(k, []).append(r)
    # identical rows CAN legitimately repeat (e.g. 4x hotel rooms same night) within one
    # file; only collapse rows duplicated across different meetings' files
    final_card = []
    for k, rs in ded.items():
        meetings = {r["meeting"] for r in rs}
        if len(meetings) > 1:
            per = defaultdict(list)
            for r in rs:
                per[r["meeting"]].append(r)
            keep = per[min(per)]  # keep earliest meeting's copies
            final_card.extend(keep)
        else:
            final_card.extend(rs)
    print(f"\nCard: {len(card_rows)} raw rows -> {len(final_card)} after cross-meeting dedupe")

    # ---- P-card coded files: enrich matching BMO rows
    pcard_rows = []
    for f in by_type["pcard"]:
        p = parse_pcard(os.path.join(EXTRACTED, f))
        for r in p["rows"]:
            r["file"] = p["file"]
        pcard_rows.extend(p["rows"])
    print(f"P-card coded rows: {len(pcard_rows)}")

    # index card rows for enrichment: (tran_date, amount) then fuzzy supplier prefix
    idx = defaultdict(list)
    for r in final_card:
        idx[(r["tran_date"], round(r["amount"], 2))].append(r)
    # BMO statement coverage gap: the 030626-042626 file actually ends at 04/03/2026
    # postings and the next file starts 05/06; April 2026 exists only in the coded
    # P-card file. Unmatched coded rows after the gap start are added, not dropped.
    BMO_GAP_START = "2026-04-04"
    enriched = unmatched_dropped = gap_added = 0
    for p in pcard_rows:
        cands = [c for c in idx[(p["tran_date"], round(p["amount"], 2))] if "acct" not in c]
        # prefer supplier-prefix match
        best = None
        for c in cands:
            a, b2 = c["supplier"].lower()[:12], p["supplier"].lower()[:12]
            if a.startswith(b2[:8]) or b2.startswith(a[:8]):
                best = c
                break
        if best is None and cands:
            best = cands[0]
        if best is not None:
            best["acct"] = p["acct"]
            best["desc"] = p["desc"]
            enriched += 1
        elif p["tran_date"] >= BMO_GAP_START:
            final_card.append({
                "post_date": None, "tran_date": p["tran_date"], "card": None,
                "supplier": p["supplier"], "amount": p["amount"],
                "acct": p["acct"], "desc": p["desc"], "meeting": None,
                "file": p["file"], "page": p["page"],
            })
            gap_added += 1
        else:
            unmatched_dropped += 1
    print(f"P-card enrichment: {enriched} matched, {gap_added} added (BMO gap), "
          f"{unmatched_dropped} dropped as reconciliation noise")

    # ---- summaries for validation (batch-date level, robust to re-uploads)
    official = defaultdict(float)
    for f in by_type["summary"]:
        per_batch, _total = parse_summary(os.path.join(EXTRACTED, f))
        for d, amt in per_batch.items():
            # same batch may be restated in a duplicate summary upload: keep max
            official[d] = max(official[d], amt)

    print("\nBatch-level validation vs official AP summaries:")
    parsed_by_batch = defaultdict(float)
    for b in batches:
        parsed_by_batch[b["batch_date"]] += sum(r["amount"] for r in b["rows"])
    ok = off = missing = 0
    for d in sorted(official):
        if d in parsed_by_batch:
            diff = parsed_by_batch[d] - official[d]
            if abs(diff) > 1.0:
                off += 1
                print(f"  {d}: parsed {parsed_by_batch[d]:,.2f} vs official {official[d]:,.2f} (diff {diff:,.2f})")
            else:
                ok += 1
        else:
            missing += 1
            print(f"  {d}: in official summary ({official[d]:,.2f}) but no board report parsed")
    extra = [d for d in parsed_by_batch if d not in official]
    print(f"  {ok} batch dates match within $1, {off} differ, {missing} missing, "
          f"{len(extra)} parsed-but-not-in-summaries: {sorted(extra)}")

    # ---- mine location names from utility line descriptions ("ELEC - SE" etc.)
    loc_votes = defaultdict(lambda: defaultdict(int))
    for b in batches:
        for r in b["rows"]:
            parts = (r["acct"] or "").split()
            if len(parts) == 6:
                m = re.match(r"^(ELEC|GAS|WTR|WATER|SEWER)\s*[-–]\s*(.+)$", r["desc"], re.I)
                if m:
                    loc_votes[parts[1]][m.group(2).strip().upper()] += 1
    loc_names = {}
    for code, votes in loc_votes.items():
        name, n = max(votes.items(), key=lambda kv: kv[1])
        if n >= 3:
            loc_names[code] = name
    print(f"\nMined {len(loc_names)} location names from utility descriptions")

    # ---- emit (columnar: [src, date, vendor_idx, desc, acct, amount, invoice, po])
    os.makedirs(OUTDIR, exist_ok=True)

    def canon_merchant(name):
        """Group noisy card-merchant strings under a stable vendor name."""
        n = name.strip()
        rules = [
            (r"^(amazon|amzn)\b.*", "AMAZON"),
            (r"^(wal-?mart|wm supercenter)\b.*", "WALMART"),
            (r"^stapls\d*.*|^staples\b.*", "STAPLES"),
            (r"^sq \*?\s*", ""),       # Square processor prefix
            (r"^tst\*?\s*", ""),       # Toast processor prefix
            (r"^paypal \*?\s*", ""),
            (r"^pp\*\s*", ""),
            (r"^gjl \d+\s*", ""),
        ]
        for pat, rep in rules:
            m = re.match(pat, n, re.I)
            if m:
                if rep:
                    return rep
                n = n[m.end():].strip() or n
                break
        # strip store numbers / trailing order-ids: "Caseys #3955", "Hy-Vee Coralville 1080"
        n = re.sub(r"\s*#\s*\d+.*$", "", n)
        n = re.sub(r"\s+\d{3,}[A-Za-z0-9-]*$", "", n)
        return n.upper().strip() or name.upper()

    vendors, vidx = [], {}

    def vid(name):
        key = re.sub(r"\s+", " ", (name or "").strip())
        if key not in vidx:
            vidx[key] = len(vendors)
            vendors.append(key)
        return vidx[key]

    # source-document table: each row carries [doc index, pdf page] so the app
    # can deep-link to the exact page of the district's published PDF
    docs, didx = [], {}

    def did(txtname):
        pdf = txtname.replace(".txt", ".pdf")
        if pdf not in didx:
            didx[pdf] = len(docs)
            docs.append(pdf)
        return didx[pdf]

    rows = []
    for b in batches:
        d = did(b["file"])
        for r in b["rows"]:
            rows.append(["a", b["batch_date"], vid(r["vendor"]), r["desc"],
                         r["acct"], round(r["amount"], 2), r["invoice"], r["po"],
                         d, r["page"]])
    for r in final_card:
        rows.append(["c", r["tran_date"], vid(r["supplier"]), r.get("desc", "") or "",
                     r.get("acct") or "", round(r["amount"], 2), r.get("card") or "", "",
                     did(r["file"]), r["page"]])
    rows.sort(key=lambda x: x[1])

    pdfdir = os.path.join(os.path.dirname(__file__), "..", "ICCSD_AP_Documents")
    for pdf in docs:
        if not os.path.exists(os.path.join(pdfdir, pdf)):
            print(f"  WARNING: referenced source PDF missing: {pdf}")

    # Simbli (eboardsolutions) meeting ids, keyed by meeting date — the app links
    # each document to the board-meeting agenda it was published with
    meetings = {}
    with open(MANIFEST, newline="") as fh:
        for row in csv.DictReader(fh):
            meetings[row["meeting_date"]] = int(row["meeting_id"])
    no_meeting = sorted({d[:10] for d in docs} - set(meetings))
    if no_meeting:
        print(f"  WARNING: docs with no meeting id in manifest: {no_meeting}")

    groups = [canon_merchant(v) for v in vendors]
    data = {"fields": ["src", "date", "vendor", "desc", "acct", "amount", "ref", "po", "doc", "page"],
            "vendors": vendors, "groups": groups, "docs": docs, "meetings": meetings, "rows": rows}
    with open(os.path.join(OUTDIR, "transactions.json"), "w") as fh:
        json.dump(data, fh, separators=(",", ":"), ensure_ascii=False)
    sz = os.path.getsize(os.path.join(OUTDIR, "transactions.json"))
    print(f"Wrote {len(rows)} transactions, {len(vendors)} vendors ({sz/1e6:.1f} MB)")

    ap_dates = [r[1] for r in rows if r[0] == "a"]
    card_dates = [r[1] for r in rows if r[0] == "c"]
    meta = {
        "generated": datetime.now().strftime("%Y-%m-%d"),
        "n_ap": len(ap_dates), "n_card": len(card_dates),
        "ap_range": [min(ap_dates), max(ap_dates)],
        "card_range": [min(card_dates), max(card_dates)],
        "meetings": len({b["meeting"] for b in batches}),
        "batches": len(batches),
        "funds": KNOWN_FUNDS,
        "locations": loc_names,
    }
    with open(os.path.join(OUTDIR, "meta.json"), "w") as fh:
        json.dump(meta, fh, indent=1, ensure_ascii=False)

    # ---- validation report for the app's data-quality page
    val = {"batches": [], "official_vs_parsed": []}
    for b in sorted(batches, key=lambda x: x["batch_date"]):
        s = round(sum(r["amount"] for r in b["rows"]), 2)
        val["batches"].append({
            "batch_date": b["batch_date"], "meeting": b["meeting"],
            "file": b["file"].replace(".txt", ".pdf"),
            "parsed_total": s, "report_total": b["acct_totals_sum"],
            "internal_match": abs(s - b["acct_totals_sum"]) <= 0.01,
            "n_items": len(b["rows"]),
        })
    for d in sorted(set(official) | set(parsed_by_batch)):
        val["official_vs_parsed"].append({
            "batch_date": d,
            "official": round(official.get(d, 0), 2) if d in official else None,
            "parsed": round(parsed_by_batch.get(d, 0), 2) if d in parsed_by_batch else None,
        })
    with open(os.path.join(OUTDIR, "validation.json"), "w") as fh:
        json.dump(val, fh, separators=(",", ":"))
    print(json.dumps({k: v for k, v in meta.items() if k != "locations"}, indent=1))
    print("locations:", json.dumps(loc_names))


if __name__ == "__main__":
    main()
