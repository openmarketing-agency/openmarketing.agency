"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { FileImage } from "lucide-react";

export function BrandAssetPreview({ url, label, kind }: { url?: string; label: string; kind?: "image" | "font" }) {
  const [failed, setFailed] = useState(false);
  const [family, setFamily] = useState<string>();

  useEffect(() => {
    if (kind !== "font" || !url) return;
    const face = new FontFace("brand-" + url.split("/").at(-1), `url("${url}")`);
    let cancelled = false;
    void face.load().then(() => {
      if (cancelled) return;
      document.fonts.add(face);
      setFamily(face.family);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; document.fonts.delete(face); };
  }, [kind, url]);

  if (!url || !kind || failed) return (
    <div className="record-asset-preview record-asset-unavailable">
      <FileImage size={26} aria-hidden="true" />
      <span>{failed ? "Preview unavailable" : "No inline preview"}</span>
    </div>
  );
  if (kind === "font") return (
    <div className="record-asset-preview record-font-preview" style={family ? { fontFamily: family } : undefined}>
      {family ? <><strong>Aa</strong><span>The quick brown fox · 0123456789</span></> : <span>Loading font…</span>}
    </div>
  );
  return (
    <a className="record-asset-preview record-asset-image" href={url} target="_blank" rel="noreferrer" aria-label={`Open ${label} at full size`}>
      <Image src={url} alt={label} fill sizes="(max-width: 600px) 100vw, 320px" unoptimized onError={() => setFailed(true)} />
    </a>
  );
}
