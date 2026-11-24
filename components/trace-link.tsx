import { ExternalLink } from "lucide-react";

export function TraceLink({
  url,
  compact = false,
}: {
  url?: string;
  compact?: boolean;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Langfuse (new tab)"
      aria-label="Open in Langfuse (new tab)"
      onClick={(event) => event.stopPropagation()}
    >
      {compact ? (
        <ExternalLink size={14} aria-hidden="true" />
      ) : (
        "Open in Langfuse"
      )}
    </a>
  );
}
