/** Shows saved brand and playbook details and their focused edit forms. */

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, FileImage, Megaphone, Pencil, Tag } from "lucide-react";

import { BrandChannels, BrandResearch } from "@/components/brand-sources";
import { Loading } from "@/components/ui";
import { WorkspaceText } from "@/components/workspace-text";
import { WorkspaceRecordEditor } from "@/components/workspace-record-editor";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, loadBrandDocument, workspaceId, type SavedBrand } from "@/lib/server/agent-workspace";
import "@/components/workspace-record-detail.css";

type Props = {
  params: Promise<{ collection: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const brandViews = [
  { id: "overview", label: "Overview" },
  { id: "channels", label: "Channels" },
  { id: "research", label: "Research" },
  { id: "assets", label: "Assets" },
] as const;

function brandViewPath(path: string, view: typeof brandViews[number]["id"]) {
  return view === "overview" ? path : path + "?view=" + view;
}

function isPreviewableLogo(name: string, file: string) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) && /[.](?:png|jpe?g|webp|gif)$/i.test(file);
}

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
  const brand = record && "knowledge" in record ? record : undefined;
  const playbook = record && "strategy" in record ? record : undefined;
  const editingKnowledge = query.edit === "knowledge" && Boolean(brand?.knowledgeRevision);
  const editing = query.edit === "1" || editingKnowledge;
  const documentId = typeof query.document === "string" ? query.document : undefined;
  const view = documentId !== undefined ? "research" : brandViews.find(({ id }) => id === query.view)?.id ?? "overview";
  const sectionPath = brand ? brandViewPath(path, view) : path;
  const selectedDocument = brand && !editing && documentId !== undefined ? await loadBrandDocument(id, documentId) : undefined;
  const relatedBrand = playbook && records?.brands.find(({ id }) => id === playbook.brandId);
  const relatedPlaybooks = brand ? records?.playbooks.filter(({ brandId }) => brandId === brand.id) ?? [] : [];
  const relatedCampaigns = playbook ? records?.campaigns.filter(({ playbookId }) => playbookId === playbook.id) ?? [] : [];
  const brandMark = brand?.logos.mark;

  return (
    <div className="agent-playbook-page record-detail">
      <Link className="back-link" href="/dashboard"><ArrowLeft size={14} aria-hidden="true" /> Campaigns</Link>
      {record ? (
        <>
          <header className="record-heading">
            <div className="record-identity">
              <span className="record-mark" aria-hidden="true">
                {brand && brandMark && isPreviewableLogo("mark", brandMark)
                  ? <Image src={"/api" + path + "/logos/mark"} alt="" width={36} height={36} unoptimized />
                  : brand ? <Tag size={23} /> : <BookOpen size={23} />}
              </span>
              <div>
                <h1>{record.name}</h1>
                {record.description && <p>{record.description}</p>}
              </div>
            </div>
            {!editing && (
              <Link className="btn secondary" href={sectionPath + (sectionPath === path ? "?" : "&") + "edit=1"}>
                <Pencil size={15} aria-hidden="true" /> {brand ? "Edit brand" : "Edit strategy"}
              </Link>
            )}
          </header>
          {(query.saved === "1" || query.saved === "knowledge") && !editing && (
            <p className="workspace-save-status" role="status">
              {query.saved === "knowledge" ? "Brand knowledge saved." : brand ? "Brand saved." : "Strategy saved."}
            </p>
          )}
          {editing ? (
            <div className="record-editor">
              <h2>{editingKnowledge ? "Edit brand knowledge" : brand ? "Edit brand" : "Edit strategy"}</h2>
              {brand
                ? <WorkspaceRecordEditor key={editingKnowledge ? "knowledge" : "brand"} collection={editingKnowledge ? "brand-knowledge" : "brands"} path={sectionPath} record={brand} />
                : playbook && <WorkspaceRecordEditor collection="playbooks" path={path} record={playbook} />}
            </div>
          ) : (
            <>
              {brand && (
                <nav className="record-tabs" aria-label="Brand sections">
                  {brandViews.map(({ id, label }) => (
                    <Link key={id} href={brandViewPath(path, id)} aria-current={view === id ? "page" : undefined} prefetch={false}>{label}</Link>
                  ))}
                </nav>
              )}
              {brand && view === "overview" && (
                <RecordColumns related={relatedPlaybooks.length > 0 && (
                  <RecordLinks heading="Playbooks" icon={<BookOpen size={16} aria-hidden="true" />}
                    items={relatedPlaybooks} base="/workspace/playbooks/" />
                )}>
                  <BrandKnowledge brand={brand} path={path} />
                </RecordColumns>
              )}
              {brand && view === "channels" && <BrandChannels brand={brand} />}
              {brand && view === "research" && <BrandResearch brand={brand} path={path} selected={selectedDocument} />}
              {brand && view === "assets" && <BrandAssets brand={brand} />}
              {playbook && (
                <RecordColumns related={(relatedBrand || relatedCampaigns.length > 0) && (
                  <>
                    {relatedBrand && <RecordLinks heading="Brand" icon={<Tag size={16} aria-hidden="true" />}
                      items={[relatedBrand]} base="/workspace/brands/" />}
                    {relatedCampaigns.length > 0 && <RecordLinks heading="Campaigns" icon={<Megaphone size={16} aria-hidden="true" />}
                      items={relatedCampaigns} base="/campaigns/" />}
                  </>
                )}>
                  <section className="record-reading" aria-labelledby="strategy-heading">
                    <h2 id="strategy-heading">Strategy</h2>
                    <WorkspaceText text={playbook.strategy} html={playbook.strategyHtml} empty="No strategy saved yet." />
                  </section>
                </RecordColumns>
              )}
            </>
          )}
        </>
      ) : (
        <header className="record-heading">
          <div>
            <h1>Workspace record unavailable</h1>
            <p className="form-error" role="alert">{error}</p>
          </div>
        </header>
      )}
    </div>
  );
}

function RecordColumns({ children, related }: { children: ReactNode; related: ReactNode }) {
  return (
    <div className="record-columns">
      {children}
      {related && <aside className="record-related" aria-label="Related workspace records">{related}</aside>}
    </div>
  );
}

function RecordLinks({ heading, icon, items, base }: {
  heading: string;
  icon: ReactNode;
  items: { id: string; name: string }[];
  base: string;
}) {
  return (
    <section className="record-links">
      <h2>{icon}{heading}</h2>
      <ul>
        {items.map(({ id, name }) => (
          <li key={id}><Link href={base + id}>{name}<ArrowRight size={15} aria-hidden="true" /></Link></li>
        ))}
      </ul>
    </section>
  );
}

function BrandKnowledge({ brand, path }: { brand: SavedBrand; path: string }) {
  return (
    <section className="record-reading" id="brand-knowledge" aria-labelledby="knowledge-heading">
      <div className="record-section-heading">
        <h2 id="knowledge-heading">Brand knowledge</h2>
        {brand.knowledgeRevision && (
          <Link className="btn secondary" href={path + "?edit=knowledge"}>
            <Pencil size={14} aria-hidden="true" /> Edit knowledge
          </Link>
        )}
      </div>
      {brand.knowledgeFile !== undefined && !brand.knowledgeRevision
        ? <p className="form-error">The saved brand knowledge file could not be read.</p>
        : <WorkspaceText text={brand.knowledge} html={brand.knowledgeHtml} empty="No brand knowledge saved yet." />}
    </section>
  );
}

function assetLabel(name: string) {
  const words = name.replaceAll(/[_-]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function BrandAssets({ brand }: { brand: SavedBrand }) {
  const colors = Object.entries(brand.palette);
  const logos = Object.entries(brand.logos);
  const assets = Object.entries(brand.assets).filter(([, files]) => files.length > 0);

  return (
    <div className="record-groups" id="brand-assets">
      {!!logos.length && (
        <section className="record-group">
          <h2>Logos</h2>
          <ul className="record-logos">
            {logos.map(([name, file]) => (
              <li key={name}>
                <div className="record-logo-preview">
                  {isPreviewableLogo(name, file)
                    ? <Image src={"/api/workspace/brands/" + brand.id + "/logos/" + name} alt="" width={300} height={128} unoptimized />
                    : <FileImage size={28} aria-hidden="true" />}
                </div>
                <strong>{assetLabel(name)}</strong>
                <small>{file}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
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
      {!!assets.length && (
        <section className="record-group">
          <h2>Asset files</h2>
          <dl className="workspace-source-list">
            {assets.map(([name, files]) => (
              <div key={name}>
                <dt>{assetLabel(name)}</dt>
                <dd><ul className="workspace-file-list">{files.map((file, index) => <li key={index}>{file}</li>)}</ul></dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {!colors.length && !logos.length && !assets.length && <p className="record-empty">No brand assets saved yet.</p>}
    </div>
  );
}
