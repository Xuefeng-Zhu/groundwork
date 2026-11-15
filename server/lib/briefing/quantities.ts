/** Exact, lexical quantity matching for common forms in English-language sources. */

const SCALES: Record<string, number> = {
  k: 3, thousand: 3, m: 6, mn: 6, million: 6,
  b: 9, bn: 9, billion: 9, t: 12, tn: 12, trillion: 12,
};

const CURRENCIES: Record<string, string> = {
  "$": "dollar", "dollar": "dollar", "dollars": "dollar",
  "usd": "usd", "us$": "usd", "us dollar": "usd", "us dollars": "usd",
  "cad": "cad", "c$": "cad", "ca$": "cad", "canadian dollar": "cad", "canadian dollars": "cad",
  "aud": "aud", "a$": "aud", "au$": "aud", "australian dollar": "aud", "australian dollars": "aud",
  "nzd": "nzd", "nz$": "nzd", "hkd": "hkd", "hk$": "hkd", "sgd": "sgd", "s$": "sgd",
  "eur": "eur", "€": "eur", "euro": "eur", "euros": "eur",
  "gbp": "gbp", "£": "gbp", "pound sterling": "gbp", "pounds sterling": "gbp",
  "jpy": "jpy", "yen": "jpy", "cny": "cny", "rmb": "cny", "yuan": "cny",
  "¥": "yen-or-yuan", "inr": "inr", "₹": "inr", "krw": "krw", "₩": "krw",
  "chf": "chf", "brl": "brl", "r$": "brl", "mxn": "mxn", "mx$": "mxn", "sek": "sek", "nok": "nok", "dkk": "dkk",
  "pln": "pln", "zar": "zar", "aed": "aed", "sar": "sar", "twd": "twd", "ils": "ils",
};

const currencyPattern = Object.keys(CURRENCIES)
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/\$/g, "\\$").replace(/ /g, "\\s+"))
  .join("|");

const token = new RegExp([
  String.raw`(?:(?<sign>(?<![\p{L}\p{N}])[+\-−])\s*)?`,
  String.raw`(?:(?<prefix>(?<![\p{L}\p{N}])(?:${currencyPattern}))\s*(?:(?<innerSign>[+\-−])\s*)?)?`,
  String.raw`(?<value>(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)`,
  String.raw`(?:\s*(?<scale>thousand|million|billion|trillion|mn|bn|tn|[kmbt])(?![\p{L}\p{N}]))?`,
  String.raw`(?:\s*(?<percent>%|(?:percentage\s+points?|percent|per\s+cent|pct)(?![\p{L}\p{N}])))?`,
  String.raw`(?:\s*(?<suffix>${currencyPattern})(?![\p{L}\p{N}]))?`,
].join(""), "giu");

export interface Quantity {
  text: string;
  key: string | null;
  /** Explicit unit, magnitude or sign that each corroborating citation must support. */
  qualified: boolean;
}

function currency(value: string | undefined): string | undefined {
  return value ? CURRENCIES[value.toLowerCase().replace(/\s+/g, " ")] : undefined;
}

const QUALIFIED_DOLLARS = new Set(["usd", "cad", "aud", "nzd", "hkd", "sgd", "mxn"]);

/** Unqualified currency symbols only become specific when the text qualifies them. */
function resolveCurrency(before: string | undefined, after: string | undefined): string | null | undefined {
  if (!before || !after || before === after) return after ?? before;
  const ambiguous = before === "dollar" || before === "yen-or-yuan" ? before : after;
  const specific = ambiguous === before ? after : before;
  if (ambiguous === "dollar" && QUALIFIED_DOLLARS.has(specific)) return specific;
  if (ambiguous === "yen-or-yuan" && (specific === "jpy" || specific === "cny")) return specific;
  return null;
}

/** Canonical decimal as significant digits × 10^power, without floating point. */
function decimalKey(value: string, scale: number, negative: boolean): string {
  const [whole = "", fraction = ""] = value.replace(/,/g, "").split(".");
  const digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return "0";
  const significant = digits.replace(/0+$/, "");
  const power = scale - fraction.length + digits.length - significant.length;
  return `${negative ? "-" : ""}${significant}e${power}`;
}

export function extractQuantities(text: string): Quantity[] {
  return [...text.matchAll(token)].map((match) => {
    const { sign, innerSign, prefix, suffix, value, scale, percent } = match.groups!;
    const denomination = resolveCurrency(currency(prefix), currency(suffix));
    const unit = percent
      ? (/^percentage/i.test(percent) ? "percentage-point" : "percent")
      : denomination ?? "number";
    // A spaced dash between numerals serves as a separator (as in a range).
    const rangeDash = sign && sign !== "+" && /\d\s*$/.test(text.slice(0, match.index));
    const effectiveSign = innerSign ?? (rangeDash ? undefined : sign);
    const negative = effectiveSign === "-" || effectiveSign === "−";
    const qualified = Boolean(prefix || suffix || percent || scale || effectiveSign);
    const key = denomination !== null && !(denomination && percent) && !(sign && innerSign)
      ? `${decimalKey(value!, scale ? SCALES[scale.toLowerCase()]! : 0, negative)}:${unit}`
      : null;
    return { text: match[0], key, qualified };
  });
}
