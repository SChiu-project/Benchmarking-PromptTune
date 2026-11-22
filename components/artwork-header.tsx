"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { artworks, createArtworkShuffler, type Artwork } from "@/lib/artwork";

const nextArtwork = createArtworkShuffler();

export function ArtworkHeader() {
  const pathname = usePathname();
  const [artwork, setArtwork] = useState<Artwork | null>(null);

  useEffect(() => {
    let disposed = false;
    let pending: HTMLImageElement | null = null;
    function selectArtwork() {
      let storage: Storage | null = null;
      try {
        storage = window.sessionStorage;
      } catch {
        /* Use in-memory shuffle. */
      }
      const selected = nextArtwork(storage);
      if (pending) pending.onload = pending.onerror = null;
      const image = new Image();
      pending = image;
      image.onload = () => {
        if (!disposed) setArtwork(selected);
      };
      image.onerror = () => {
        if (!disposed) setArtwork(artworks[0]);
      };
      image.src = selected.image;
    }
    // Deferring skips React Strict Mode's discarded effect and keeps the server
    // and initial client render identical. Polling re-renders never select art.
    queueMicrotask(() => {
      if (!disposed) selectArtwork();
    });
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) selectArtwork();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      disposed = true;
      if (pending) pending.onload = pending.onerror = null;
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pathname]);

  return (
    <div
      className="page-heading-art"
      style={
        artwork ? { backgroundImage: `url("${artwork.image}")` } : undefined
      }
    >
      {artwork && (
        <a
          href={artwork.source}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${artwork.title} by ${artwork.artist}, ${artwork.year}. Explore on Google Arts & Culture (opens in a new tab).`}
        >
          {artwork.artist} · {artwork.title}, {artwork.year}
        </a>
      )}
    </div>
  );
}
