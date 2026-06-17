import { Copy, Globe2, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type IpVersion = "ipv4" | "ipv6";

type NormalizedIpInfo = {
  ip?: string;
  version?: IpVersion;
  country?: string;
  region?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  asn?: string;
  asName?: string;
  org?: string;
};

type CloudflareIpApi = {
  ip?: unknown;
  country?: unknown;
  city?: unknown;
  region?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  timezone?: unknown;
  asn?: unknown;
  asOrganization?: unknown;
  httpProtocol?: unknown;
  colo?: unknown;
};

const EMPTY_TEXT = "未获取";
const IP_API_URL = "https://cf-ip.uip.moe/ipapi";
const TRACE_URL = "https://cf-ip.uip.moe/cdn-cgi/trace";
const FLAG_BASE = "https://flagcdn.com";

const COUNTRY_CODE_NAMES: Record<string, string> = {
  CN: "中国",
  HK: "香港",
  MO: "澳门",
  TW: "台湾",
  JP: "日本",
  SG: "Singapore",
  US: "United States",
  KR: "韩国",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  AU: "Australia",
  CA: "Canada",
  IN: "India",
  RU: "Russia",
  NL: "Netherlands",
};

let regionDisplayNames: Intl.DisplayNames | undefined;
try {
  regionDisplayNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });
} catch {
  regionDisplayNames = undefined;
}

function cleanText(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  if (!text || text === "undefined" || text === "null" || text === "-") return undefined;
  return text;
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cleanText(value);
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatValue(value: unknown, fallback = EMPTY_TEXT) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function countryDisplayName(code?: string) {
  const text = typeof code === "string" ? code.trim() : "";
  if (!text) return undefined;
  if (/^[a-z]{2}$/i.test(text)) {
    const upper = text.toUpperCase();
    if (COUNTRY_CODE_NAMES[upper]) return COUNTRY_CODE_NAMES[upper];
    try {
      const display = regionDisplayNames?.of(upper);
      if (display && display !== upper) return display;
    } catch {
      return upper;
    }
    return upper;
  }
  return text;
}

function dedupe(parts: string[]) {
  const result: string[] = [];
  for (const part of parts) {
    const duplicate = result.find((existing) => {
      const left = existing.toLowerCase();
      const right = part.toLowerCase();
      return left === right || left.includes(right) || right.includes(left);
    });
    if (!duplicate) result.push(part);
  }
  return result;
}

function formatLocation(info?: NormalizedIpInfo) {
  const country = countryDisplayName(info?.country) ?? info?.country;
  const parts = dedupe([country, info?.region, info?.city].filter((item): item is string => Boolean(item)));
  return parts.join(" ") || EMPTY_TEXT;
}

function formatProvider(info?: NormalizedIpInfo) {
  return formatValue(info?.org);
}

function formatAsn(info?: NormalizedIpInfo) {
  const asn = formatValue(info?.asn);
  const asName = formatValue(info?.asName, "");
  if (asn === EMPTY_TEXT) return asn;
  return asName ? `${asn} ${asName}` : asn;
}

function normalizeCloudflare(raw: CloudflareIpApi): NormalizedIpInfo {
  const ip = cleanText(raw.ip);
  const asn = cleanText(raw.asn);
  const org = cleanText(raw.asOrganization);
  return {
    ip,
    version: ip ? (ip.includes(":") ? "ipv6" : "ipv4") : undefined,
    country: cleanText(raw.country),
    region: cleanText(raw.region),
    city: cleanText(raw.city),
    latitude: numeric(raw.latitude),
    longitude: numeric(raw.longitude),
    timezone: cleanText(raw.timezone),
    asn: asn ? `AS${asn.replace(/^AS/i, "")}` : undefined,
    asName: org,
    org,
  };
}

function normalizeTrace(text: string): NormalizedIpInfo {
  const entries = new Map(
    text
      .split(/\r?\n/)
      .map((line) => line.split("="))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );
  const ip = cleanText(entries.get("ip"));
  return {
    ip,
    version: ip ? (ip.includes(":") ? "ipv6" : "ipv4") : undefined,
    country: cleanText(entries.get("loc")),
  };
}

async function fetchWithTimeout(url: string, timeoutMs = 3200) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json,text/plain;q=0.8,*/*;q=0.5" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    window.clearTimeout(timer);
  }
}

async function loadIpInfo() {
  try {
    const response = await fetchWithTimeout(IP_API_URL);
    const raw = (await response.json()) as CloudflareIpApi;
    const normalized = normalizeCloudflare(raw);
    if (!normalized.ip) throw new Error("未解析到 IP");
    return {
      info: normalized,
    };
  } catch {
    const response = await fetchWithTimeout(TRACE_URL);
    const text = await response.text();
    const normalized = normalizeTrace(text);
    if (!normalized.ip) throw new Error("未解析到 IP");
    return { info: normalized };
  }
}

function FlagIcon({ code, label, className = "" }: { code?: string; label?: string; className?: string }) {
  const flagCode = /^[a-z]{2}$/i.test(code ?? "") ? code!.toLowerCase() : undefined;
  const [failed, setFailed] = useState(false);

  if (!flagCode || failed) {
    return (
      <span
        aria-label={label ?? "Global"}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground ${className}`}
        role="img"
      >
        <Globe2 className="size-[58%]" />
      </span>
    );
  }

  return (
    <span className={`inline-flex shrink-0 overflow-hidden rounded-full border border-border bg-muted ${className}`}>
      <img
        alt={label ?? flagCode.toUpperCase()}
        className="size-full object-cover"
        onError={() => setFailed(true)}
        src={`${FLAG_BASE}/${flagCode}.svg`}
      />
    </span>
  );
}

function Shimmer({ className = "" }: { className?: string }) {
  return <span className={`block overflow-hidden rounded-md bg-shimmer ${className}`} />;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "teal" }) {
  const toneClass =
    tone === "teal"
      ? "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300"
      : "border-border bg-background text-muted-foreground";
  return <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-0 text-xs font-medium ${toneClass}`}>{children}</span>;
}

function IconButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function MainIpCard({
  info,
  loading,
  error,
  onRefresh,
  refreshing,
}: {
  info?: NormalizedIpInfo;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const countryName = countryDisplayName(info?.country) ?? "Global";
  const title = info?.version === "ipv6" ? "IPv6" : "IPv4";

  async function copyIp() {
    if (!info?.ip) return;
    await navigator.clipboard.writeText(info.ip);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <section className="dashboard-card overflow-hidden p-0">
      <div className="relative min-h-[204px] overflow-hidden border-border p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold text-muted-foreground">Unipinfo</p>
            </div>

            <div className="mt-2 flex min-w-0 items-center gap-2">
              {loading ? (
                <Shimmer className="h-8 w-[220px] max-w-[62vw]" />
              ) : (
                <p className="min-w-0 break-all font-mono text-2xl font-semibold leading-tight tracking-normal mono-tabular sm:text-3xl">
                  {formatValue(info?.ip)}
                </p>
              )}
              <IconButton disabled={!info?.ip || loading} label={copied ? "已复制" : `复制 ${title}`} onClick={copyIp}>
                <Copy className="size-4" />
              </IconButton>
              <IconButton disabled={refreshing} label="刷新" onClick={onRefresh}>
                <RefreshCcw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
              </IconButton>
            </div>
          </div>

          {loading ? (
            <Shimmer className="mt-1 size-8 rounded-full" />
          ) : (
            <FlagIcon code={info?.country} className="mt-1 size-8" label={countryName} />
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Location</p>
            {loading ? <Shimmer className="mt-1 h-3.5 w-4/5" /> : <p className="mt-0.5 break-words text-sm font-semibold">{formatLocation(info)}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">ISP</p>
            {loading ? <Shimmer className="mt-1 h-3.5 w-11/12" /> : <p className="mt-0.5 break-words text-sm font-semibold">{formatProvider(info)}</p>}
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">ASN</p>
            {loading ? <Shimmer className="mt-1 h-3.5 w-2/3" /> : <p className="mt-0.5 break-words font-mono text-sm font-semibold mono-tabular">{formatAsn(info)}</p>}
          </div>
        </div>

        {error ? <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-950 dark:bg-red-950/50 dark:text-red-300">{error}</p> : null}
      </div>
    </section>
  );
}

export default function App() {
  const [info, setInfo] = useState<NormalizedIpInfo | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await loadIpInfo();
      setInfo(result.info);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "请求失败");
      setInfo(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <MainIpCard error={error} info={info} loading={loading} onRefresh={refresh} refreshing={loading} />;
}
