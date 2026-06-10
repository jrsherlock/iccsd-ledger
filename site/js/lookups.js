/* Iowa Uniform Financial Accounting decoders + ICCSD-specific lookups */

const FUNDS = {
  "10": { name: "General Operating", color: "#234a77" },
  "21": { name: "Student Activity", color: "#e09f1f" },
  "22": { name: "Management Levy", color: "#7a5ba6" },
  "31": { name: "Capital — GO Bond", color: "#8c6d46" },
  "33": { name: "Capital — SAVE Sales Tax", color: "#b23a2a" },
  "36": { name: "Phys. Plant & Equipment", color: "#2e6b4f" },
  "40": { name: "Debt Service", color: "#5b6770" },
  "61": { name: "School Nutrition", color: "#2f7f8a" },
  "71": { name: "Health Self-Insurance", color: "#a05c7b" },
  "74": { name: "Dental Self-Insurance", color: "#c98a9a" },
  "82": { name: "School Children's Aid", color: "#6d8f3c" },
  "84": { name: "School-Based Clinics", color: "#4a7fa5" },
};
const FUND_UNCODED = { name: "Card — not yet coded", color: "#9aa8b5" };

/* Location codes mined from the district's own utility line items, mapped to
   full school names (ICCSD's buildings are public knowledge). 9xxx/8xxx codes
   are program codes, not buildings. */
const LOCATIONS = {
  "0000": "District-wide",
  "0020": "Educational Services Center",
  "0025": "Special Education programs",
  "0050": "District Warehouse",
  "0080": "Center for Innovation",
  "0109": "City High School",
  "0114": "Liberty High School",
  "0118": "West High School",
  "0136": "Tate High School",
  "0209": "North Central Junior High",
  "0213": "Northwest Junior High",
  "0218": "South East Junior High",
  "0401": "Garner Elementary",
  "0403": "Coralville Central Elementary",
  "0406": "Kirkwood Elementary",
  "0411": "Hills Elementary",
  "0415": "Horn Elementary",
  "0417": "Lemme Elementary",
  "0418": "Lincoln Elementary",
  "0427": "Longfellow Elementary",
  "0432": "Borlaug Elementary",
  "0436": "Lucas Elementary",
  "0442": "Alexander Elementary",
  "0445": "Mann Elementary",
  "0447": "Penn Elementary",
  "0463": "Hoover Elementary",
  "0468": "Shimek Elementary",
  "0472": "Twain Elementary",
  "0475": "Grant Elementary",
  "0481": "Grant Wood Elementary",
  "0488": "Weber Elementary",
  "0493": "Wickham Elementary",
  "0497": "Van Allen Elementary",
};
const SCHOOL_KINDS = {
  "0109": "high", "0114": "high", "0118": "high", "0136": "high",
  "0209": "junior", "0213": "junior", "0218": "junior",
};

function locName(code) {
  if (!code) return "";
  if (LOCATIONS[code]) return LOCATIONS[code];
  if (/^9/.test(code) || /^8/.test(code)) return "Program " + code;
  return "Location " + code;
}

/* Function code (what activity) — family level, Iowa UFA standard */
function funcFamily(f) {
  if (!f) return "Other / uncoded";
  const n = parseInt(f, 10);
  if (n >= 1100 && n < 1200) return "Regular instruction";
  if (n >= 1200 && n < 1300) return "Special education";
  if (n >= 1300 && n < 1400) return "Career & technical ed";
  if (n >= 1400 && n < 1900) return "Other instruction";
  if (n >= 1900 && n < 2000) return "Student activities";
  if (n >= 2100 && n < 2200) return "Student support (health, counseling)";
  if (n >= 2200 && n < 2300) return "Instructional support (library, curriculum)";
  if (n >= 2300 && n < 2400) return "General administration";
  if (n >= 2400 && n < 2500) return "School administration";
  if (n >= 2500 && n < 2600) return "Business & central services";
  if (n >= 2600 && n < 2700) return "Operations & maintenance";
  if (n >= 2700 && n < 2800) return "Student transportation";
  if (n >= 2800 && n < 3100) return "Other support services";
  if (n >= 3100 && n < 3300) return "Food service";
  if (n >= 3300 && n < 4000) return "Community services";
  if (n >= 4000 && n < 5000) return "Facilities & construction";
  if (n >= 5000 && n < 6000) return "Debt service";
  if (n >= 6000 && n < 7000) return "AEA flowthrough & transfers";
  return "Other / uncoded";
}
const FUNC_COLORS = {
  "Regular instruction": "#234a77",
  "Special education": "#4a7fa5",
  "Career & technical ed": "#2f7f8a",
  "Other instruction": "#6d8fb5",
  "Student activities": "#e09f1f",
  "Student support (health, counseling)": "#a05c7b",
  "Instructional support (library, curriculum)": "#7a5ba6",
  "General administration": "#5b6770",
  "School administration": "#8294a8",
  "Business & central services": "#8c6d46",
  "Operations & maintenance": "#2e6b4f",
  "Student transportation": "#6d8f3c",
  "Other support services": "#9aa8b5",
  "Food service": "#c2703f",
  "Community services": "#c98a9a",
  "Facilities & construction": "#b23a2a",
  "Debt service": "#44556b",
  "AEA flowthrough & transfers": "#746f64",
  "Other / uncoded": "#b5ad9c",
};

/* Object code (what was bought) — family level */
function objFamily(o) {
  if (!o) return "Other / uncoded";
  const d = o[0];
  return {
    "1": "Salaries (AP-paid)",
    "2": "Benefits & claims",
    "3": "Professional services",
    "4": "Property services & construction",
    "5": "Other purchased services (travel, insurance, tuition)",
    "6": "Supplies, books & energy",
    "7": "Equipment & capital",
    "8": "Dues, fees & interest",
    "9": "Transfers & flowthrough",
  }[d] || "Other / uncoded";
}

/* Parse an account code string into its dimensions (6-part expense codes). */
function parseAcct(acct) {
  if (!acct) return null;
  const p = acct.split(" ");
  if (p.length === 6) return { fund: p[0], loc: p[1], func: p[2], prog: p[3], proj: p[4], obj: p[5] };
  if (p.length >= 1 && FUNDS[p[0]]) return { fund: p[0], loc: null, func: null, prog: null, proj: null, obj: null };
  return null;
}

/* Fiscal year: Iowa school FY runs July 1 – June 30, named for ending year */
function fyOf(dateStr) {
  const y = +dateStr.slice(0, 4), m = +dateStr.slice(5, 7);
  return m >= 7 ? y + 1 : y;
}

const fmtUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtUSDc = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat("en-US");

function money(v, cents) {
  const f = cents ? fmtUSDc : fmtUSD;
  if (v < 0) return `<span class="neg">(${f.format(-v)})</span>`;
  return f.format(v);
}
function moneyShort(v) {
  const a = Math.abs(v);
  let s;
  if (a >= 1e6) s = "$" + (a / 1e6).toFixed(a >= 10e6 ? 0 : 1) + "M";
  else if (a >= 1e3) s = "$" + (a / 1e3).toFixed(0) + "K";
  else s = "$" + a.toFixed(0);
  return v < 0 ? "(" + s + ")" : s;
}
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtMonth(ym) { return MONTH_NAMES[+ym.slice(5, 7) - 1] + " ’" + ym.slice(2, 4); }
function fmtDate(d) { return d ? d.slice(5).replace("-", "/") + "/" + d.slice(2, 4) : ""; }
function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function titleCase(s) {
  return (s || "").toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase())
    .replace(/\b(Llc|Inc|Pc|Po|Hs|Ms|Jh|Aea|Iccsd|Dvm|Cpa|Usa|It|Tv|Bmo)\b/g, t => t.toUpperCase());
}
