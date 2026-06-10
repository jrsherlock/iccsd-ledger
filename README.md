# The ICCSD Ledger

A public-facing explorer for two years of Iowa City Community School District
accounts-payable and purchasing-card spending, rebuilt from 280 PDF documents
published with school-board agendas (June 2024 – June 2026 meetings).

## Run it

```bash
python3 -m http.server 8431 --directory site
# open http://localhost:8431
```

The site is fully static (no build step, no dependencies) — `site/` can be
deployed to any static host as-is.

## Rebuild the data

```bash
# 1. extract text from the source PDFs (requires poppler's pdftotext)
for f in ICCSD_AP_Documents/*.pdf; do
  pdftotext -layout "$f" "extracted/$(basename "${f%.pdf}").txt"
done

# 2. parse, validate, and emit site/data/*.json
python3 etl/parse_iccsd.py
```

## What the pipeline understands

| Document | Role |
|---|---|
| `BoardReport10003` (102 files) | Canonical AP source: vendor → invoice → line items with full Iowa account codes. Present at all 41 meetings. |
| `DetailCheckRegister` / `CheckRegisterbyCheckingAccount` | Check-level views, year 1 only. Redundant with board reports; not loaded. |
| `BMO Transactions` (monthly) | Raw purchasing-card statements, Jul 2023 – Jun 2026. Card-bill payment rows (`Payment - Automatic Pymt`) are excluded. |
| `* P Card` (coded) | Card transactions with account codes + purchase descriptions (spring 2026). Used to enrich matching raw rows and to fill the missing April 2026 statement. |
| `Accounts_Payable_Summaries` | Hand-made fund totals shown to the board. Used only for cross-validation. |

Parsing quirks handled: parenthesized credits, trailing-minus negatives,
multi-token wrapped invoice numbers, single-space vendor/invoice column
collisions, page-break reprint artifacts, 4–6 segment account codes
(expense / balance-sheet / revenue shapes), duplicate uploads across meetings,
and six different batch-date formats in batch descriptions.

**Validation:** all 102 parsed check batches sum to the penny against the
totals printed on the district's own reports. Batch-level comparison against
the official summary sheets is written to `site/data/validation.json` and
shown on the site's "About the Data" page (the summary sheets themselves
contain occasional clerical errors).

Known gaps (documented in-app): four check runs listed on summaries but never
uploaded (~$6.8M, mostly 2024-10-22); the January 2026 card statement; payroll
is out of scope entirely (it never flows through AP packets).

## Layout

```
ICCSD_AP_Documents/   source PDFs (+ manifest CSV)
extracted/            pdftotext -layout output
etl/parse_iccsd.py    parser / validator / emitter
etl/debug_blocks.py   vendor-block reconciliation debugger
site/                 the app (index.html, css/, js/, data/)
```
