import catalog from "./artwork-catalog.json";

// A URL catalogue of public-domain Impressionist and Post-Impressionist works
// scanned by the Google Art Project and hosted on Wikimedia Commons. Rebuild it
// with `node scripts/build-art-catalog.mjs`; see public/art/README.md.
export type Artwork = {
  id: string;
  artist: string;
  title: string;
  year: string;
  /** Remote Wikimedia Commons thumbnail, or a local path for the fallback. */
  image: string;
  /** Google Arts & Culture reference page. */
  source: string;
  commons?: string;
  license?: string;
  collection?: string;
};

export const artworks: readonly Artwork[] = catalog;

// The only locally stored painting, shown when a remote image cannot load
// (offline use, blocked hosts or a removed Commons file).
export const fallbackArtwork: Artwork = {
  id: "monet-water-lilies",
  artist: "Claude Monet",
  title: "Water Lilies",
  year: "1906",
  image: "/art/monet-water-lilies.jpg",
  source: "https://artsandculture.google.com/asset/XwEbNDsEYukiWQ",
  commons:
    "https://commons.wikimedia.org/wiki/File:Claude_Monet_-_Water_Lilies_-_1906,_Ryerson.jpg",
  license: "Public domain",
  collection: "The Art Institute of Chicago",
};

type ShuffleState = { remaining: string[]; last: string | null };
type ArtStorage = Pick<Storage, "getItem" | "setItem">;
export const artworkStorageKey = "benchmark-artwork-shuffle-v2";
const ids: string[] = artworks.map((artwork) => artwork.id);
const known = new Set(ids);
const byId = new Map(artworks.map((artwork) => [artwork.id, artwork]));

function readState(value: string | null): ShuffleState | null {
  if (!value) return null;
  try {
    const state: unknown = JSON.parse(value);
    if (!state || typeof state !== "object") return null;
    const { remaining, last } = state as Partial<ShuffleState>;
    if (
      !Array.isArray(remaining) ||
      !remaining.every((id) => typeof id === "string" && known.has(id)) ||
      new Set(remaining).size !== remaining.length ||
      !(last === null || (typeof last === "string" && known.has(last))) ||
      (last !== null && remaining.includes(last))
    )
      return null;
    return { remaining, last };
  } catch {
    return null;
  }
}

// Each complete bag contains every work once. The next bag cannot start with
// the previous bag's final work. In-memory state also supports blocked storage.
export function createArtworkShuffler(random = Math.random) {
  let memory: ShuffleState = { remaining: [], last: null };
  return (storage?: ArtStorage | null): Artwork => {
    let state = memory;
    try {
      state = readState(storage?.getItem(artworkStorageKey) ?? null) ?? memory;
    } catch {
      /* Storage may be blocked by browser settings. */
    }
    const remaining = [...state.remaining];
    if (!remaining.length) {
      remaining.push(...ids);
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      if (remaining.length > 1 && remaining[0] === state.last) {
        const j = 1 + Math.floor(random() * (remaining.length - 1));
        [remaining[0], remaining[j]] = [remaining[j], remaining[0]];
      }
    }
    const id = remaining.shift()!;
    memory = { remaining, last: id };
    try {
      storage?.setItem(artworkStorageKey, JSON.stringify(memory));
    } catch {
      /* The in-memory bag still avoids repeats during navigation. */
    }
    return byId.get(id)!;
  };
}
