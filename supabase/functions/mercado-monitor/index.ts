// Robô da aba "Mercado Financeiro".
//   ?mode=check  -> atualiza cotações, notícias e dispara alertas de queda
//   ?mode=report -> igual ao check + gera o relatório diário
// Deploy:  supabase functions deploy mercado-monitor --no-verify-jwt
// Secret:  supabase secrets set CRON_SECRET=<senha>
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const UA = "Mozilla/5.0 (compatible; CarteiraBot/1.0)";

type Quote = { ticker: string; price: number; prevClose: number; changePct: number; time: string };
type News = { title: string; link: string; source: string; published: string; ticker: string | null };
type Alert = { id: string; ticker: string; changePct: number; price: number; date: string; time: string; msg: string };

const INDICES = [
  { label: "Ibovespa", sym: "^BVSP" },
  { label: "Dólar", sym: "USDBRL=X" },
  { label: "S&P 500", sym: "^GSPC" },
  { label: "Nasdaq", sym: "^IXIC" },
];

const brtDate = (d = new Date()) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const brtTime = (d = new Date()) =>
  d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

// PETR4 -> PETR4.SA ; AAPL, BTC-USD, ^BVSP ficam como estão
function yahooSym(t: string): string {
  const s = t.trim().toUpperCase();
  return /\d$/.test(s) && !s.includes(".") ? `${s}.SA` : s;
}

async function fetchQuote(sym: string): Promise<{ price: number; prev: number; time: number } | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`,
      { headers: { "User-Agent": UA } },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const price: number = res.meta?.regularMarketPrice;
    const closes: number[] = (res.indicators?.quote?.[0]?.close ?? []).filter((x: number | null) => x != null);
    // última barra = hoje (parcial ou fechada); a anterior é o fechamento de ontem
    const prev = closes.length >= 2 ? closes[closes.length - 2] : res.meta?.chartPreviousClose;
    if (!price || !prev) return null;
    return { price, prev, time: res.meta?.regularMarketTime ?? 0 };
  } catch (_) {
    return null;
  }
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, "").trim();

async function fetchRss(url: string, ticker: string | null, max: number, defaultSource = ""): Promise<News[]> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, max);
    return items.map((m) => {
      const b = m[1];
      const g = (tag: string) => decode(b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
      let title = g("title");
      let source = g("source") || defaultSource;
      // Google News: "Título - Fonte"
      if (!g("source") && / - [^-]+$/.test(title) && url.includes("news.google")) {
        source = title.split(" - ").pop()!;
        title = title.slice(0, title.length - source.length - 3);
      }
      const pub = new Date(g("pubDate"));
      return { title, link: g("link"), source, published: isNaN(+pub) ? "" : pub.toISOString(), ticker };
    }).filter((n) => n.title && n.link);
  } catch (_) {
    return [];
  }
}

const gnews = (q: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

async function buildNews(tickers: string[]): Promise<News[]> {
  const jobs = [
    fetchRss(gnews("Ibovespa mercado financeiro"), null, 8),
    fetchRss("https://www.infomoney.com.br/mercados/feed/", null, 6, "InfoMoney"),
    ...tickers.map((t) => fetchRss(gnews(`${t} ações`), t, 4)),
  ];
  const all = (await Promise.all(jobs)).flat();
  const seen = new Set<string>();
  return all
    .filter((n) => { const k = n.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .slice(0, 40);
}

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2).replace(".", ",")}%`;

function buildReport(date: string, quotes: Quote[], indices: any[], alerts: Alert[], news: News[]) {
  const sorted = [...quotes].sort((a, b) => a.changePct - b.changePct);
  const lines: string[] = [];
  const ib = indices.find((i) => i.label === "Ibovespa");
  const usd = indices.find((i) => i.label === "Dólar");
  const sp = indices.find((i) => i.label === "S&P 500");
  const parts = [ib && `Ibovespa ${pct(ib.changePct)}`, usd && `dólar ${pct(usd.changePct)}`, sp && `S&P 500 ${pct(sp.changePct)}`]
    .filter(Boolean);
  if (parts.length) lines.push(`Mercado: ${parts.join(", ")}.`);
  if (sorted.length) {
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    lines.push(`Sua lista: maior queda ${lo.ticker} (${pct(lo.changePct)}); maior alta ${hi.ticker} (${pct(hi.changePct)}).`);
    const up = quotes.filter((q) => q.changePct > 0).length;
    lines.push(`${up} de ${quotes.length} ações fecharam em alta.`);
  }
  const today = alerts.filter((a) => a.date === date);
  lines.push(today.length
    ? `Alertas de queda hoje: ${today.map((a) => `${a.ticker} ${pct(a.changePct)}`).join(", ")}.`
    : "Nenhum alerta de queda hoje.");
  return {
    date,
    generatedAt: new Date().toISOString(),
    summary: lines,
    movers: sorted.map((q) => ({ ticker: q.ticker, changePct: q.changePct, price: q.price })),
    headlines: news.slice(0, 6).map((n) => ({ title: n.title, link: n.link, source: n.source })),
  };
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const mode = new URL(req.url).searchParams.get("mode") === "report" ? "report" : "check";
  const sb = createClient(SB_URL, SB_KEY);
  const { data: rows, error } = await sb.from("mercado").select("user_id,config,snapshot");
  if (error) return new Response(error.message, { status: 500 });

  const cache = new Map<string, Awaited<ReturnType<typeof fetchQuote>>>();
  const quoteOf = async (sym: string) => {
    if (!cache.has(sym)) cache.set(sym, await fetchQuote(sym));
    return cache.get(sym)!;
  };
  const indices = (await Promise.all(INDICES.map(async (i) => {
    const q = await quoteOf(i.sym);
    return q ? { label: i.label, price: q.price, changePct: (q.price / q.prev - 1) * 100 } : null;
  }))).filter(Boolean) as any[];

  const date = brtDate();
  let processed = 0;
  for (const row of rows ?? []) {
    const tickers: string[] = (row.config?.tickers ?? []).map((t: string) => t.trim().toUpperCase()).filter(Boolean);
    const limite = Math.abs(Number(row.config?.limite ?? 3.5)) || 3.5;
    const prev = row.snapshot ?? {};

    const quotes: Quote[] = [];
    for (const t of tickers) {
      const q = await quoteOf(yahooSym(t));
      if (q) quotes.push({ ticker: t, price: q.price, prevClose: q.prev, changePct: (q.price / q.prev - 1) * 100,
        time: q.time ? new Date(q.time * 1000).toISOString() : "" });
    }

    // alertas: uma vez por ação por dia
    const alerts: Alert[] = prev.alerts ?? [];
    for (const q of quotes) {
      const id = `${q.ticker}-${date}`;
      if (q.changePct <= -limite && !alerts.some((a) => a.id === id)) {
        alerts.unshift({ id, ticker: q.ticker, changePct: q.changePct, price: q.price, date, time: brtTime(),
          msg: `${q.ticker} caiu ${pct(q.changePct)} hoje (limite ${limite.toString().replace(".", ",")}%)` });
      }
    }

    const news = await buildNews(tickers);
    const reports = prev.reports ?? [];
    if (mode === "report") {
      const rep = buildReport(date, quotes, indices, alerts, news);
      const i = reports.findIndex((r: any) => r.date === date);
      if (i >= 0) reports[i] = rep; else reports.unshift(rep);
    }

    const snapshot = {
      updatedAt: new Date().toISOString(),
      indices, quotes, news,
      alerts: alerts.slice(0, 30),
      reports: reports.slice(0, 14),
    };
    await sb.from("mercado").update({ snapshot, updated_at: new Date().toISOString() }).eq("user_id", row.user_id);
    processed++;
  }
  return Response.json({ ok: true, mode, processed });
});
