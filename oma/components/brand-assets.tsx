import { ArrowUpRight, Download } from "lucide-react";
import { BrandAssetPreview } from "@/components/brand-asset-preview";
import type { BrandAsset, SavedBrand } from "@/lib/server/agent-workspace";

const sections = [
  ["screenshots", "Screenshots"], ["logos", "Logos"], ["illustrations", "Illustrations"],
  ["icons", "Icons"], ["backgrounds", "Backgrounds"], ["images", "Images"], ["fonts", "Fonts"],
] as const;

type AssetCard = Pick<BrandAsset, "file" | "label" | "sourceUrl"> & {
  key: string; url?: string; download?: string; kind?: "image" | "font";
};

function assetLabel(name: string) {
  const words = name.replaceAll(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function cards(brand: SavedBrand, category: BrandAsset["category"]): AssetCard[] {
  const root = "/api/workspace/brands/" + brand.id;
  if (!brand.assetFiles) {
    // An older VM can still supply logo previews and the original file listings.
    if (category === "logos") return Object.entries(brand.logos).map(([label, file]) => ({
      key: label, file, label, sourceUrl: "", kind: "image",
      url: /^[A-Za-z0-9_-]{1,64}$/.test(label) && /\.(png|jpe?g|gif|webp)$/i.test(file) ? root + "/logos/" + label : undefined,
    }));
    return (brand.assets[category] ?? []).map((file, index) => ({ key: file + index, file, label: "", sourceUrl: "" }));
  }
  return brand.assetFiles.filter((asset) => asset.category === category).map((asset) => {
    const url = root + "/assets/" + asset.id;
    return { ...asset, key: JSON.stringify([asset.id, asset.label, asset.sourceUrl]), url, download: url + "?download=1",
      kind: asset.mediaType.startsWith("image/") ? "image" : asset.mediaType.startsWith("font/") ? "font" : undefined };
  });
}

export function BrandAssets({ brand }: { brand: SavedBrand }) {
  const colors = Object.entries(brand.palette);
  const groups = sections.map(([category, title]) => ({ category, title, assets: cards(brand, category) })).filter(({ assets }) => assets.length);
  return (
    <div className="record-groups" id="brand-assets">
      {groups.map(({ category, title, assets }) => (
        <section key={category} className="record-group">
          <h2>{title}</h2>
          <ul className="record-asset-grid" data-category={category}>
            {assets.map(({ key, url, kind, file, label, sourceUrl, download }) => {
              const name = label ? assetLabel(label) : file.split("/").at(-1) ?? file;
              const source = URL.parse(sourceUrl);
              const safeSource = source && ["https:", "http:"].includes(source.protocol) && !source.username && !source.password;
              return (
                <li key={key}>
                  <BrandAssetPreview key={url} url={url} label={name} kind={kind} />
                  <strong>{name}</strong>
                  <small>{file}</small>
                  <div className="record-asset-links">
                    {safeSource && <a href={source.href} target="_blank" rel="noreferrer" title={source.href}>Source page <ArrowUpRight size={13} aria-hidden="true" /></a>}
                    {download && <a href={download} download aria-label={`Download ${name}`}><Download size={13} aria-hidden="true" /> Download</a>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {!!colors.length && (
        <section className="record-group">
          <h2>Palette</h2>
          <dl className="record-palette">
            {colors.map(([name, value]) => (
              <div key={name}>
                <div className="record-swatch" aria-hidden="true" style={/^#[a-f0-9]{6}$/i.test(value) ? { backgroundColor: value } : undefined} />
                <dt>{assetLabel(name)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {!colors.length && !groups.length && <p className="record-empty">No brand assets saved yet.</p>}
    </div>
  );
}
