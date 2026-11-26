/** Displays saved brand channels, public research signals, and referenced workspace documents. */

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight } from "lucide-react";

import { DesignedDocument } from "@/components/designed-document";
import { ResearchNav } from "@/components/research-nav";
import { WorkspaceDocument } from "@/components/workspace-document";
import type { DocumentLayoutState } from "@/lib/server/document-layout";
import type { SavedBrand, SavedBrandDocument } from "@/lib/server/agent-workspace";
import { parseWorkspaceDocument } from "@/lib/workspace-document";

const discoveryLabels = {
  verified: "Verified", not_checked: "Unchecked", not_found: "Not found",
};
const signalLabels = {
  observed: "Observed", not_checked: "Unchecked", not_detected: "Not detected",
};

function labelFor(value: string) {
  const text = value.replaceAll(/[-_]/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function publicUrl(value: string) {
  const url = URL.parse(value);
  return url && (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url : undefined;
}

function ExternalLink({ url, label }: { url: string; label?: string }) {
  const parsed = publicUrl(url);
  if (!parsed) return null;
  return <a href={parsed.href} target="_blank" rel="noreferrer">
    {label ?? parsed.hostname}<ArrowUpRight size={13} aria-hidden="true" />
  </a>;
}

type Discovery = NonNullable<SavedBrand["channels"]>[number];
function Discoveries({ heading, items }: { heading: string; items: Discovery[] | undefined }) {
  if (!items?.length) return null;
  return (
    <section className="record-group workspace-sources">
      <h2>{heading}</h2>
      <dl className="workspace-source-list record-discoveries">
        {items.map(({ label, status, url, feedUrl, signupUrl }, index) => (
          <div key={index}>
            <dt>{labelFor(label)}</dt>
            <dd>
              {url && <ExternalLink url={url} />}
              {feedUrl && <ExternalLink url={feedUrl} label="Feed" />}
              {signupUrl && <ExternalLink url={signupUrl} label="Sign up" />}
              <span className="record-discovery-status" data-verified={status === "verified"}>{discoveryLabels[status]}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type Props = {
  brand: SavedBrand;
  path: string;
  selected?: { document?: SavedBrandDocument; error?: string };
  layout?: DocumentLayoutState;
};

export function BrandChannels({ brand }: { brand: SavedBrand }) {
  return (
    <div className="record-groups" id="brand-channels">
      <Discoveries heading="Channels" items={brand.channels} />
      <Discoveries heading="Launches" items={brand.launches} />
      {!brand.channels?.length && !brand.launches?.length && <p className="record-empty">No channels or launches saved yet.</p>}
    </div>
  );
}

function ResearchDocument({ brandId, document, layout }: { brandId: string; document: SavedBrandDocument; layout?: DocumentLayoutState }) {
  const standard = <WorkspaceDocument document={parseWorkspaceDocument(document.content)} name={labelFor(document.title)}
    empty="This document is empty." contents />;
  return layout
    ? <DesignedDocument target={{ kind: "research", id: brandId, documentId: document.id }} layout={layout.layout}
      generating={layout.generating}>{standard}</DesignedDocument>
    : standard;
}

export function BrandResearch({ brand, path, selected, layout }: Props) {
  const hasDocuments = Boolean(brand.designSource || brand.documents?.length || brand.internalDocumentation);
  const researchPath = path + "?view=research";
  const documentHref = (id: string) => researchPath + "&document=" + id + "#brand-document";
  const reference = (file: string, label: string) => {
    const document = brand.documents?.find(({ path }) => path === file.split("#")[0]);
    return document
      ? <Link href={documentHref(document.id)} title={file} prefetch={false}>{label}</Link>
      : <small>{file}</small>;
  };
  const items = (brand.documents ?? []).map(({ id, title, path: file }) => ({ id, label: labelFor(title), file }));
  const index = items.findIndex(({ id }) => id === selected?.document?.id);
  const previous = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 ? items[index + 1] : undefined;
  return (
    <div className="record-groups" id="brand-research">
      {(brand.designSource || brand.internalDocumentation) && (
        <p className="research-meta">
          {brand.designSource && <ExternalLink url={brand.designSource} label="Design system source" />}
          {brand.internalDocumentation && <>Internal documentation: {labelFor(brand.internalDocumentation.mode)} · {reference(brand.internalDocumentation.index, "Read index")}</>}
        </p>
      )}
      {items.length > 0 && (
        <div className="research-reader">
          <div className="research-toolbar">
            <ResearchNav items={items} selectedId={selected?.document?.id} basePath={researchPath} />
            {index >= 0 && items.length > 1 && (
              <nav className="research-pager" aria-label="Document pages">
                {previous
                  ? <Link href={researchPath + "&document=" + previous.id} scroll={false} prefetch={false} aria-label={"Previous: " + previous.label}><ArrowLeft size={15} aria-hidden="true" /></Link>
                  : <span aria-hidden="true"><ArrowLeft size={15} /></span>}
                <span>{index + 1} of {items.length}</span>
                {next
                  ? <Link href={researchPath + "&document=" + next.id} scroll={false} prefetch={false} aria-label={"Next: " + next.label}><ArrowRight size={15} aria-hidden="true" /></Link>
                  : <span aria-hidden="true"><ArrowRight size={15} /></span>}
              </nav>
            )}
          </div>
          <section id="brand-document" className="research-document record-structured" aria-labelledby="document-title">
            <header className="research-document-heading">
              <h2 id="document-title">{selected?.document ? labelFor(selected.document.title) : "Brand document"}</h2>
              {selected?.document && <small className="record-knowledge-source">{selected.document.path}</small>}
            </header>
            {selected?.document
              ? <ResearchDocument brandId={brand.id} document={selected.document} layout={layout} />
              : <p className="form-error" role="alert">{selected?.error ?? "Choose a document to read."}</p>}
          </section>
        </div>
      )}
      {!!brand.repositories?.length && (
        <section className="record-group workspace-sources">
          <h2>Repositories</h2>
          <dl className="workspace-source-list">
            {brand.repositories.map(({ label, url, commit, notes }, index) => (
              <div key={index}>
                <dt>{labelFor(label)}</dt>
                <dd><ExternalLink url={url} />
                  {commit && <span className="workspace-source-status" title={commit}>Analyzed commit {commit.slice(0, 7)}</span>}
                  {notes && reference(notes, "Read repository notes")}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {!!brand.competitors?.length && (
        <section className="record-group workspace-sources">
          <h2>Competitors</h2>
          <dl className="workspace-source-list">
            {brand.competitors.map(({ id, label, url, sources, report }, index) => (
              <div key={index}>
                <dt>{label}{id && id !== label && <small>{id}</small>}</dt>
                <dd>
                  {url && <ExternalLink url={url} />}
                  {sources.map((source, i) => <ExternalLink key={i} url={source} label={"Source " + (i + 1)} />)}
                  {report && reference(report, "Read competitor report")}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {!!brand.signals?.length && (
        <section className="record-group workspace-sources">
          <h2>Public website signals</h2>
          <dl className="workspace-source-list">
            {brand.signals.map(({ label, status, signal, evidence }) => (
              <div key={label}>
                <dt>{labelFor(label)}</dt>
                <dd>
                  <span className="workspace-source-status">{signalLabels[status]}</span>{signal && <p>{signal}</p>}
                  {evidence && reference(evidence, evidence.includes("#") ? "Read evidence · " + evidence.split("#")[1] : "Read evidence")}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {!hasDocuments && !brand.repositories?.length && !brand.competitors?.length && !brand.signals?.length && (
        <p className="record-empty">No brand research saved yet.</p>
      )}
    </div>
  );
}
