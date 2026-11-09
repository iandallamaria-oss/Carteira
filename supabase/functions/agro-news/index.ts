// Robô de notícias da aba "Agro": coleta notícias públicas de AGRO e de CÂMBIO (separadas).
// Fontes: Google News (busca por assunto), Canal Rural, Compre Rural, Money Times, Investing.com BR.
// Grava em agro.snapshot.news = { agro: [...], cambio: [...] }  (preserva o resto do snapshot).
// Deploy:  supabase functions deploy agro-news --no-verify-jwt
// Usa o mesmo CRON_SECRET do mercado-monitor.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const UA = "Mozilla/5.0 (compatible; CarteiraBot/1.0)";

type News = { title: string; link: string; source: string; published: string; topic: string };

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#8211;/g, "–").replace(/&#8217;/g, "’")
    .replace(/<[^>]+>/g, "").trim();

async function fetchRss(url: string, topic: string, max: number, defaultSource = ""): Promise<News[]> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [...xml.matchAll(/<item[ >]([\s\S]*?)<\/item>/g)].slice(0, max);
    return items.map((m) => {
      const b = m[1];
      const g = (tag: string) => decode(b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? "");
      let title = g("title");
      let source = g("source") || defaultSource;
      if (!g("source") && url.includes("news.google") && / - [^-]+$/.test(title)) {
        source = title.split(" - ").pop()!;
        title = title.slice(0, title.length - source.length - 3);
      }
      const pub = new Date(g("pubDate") || g("dc:date"));
      return { title, link: g("link"), source, published: isNaN(+pub) ? "" : pub.toISOString(), topic };
    }).filter((n) => n.title && n.link);
  } catch (_) {
    return [];
  }
}

const gnews = (q: string, when = "2d") =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:" + when)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

// Classificação por palavra-chave (para feeds gerais de agro)
const TOPICS: [string, RegExp][] = [
  ["Soja", /\bsoja\b|farelo|óleo de soja/i],
  ["Milho", /\bmilho\b|safrinha/i],
  ["Pecuária", /boi gordo|\bboi\b|bovin|pecuár|arroba|frango|suíno|\bporco\b|\bcarne/i],
  ["Café", /\bcafé\b|\bcafe\b|arábica|conilon/i],
  ["Trigo", /\btrigo\b/i],
  ["Açúcar e etanol", /açúcar|etanol|\bcana\b/i],
  ["Algodão", /algodão/i],
  ["Clima", /clima|chuva|seca\b|geada|el niño|la niña|previs[aã]o do tempo|estiagem|calor/i],
  ["Política agrícola", /plano safra|crédito rural|conab|usda|mapa\b|ministério da agricultura|exporta|tarifa|china/i],
];
const topicOf = (title: string, fallback = "Geral") => TOPICS.find(([, re]) => re.test(title))?.[0] ?? fallback;

const AGRO_QUERIES: [string, string][] = [
  ["Soja", "soja preço Chicago mercado"],
  ["Milho", "milho preço mercado safrinha"],
  ["Pecuária", "boi gordo arroba mercado"],
  ["Café", "café arábica preço mercado"],
  ["Trigo", "trigo preço mercado"],
  ["Açúcar e etanol", "açúcar etanol preço mercado"],
  ["Algodão", "algodão preço mercado"],
  ["Clima", "clima safra chuva geada agricultura"],
  ["Política agrícola", "Conab USDA safra estimativa"],
];

const CAMBIO_QUERIES = [
  "dólar hoje fechamento real",
  "câmbio dólar real Banco Central",
  "dólar Fed juros Selic moeda",
];
const CAMBIO_RE = /dólar|dolar|câmbio|cambio|\breal\b|moeda|\bfed\b|copom|selic|juros|euro|yuan|divisa/i;

function dedupe(list: News[], limit: number): News[] {
  const seen = new Set<string>();
  return list
    .filter((n) => { const k = n.title.toLowerCase().replace(/[^a-z0-9à-ú]/g, "").slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
    .slice(0, limit);
}

async function buildAgro(): Promise<News[]> {
  const jobs = [
    // busca do Google traz ruído (ex.: moto em "algodão"): só vale se o título citar o assunto
    ...AGRO_QUERIES.map(async ([t, q]) => {
      const re = TOPICS.find(([name]) => name === t)![1];
      return (await fetchRss(gnews(q), t, 10)).filter((n) => re.test(n.title)).slice(0, 6);
    }),
    fetchRss("https://www.canalrural.com.br/feed/", "Geral", 15, "Canal Rural"),
    fetchRss("https://www.comprerural.com/feed/", "Geral", 15, "Compre Rural"),
  ];
  const all = (await Promise.all(jobs)).flat()
    .map((n) => n.topic === "Geral" ? { ...n, topic: topicOf(n.title) } : n)
    // notícia de dólar/juros fica só na seção de Câmbio
    .filter((n) => !(n.topic === "Geral" && CAMBIO_RE.test(n.title)));
  return dedupe(all, 60);
}

async function buildCambio(): Promise<News[]> {
  const jobs = [
    ...CAMBIO_QUERIES.map((q) => fetchRss(gnews(q), "Câmbio", 10)),
    fetchRss("https://www.moneytimes.com.br/category/mercados/feed/", "Câmbio", 25, "Money Times"),
    fetchRss("https://br.investing.com/rss/news_1.rss", "Câmbio", 25, "Investing.com"),
  ];
  const all = (await Promise.all(jobs)).flat().filter((n) => CAMBIO_RE.test(n.title));
  return dedupe(all, 40);
}

Deno.serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const sb = createClient(SB_URL, SB_KEY);
  // usuários do app = quem tem linha em "mercado" ou "agro"
  const ids = new Set<string>();
  for (const t of ["mercado", "agro"]) {
    const { data } = await sb.from(t).select("user_id");
    (data ?? []).forEach((r: any) => ids.add(r.user_id));
  }
  const [agro, cambio] = await Promise.all([buildAgro(), buildCambio()]);
  if (!agro.length && !cambio.length) return Response.json({ ok: false, error: "nenhuma fonte respondeu" }, { status: 502 });

  let processed = 0;
  for (const user_id of ids) {
    const { data: row } = await sb.from("agro").select("snapshot").eq("user_id", user_id).maybeSingle();
    const prev = row?.snapshot ?? {};
    const snapshot = {
      ...prev,
      updatedAt: new Date().toISOString(),
      // se uma das listas vier vazia (fonte fora do ar), mantém a anterior
      news: { agro: agro.length ? agro : prev.news?.agro ?? [], cambio: cambio.length ? cambio : prev.news?.cambio ?? [] },
    };
    const { error } = await sb.from("agro").upsert({ user_id, snapshot, updated_at: new Date().toISOString() });
    if (!error) processed++;
  }
  return Response.json({ ok: true, processed, agro: agro.length, cambio: cambio.length });
});
