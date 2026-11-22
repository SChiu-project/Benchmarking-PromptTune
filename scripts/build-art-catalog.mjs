// Builds lib/artwork-catalog.json: a URL catalogue of public-domain
// Impressionist and Post-Impressionist paintings scanned by the Google Art
// Project and hosted on Wikimedia Commons. Each entry links to its Google Arts
// & Culture page for attribution. Run with: node scripts/build-art-catalog.mjs
import { writeFile } from "node:fs/promises";

const api = "https://commons.wikimedia.org/w/api.php";
const userAgent =
  "SetSailBenchmarkArtCatalog/1.0 (https://commons.wikimedia.org; header artwork catalogue)";
const thumbWidth = 1280; // A standard Wikimedia thumbnail step.
const perArtist = 15;
const minimum = 100;

// Artists who died before 1930, so their works are public domain worldwide.
const artists = [
  "Claude Monet",
  "Pierre-Auguste Renoir",
  "Camille Pissarro",
  "Alfred Sisley",
  "Edgar Degas",
  "Gustave Caillebotte",
  "Berthe Morisot",
  "Mary Cassatt",
  "Édouard Manet",
  "Frédéric Bazille",
  "Armand Guillaumin",
  "Eugène Boudin",
  "Vincent van Gogh",
  "Paul Cézanne",
  "Georges Seurat",
  "Paul Signac",
  "Paul Gauguin",
  "Henri-Edmond Cross",
  "Henri de Toulouse-Lautrec",
  "Johan Barthold Jongkind",
  "Théo van Rysselberghe",
  "Odilon Redon",
];

async function query(params) {
  const url = new URL(api);
  url.search = new URLSearchParams({
    format: "json",
    formatversion: "2",
    ...params,
  }).toString();
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent },
    });
    if (response.ok) return response.json();
    if (attempt >= 3) throw new Error(`${response.status} for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
}

async function categoryFiles(artist) {
  const titles = [];
  let cont = {};
  do {
    const data = await query({
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:Google Art Project works by ${artist}`,
      cmtype: "file",
      cmlimit: "500",
      ...cont,
    });
    titles.push(...(data.query?.categorymembers ?? []).map((m) => m.title));
    cont = data.continue ?? null;
  } while (cont);
  return titles.filter((title) => /\.jpe?g$/i.test(title)).sort();
}

function templateField(wikitext, name) {
  const match = wikitext.match(
    new RegExp(`\\|\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=([^\\n|]*)`),
  );
  return match?.[1].trim() ?? "";
}

function clean(text) {
  return text
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70)
    .replace(/-$/, "");
}

function tidyTitle(title, artist) {
  return title
    .replace(/''/g, "")
    .replace(new RegExp(`\\s*-\\s*${artist}\\s*(-.*)?$`, "i"), "")
    .replace(new RegExp(`^${artist}\\s*-\\s*`, "i"), "")
    .replace(/\s*-\s*\d{4}$/, "")
    .trim();
}

// "(1870 - 1875)" -> "1870–1875"; "(May 1887 - July 1887)" -> "1887";
// "circa 1872" / "about 1895" -> "c. 1872".
function tidyYear(date) {
  const text = date.replace(/^\((.*)\)$/, "$1").trim();
  const years = [...text.matchAll(/\b(1[6-9]\d\d)\b/g)].map((m) => m[1]);
  if (!years.length) return "";
  const decade = text.match(/\b(1[6-9]\d0)'?s\b/);
  if (decade) return `${/early|late|mid/i.exec(text)?.[0].toLowerCase() ?? ""} ${decade[1]}s`.trim();
  const approx = /\b(c\.|ca\.?|circa|about|around)/i.test(text) ? "c. " : "";
  const [first, last] = [years[0], years.at(-1)];
  return first === last ? `${approx}${first}` : `${approx}${first}–${last}`;
}

async function describe(titles) {
  const pages = [];
  for (let i = 0; i < titles.length; i += 25) {
    const data = await query({
      action: "query",
      titles: titles.slice(i, i + 25).join("|"),
      prop: "imageinfo|revisions",
      rvprop: "content",
      rvslots: "main",
      iiprop: "url|size|extmetadata",
      iiurlwidth: String(thumbWidth),
    });
    pages.push(...(data.query?.pages ?? []));
  }
  return pages;
}

function toArtwork(page, artist) {
  const info = page.imageinfo?.[0];
  const wikitext = page.revisions?.[0]?.slots?.main?.content ?? "";
  // Only the Google Art Project template carries a reliable Google Arts &
  // Culture asset ID, title and display date.
  if (!info || !/\{\{\s*Google Art Project/i.test(wikitext)) return null;
  const meta = info.extmetadata ?? {};
  const license = meta.LicenseShortName?.value ?? "";
  if (!/public domain|cc0|pd/i.test(license)) return null;
  if (meta.Copyrighted?.value === "True") return null;
  // Skip prints, drawings and other works on paper; keep canvases and panels.
  const kind = `${templateField(wikitext, "object_work_type")} ${templateField(wikitext, "medium")}`;
  if (/paper|print|drawing|etching|lithograph|pastel|photo|sculpt/i.test(kind))
    return null;
  const assetId = templateField(wikitext, "special:url_id");
  if (!/^[\w-]{10,}$/.test(assetId)) return null;
  // The header is a wide, shallow crop; portrait canvases crop badly.
  if (info.width / info.height < 1.15 || info.thumbwidth < thumbWidth)
    return null;
  const title = tidyTitle(clean(templateField(wikitext, "title")), artist);
  const year = tidyYear(
    clean(
      templateField(wikitext, "pretty_display_date") ||
        templateField(wikitext, "earliest_date_display"),
    ),
  );
  if (
    !title ||
    !year ||
    title.length > 90 ||
    /^untitled$|\bletter\b|[{}]/i.test(title)
  )
    return null;
  const thumb = new URL(info.thumburl);
  thumb.search = "";
  return {
    id: `${slug(artist)}-${slug(title)}`,
    artist,
    title,
    year,
    image: thumb.toString(),
    source: `https://artsandculture.google.com/asset/${assetId}`,
    commons: info.descriptionurl,
    license: license === "Public domain" ? "Public domain (PD-Art)" : license,
    collection: clean(templateField(wikitext, "collection_display_name")),
  };
}

async function reachable(url, type) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      method: type === "image" ? "HEAD" : "GET",
      headers: { "User-Agent": userAgent },
      redirect: "follow",
    });
    if (type !== "image") await response.body?.cancel();
    if (response.ok)
      return type === "image"
        ? /^image\/jpe?g/.test(response.headers.get("content-type") ?? "")
        : true;
    if (response.status !== 429 && response.status < 500) return false;
    await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
  }
  return false;
}

const catalog = [];
const seen = new Set();
for (const artist of artists) {
  const files = await categoryFiles(artist);
  const works = (await describe(files))
    .map((page) => toArtwork(page, artist))
    .filter(Boolean);
  let added = 0;
  for (const work of works) {
    if (added >= perArtist) break;
    const key = `${slug(work.title)}|${work.year}`;
    if (seen.has(work.id) || seen.has(key)) continue;
    if (!(await reachable(work.image, "image"))) continue;
    if (!(await reachable(work.source, "page"))) continue;
    seen.add(work.id).add(key);
    catalog.push(work);
    added++;
  }
  console.log(`${artist}: ${added} of ${files.length} files`);
}

if (catalog.length < minimum)
  throw new Error(`Only ${catalog.length} works; at least ${minimum} required.`);
await writeFile(
  new URL("../lib/artwork-catalog.json", import.meta.url),
  `${JSON.stringify(catalog, null, 2)}\n`,
);
console.log(`Wrote ${catalog.length} works to lib/artwork-catalog.json`);
