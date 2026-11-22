/** Shows saved brand and playbook details and their focused edit forms. */

import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

import { BrandSources } from "@/components/brand-sources";
import { Loading } from "@/components/ui";
import { WorkspaceText } from "@/components/workspace-text";
import { WorkspaceRecordEditor } from "@/components/workspace-record-editor";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, loadBrandDocument, workspaceId, type SavedBrand } from "@/lib/server/agent-workspace";

type Props = {
  params: Promise<{ collection: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function WorkspaceRecordPage(props: Props) {
  return <Suspense fallback={<Loading label="Loading workspace record…" />}><RecordDetail {...props} /></Suspense>;
}

async function RecordDetail({ params, searchParams }: Props) {
  const [{ collection, id }, query] = await Promise.all([params, searchParams]);
  if ((collection !== "brands" && collection !== "playbooks") || !workspaceId.safeParse(id).success) notFound();
  await requireUser();
  const { records, error } = await loadAgentWorkspace();
  const record = records?.[collection].find((item) => item.id === id);
  if (!record && !error) notFound();
  const path = "/workspace/" + collection + "/" + id;
  const isBrand = record && "knowledge" in record;
  const editingKnowledge = isBrand && query.edit === "knowledge" && Boolean(record.knowledgeRevision);
  const editing = query.edit === "1" || editingKnowledge;
  const activeDocument = typeof query.document === "string" ? query.document : undefined;
  const selectedDocument = isBrand && !editing && activeDocument !== undefined ? await loadBrandDocument(id, activeDocument) : undefined;
  const relatedBrand = record && "brandId" in record ? records?.brands.find((brand) => brand.id === record.brandId) : undefined;
  const relatedPlaybooks = collection === "brands" ? records?.playbooks.filter((playbook) => playbook.brandId === id) : undefined;
  const relatedCampaigns = records?.campaigns.filter((campaign) => campaign.playbookId === id) ?? [];

  return (
    <div className="agent-playbook-page">
      <Link className="back-link" href="/dashboard"><ArrowLeft size={14} aria-hidden="true" /> Campaigns</Link>
      {record ? (
        <>
          <header className="workspace-record-heading">
            <div>
              <h1>{record.name}</h1>
              {record.description && <p>{record.description}</p>}
            </div>
            {!editing && (
              <Link className="btn secondary" href={path + "?edit=1"}>
                <Pencil size={15} aria-hidden="true" /> {isBrand ? "Edit brand" : "Edit strategy"}
              </Link>
            )}
          </header>
          {(query.saved === "1" || query.saved === "knowledge") && !editing && (
            <p className="workspace-save-status" role="status">
              {query.saved === "knowledge" ? "Brand knowledge saved." : isBrand ? "Brand saved." : "Strategy saved."}
            </p>
          )}
          {editing ? (
            isBrand
              ? <WorkspaceRecordEditor key={editingKnowledge ? "knowledge" : "brand"} collection={editingKnowledge ? "brand-knowledge" : "brands"} path={path} record={record} />
              : <WorkspaceRecordEditor collection="playbooks" path={path} record={record} />
          ) : (
            <div className="workspace-overview">
              {relatedBrand && (
                <dl className="workspace-facts">
                  <div><dt>Brand</dt><dd><Link href={"/workspace/brands/" + relatedBrand.id}>{relatedBrand.name}</Link></dd></div>
                </dl>
              )}
              {isBrand && (
                <nav className="workspace-section-nav" aria-label="Brand sections">
                  <a href="#brand-knowledge">Knowledge</a>
                  {!!record.channels?.length && <a href="#brand-channels">Channels</a>}
                  {(record.designSource || !!record.documents?.length) && <a href="#brand-research">Research and documentation</a>}
                  {(Object.keys(record.logos).length > 0 || Object.values(record.assets).some((files) => files.length)) && (
                    <a href="#brand-assets">Assets</a>
                  )}
                </nav>
              )}
              <section id={isBrand ? "brand-knowledge" : undefined}>
                {isBrand ? <BrandKnowledge brand={record} path={path} /> : (
                  <>
                    <h2>Strategy</h2>
                    <WorkspaceText text={record.strategy} html={record.strategyHtml} empty="No strategy saved yet." />
                  </>
                )}
              </section>
              {isBrand && <>
                <BrandSources brand={record} path={path} activeDocument={activeDocument} selected={selectedDocument} />
                <BrandAssets brand={record} />
              </>}
              {!!relatedPlaybooks?.length && (
                <section><h2>Playbooks</h2>
                  <ul className="workspace-link-list">
                    {relatedPlaybooks.map((item) => <li key={item.id}><Link href={"/workspace/playbooks/" + item.id}>{item.name}</Link></li>)}
                  </ul>
                </section>
              )}
              {!isBrand && !!relatedCampaigns.length && (
                <section><h2>Campaigns</h2>
                  <ul className="workspace-link-list">
                    {relatedCampaigns.map((item) => <li key={item.id}><Link href={"/campaigns/" + item.id}>{item.name}</Link></li>)}
                  </ul>
                </section>
              )}
            </div>
          )}
        </>
      ) : <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

function BrandKnowledge({ brand, path }: { brand: SavedBrand; path: string }) {
  return (
    <>
      <div className="workspace-document-heading">
        <h2>Brand knowledge</h2>
        {brand.knowledgeRevision && (
          <Link className="btn secondary" href={path + "?edit=knowledge"}>
            <Pencil size={14} aria-hidden="true" /> Edit knowledge
          </Link>
        )}
      </div>
      {brand.knowledgeFile !== undefined && !brand.knowledgeRevision
        ? <p>The saved brand knowledge file could not be read.</p>
        : <WorkspaceText text={brand.knowledge} html={brand.knowledgeHtml} empty="No brand knowledge saved yet." />}
    </>
  );
}

function BrandAssets({ brand }: { brand: SavedBrand }) {
  const colors = Object.entries(brand.palette);
  const logos = Object.entries(brand.logos);
  const assets = Object.entries(brand.assets).filter(([, files]) => files.length > 0);
  return (
    <>
      {!!colors.length && (
        <section>
          <h2>Palette</h2>
          <dl className="workspace-facts workspace-palette">
            {colors.map(([name, value]) => (
              <div key={name}><dt>{name}</dt><dd>
                {/^#[a-f0-9]{6}$/i.test(value) && <span aria-hidden="true" style={{ backgroundColor: value }} />}
                {value}
              </dd></div>
            ))}
          </dl>
        </section>
      )}
      {(logos.length > 0 || assets.length > 0) && (
        <section id="brand-assets">
          <h2>Assets</h2>
          {!!logos.length && (
            <ul className="workspace-logo-list">
              {logos.map(([name, file]) => (
                <li key={name}>
                  {/^[A-Za-z0-9_-]{1,64}$/.test(name) && /[.](?:png|jpe?g|webp|gif)$/i.test(file) && (
                    <Image src={"/api/workspace/brands/" + brand.id + "/logos/" + name} alt={name + " logo"}
                      width={300} height={128} unoptimized />
                  )}
                  <strong>{name}</strong>
                  <span>{file}</span>
                </li>
              ))}
            </ul>
          )}
          {!!assets.length && (
            <dl className="workspace-facts">
              {assets.map(([name, items]) => (
                <div key={name}>
                  <dt>{name.charAt(0).toUpperCase() + name.slice(1)}</dt>
                  <dd><ul className="workspace-file-list">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}
    </>
  );
}
