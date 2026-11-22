# Header artwork

The shared page header shows a painting from a catalogue of public-domain Impressionist and Post-Impressionist works scanned by the **Google Art Project** (Google Arts & Culture) and hosted on Wikimedia Commons. The catalogue lives in [`lib/artwork-catalog.json`](../../lib/artwork-catalog.json) and must hold at least 100 works; the build script and the artwork tests both enforce this.

A painting is selected on each route visit, refresh, or return via the browser's back/forward cache. A shuffled bag in `sessionStorage` shows every catalogued work once before starting another cycle and avoids an immediate repeat between cycles. Normal polling and filter changes do not reshuffle, and there is no timed rotation. When browser storage is blocked, an in-memory bag supports navigation; reload history cannot be retained in that case.

## Sources and rights

Each catalogue entry records:

| Field        | Meaning                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------- |
| `image`      | 1280px Wikimedia Commons thumbnail of the Google Art Project scan (loaded by the browser) |
| `source`     | The work's Google Arts & Culture page, linked from the caption                            |
| `commons`    | The Commons file page, which holds the full rights record                                 |
| `license`    | Commons licence. Only `Public domain` (PD-Art) or CC0 files are accepted                  |
| `collection` | Holding museum, as reported by the Google Art Project                                     |

Only artists who died before 1930 are included, so the paintings are public domain worldwide; Commons tags these faithful 2D reproductions as PD-Art. Google Arts & Culture is the discovery and attribution destination. Images are served by Wikimedia, not copied from Google's viewer, and Google appearance alone does not establish reuse rights.

## Offline fallback

`monet-water-lilies.jpg` (Claude Monet, _Water Lilies_, 1906, Art Institute of Chicago 16568; [Commons](https://commons.wikimedia.org/wiki/File:Claude_Monet_-_Water_Lilies_-_1906,_Ryerson.jpg), public domain; [Google Arts & Culture](https://artsandculture.google.com/asset/XwEbNDsEYukiWQ)) is the only locally stored image. It is shown with its own caption whenever the selected remote image fails to load. It is resized to a 1200px maximum edge.

## Rebuilding the catalogue

```sh
node scripts/build-art-catalog.mjs
```

The script reads `Category:Google Art Project works by <artist>` for a fixed list of artists, keeps landscape-format paintings (aspect ratio at least 1.15, no works on paper) that carry the Google Art Project template with a Google Arts & Culture asset ID and a public-domain licence, takes up to 15 per artist, and checks that each thumbnail and Google Arts & Culture page responds. It fails if fewer than 100 works qualify. After rebuilding, bump `artworkStorageKey` in `lib/artwork.ts` so existing sessions start a fresh bag, then run `pnpm exec vitest run tests/artwork.test.ts`.
