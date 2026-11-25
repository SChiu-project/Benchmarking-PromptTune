"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ArtworkHeader } from "./artwork-header";
import { PaintedField } from "./painted-field";
import { seedFor } from "@/lib/painter";

// The garden study paints a seeded field behind the heading. Setting
// NEXT_PUBLIC_HEADER_IMAGERY=rotating restores the earlier rotating painting
// catalogue for one release while the generated field beds in.
const rotating = process.env.NEXT_PUBLIC_HEADER_IMAGERY === "rotating";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const pathname = usePathname() || "/";
  return (
    <div className={rotating ? "page-heading rotating" : "page-heading"}>
      {rotating ? (
        <ArtworkHeader />
      ) : (
        <PaintedField
          mode="hero"
          seed={seedFor(pathname)}
          className="page-heading-paint"
        />
      )}
      <div className="page-heading-content">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
        {action && <div className="page-heading-action">{action}</div>}
      </div>
    </div>
  );
}
