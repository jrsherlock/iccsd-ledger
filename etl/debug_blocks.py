#!/usr/bin/env python3
"""Find vendor blocks where parsed detail lines don't sum to the Vendor Total."""
import re
import sys

sys.path.insert(0, "etl")
from parse_iccsd import (RE_DETAIL, RE_VENDOR, RE_FUND, RE_VENDOR_TOTAL, RE_FUND_TOTAL,
                         RE_ACCT_TOTAL, RE_PAGEHDR, RE_RUNSTAMP, RE_CHECKING, parse_amount)

path = sys.argv[1]
lines = open(path, encoding="utf-8", errors="replace").read().split("\n")

block_lines = []
block_sum = 0.0
shown = 0

for raw in lines:
    line = raw.rstrip()
    if not line.strip():
        continue
    if RE_RUNSTAMP.match(line) or RE_PAGEHDR.match(line) or RE_CHECKING.match(line):
        continue
    if RE_FUND.search(line) and "Fund:" in line:
        continue
    m = RE_VENDOR_TOTAL.search(line)
    if m:
        vt = parse_amount(m.group("amt"))
        if abs(vt - block_sum) > 0.005 and shown < 25:
            shown += 1
            print(f"--- block sum {block_sum:,.2f} != vendor total {vt:,.2f} ---")
            for bl in block_lines:
                tag = "D" if RE_DETAIL.match(bl) else ("V" if RE_VENDOR.match(bl) else "?")
                print(f"  [{tag}] {bl}")
        block_lines = []
        block_sum = 0.0
        continue
    if RE_FUND_TOTAL.search(line) or RE_ACCT_TOTAL.search(line):
        continue
    md = RE_DETAIL.match(line)
    if md:
        block_sum += parse_amount(md.group("amt"))
        block_lines.append(line)
        continue
    block_lines.append(line)
