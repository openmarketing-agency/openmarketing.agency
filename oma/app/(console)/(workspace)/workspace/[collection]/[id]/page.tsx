/** Shows saved brand and playbook details and their focused edit forms. */

import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Pencil, Tag } from "lucide-react";

import { BrandAssets } from "@/components/brand-assets";
import { BrandChannels, BrandResearch } from "@/components/brand-sources";
import { DesignedDocument } from "@/components/designed-document";
import { Loading } from "@/components/ui";
import { WorkspaceDocument } from "@/components/workspace-document";
import { WorkspaceRecordEditor } from "@/components/workspace-record-editor";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, loadBrandDocument, workspaceId, type SavedBrand } from "@/lib/server/agent-workspace";
import { readDocumentLayout, type DocumentLayoutState } from "@/lib/server/document-layout";
import { parseWorkspaceDocument, type WorkspaceDocument as ParsedDocument } from "@/lib/workspace-document";
import "@/components/workspace-record-detail.css";
import "@/components/workspace-document.css";
import "@openuidev/react-ui/components.css";
import "@/components/designed-document.css";
import { Button } from "@/components/ui/button";

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
  const user = await requireUser();
  const { records, error } = await loadAgentWorkspace();
  const record = records?.[collection].find((item) => item.id === id);
  if (!record && !error) notFound();

  const path = "/workspace/" + collection + "/" + id;
  const brand = record && "knowledge" in record ? record : undefined;
  const playbook = record && "strategy" in record ? record : undefined;
  const editingKnowledge = query.edit === "knowledge" && Boolean(brand?.knowledgeRevision);
  const editing = query.edit === "1" || editingKnowledge;
  const requestedDocument = typeof query.document === "string" ? query.document : undefined;
  const view = requestedDocument !== undefined ? "research" : brandViews.find(({ id }) => id === query.view)?.id ?? "overview";
  // The research reader opens its first document, so reading never starts with an extra click.
  const documentId = requestedDocument ?? (view === "research" ? brand?.documents?.[0]?.id : undefined);
  const sectionPath = brand ? brandViewPath(path, view) : path;
  const selectedDocument = brand && !editing && documentId !== undefined ? await loadBrandDocument(id, documentId) : undefined;
  const knowledgeDocument = brand && view === "overview" ? parseWorkspaceDocument(brand.knowledge) : undefined;
  const strategyDocument = playbook ? parseWorkspaceDocument(playbook.strategy) : undefined;
  const layoutFor = (markdown?: string) => markdown?.trim() ? readDocumentLayout(user.id, markdown) : undefined;
  const knowledgeLayout = knowledgeDocument && !editing ? layoutFor(brand?.knowledge) : undefined;
  const strategyLayout = strategyDocument && !editing ? layoutFor(playbook?.strategy) : undefined;
  const researchLayout = layoutFor(selectedDocument?.document?.content);
  const relatedBrand = playbook && records?.brands.find(({ id }) => id === playbook.brandId);
  const relatedPlaybooks = brand ? records?.playbooks.filter(({ brandId }) => brandId === brand.id) ?? [] : [];
  const relatedCampaigns = playbook ? records?.campaigns.filter(({ playbookId }) => playbookId === playbook.id) ?? [] : [];
  const brandMark = brand?.logos.mark;
  const markAsset = brand?.assetFiles?.find(({ category, label, mediaType }) => category === "logos" && label === "mark" && mediaType.startsWith("image/"));
  const markUrl = markAsset ? "/api" + path + "/assets/" + markAsset.id
    : brandMark && isPreviewableLogo("mark", brandMark) ? "/api" + path + "/logos/mark" : undefined;

  return (
    <div className="agent-playbook-page record-detail">
      <Link className="back-link" href="/dashboard"><ArrowLeft size={14} aria-hidden="true" /> Campaigns</Link>
      {record ? (
        <>
          <header className="record-heading">
            <div className="record-identity">
              <span className="record-mark" aria-hidden="true">
                {markUrl
                  ? <Image src={markUrl} alt="" width={36} height={36} unoptimized />
                  : brand ? <Tag size={23} /> : <BookOpen size={23} />}
              </span>
              <div>
                <h1>{record.name}</h1>
                {record.description && <p>{record.description}</p>}
              </div>
            </div>
            {!editing && (
              <Button asChild variant="outline"><Link href={sectionPath + (sectionPath === path ? "?" : "&") + "edit=1"}>
                <Pencil size={15} aria-hidden="true" /> {brand ? "Edit brand" : "Edit strategy"}
              </Link></Button>
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
              {brand && knowledgeDocument && (
                <RecordColumns related={relatedPlaybooks.length > 0 && (
                  <RecordLinks heading="Playbooks" items={relatedPlaybooks} base="/workspace/playbooks/" />
                )}>
                  <BrandKnowledge brand={brand} path={path} document={knowledgeDocument} layout={knowledgeLayout} />
                </RecordColumns>
              )}
              {brand && view === "channels" && <BrandChannels brand={brand} />}
              {brand && view === "research" && <BrandResearch brand={brand} path={path} selected={selectedDocument} layout={researchLayout} />}
              {brand && view === "assets" && <BrandAssets brand={brand} />}
              {playbook && strategyDocument && (
                <RecordColumns related={(relatedBrand || relatedCampaigns.length > 0) && (
                  <>
                    {relatedBrand && <RecordLinks heading="Brand" items={[relatedBrand]} base="/workspace/brands/" />}
                    {relatedCampaigns.length > 0 && <RecordLinks heading="Campaigns" items={relatedCampaigns} base="/campaigns/" />}
                  </>
                )}>
                  <section className="record-structured" aria-labelledby="strategy-heading">
                    <div className="record-section-heading"><h2 id="strategy-heading">Strategy</h2></div>
                    <MaybeDesigned target={{ kind: "playbook", id: playbook.id }} state={strategyLayout}>
                      <WorkspaceDocument document={strategyDocument} name={playbook.name} empty="No strategy saved yet." />
                    </MaybeDesigned>
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

/** Gives the document the full page width, with related records as a compact row of links above it. */
function RecordColumns({ children, related }: { children: ReactNode; related: ReactNode }) {
  return (
    <div className="record-single">
      {related && <nav className="record-related-row" aria-label="Related workspace records">{related}</nav>}
      {children}
    </div>
  );
}

function RecordLinks({ heading, items, base }: { heading: string; items: { id: string; name: string }[]; base: string }) {
  return (
    <p className="record-related-links">
      <span>{heading}</span>
      {items.map(({ id, name }) => <Link key={id} href={base + id}>{name}<ArrowRight size={14} aria-hidden="true" /></Link>)}
    </p>
  );
}

/** Offers the OpenUI design only for documents with saved content. */
function MaybeDesigned({ target, state, children }: { target: Parameters<typeof DesignedDocument>[0]["target"]; state?: DocumentLayoutState; children: ReactNode }) {
  return state ? <DesignedDocument target={target} layout={state.layout} generating={state.generating}>{children}</DesignedDocument> : children;
}

function BrandKnowledge({ brand, path, document, layout }: { brand: SavedBrand; path: string; document: ParsedDocument; layout?: DocumentLayoutState }) {
  return (
    <section className="record-structured" id="brand-knowledge" aria-labelledby="knowledge-heading">
      <div className="record-section-heading">
        <h2 id="knowledge-heading">Brand knowledge</h2>
        {brand.knowledgeRevision && (
          <Button asChild variant="outline"><Link href={path + "?edit=knowledge"}>
            <Pencil size={14} aria-hidden="true" /> Edit knowledge
          </Link></Button>
        )}
      </div>
      {brand.knowledgeFile !== undefined && !brand.knowledgeRevision
        ? <p className="form-error">The saved brand knowledge file could not be read.</p>
        : <MaybeDesigned target={{ kind: "brand", id: brand.id }} state={layout}>
          <WorkspaceDocument document={document} name={brand.name} empty="No brand knowledge saved yet." />
        </MaybeDesigned>}
      {brand.knowledgeFile && <small className="record-knowledge-source">Source: {brand.knowledgeFile}</small>}
    </section>
  );
}
