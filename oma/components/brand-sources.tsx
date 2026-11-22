/** Displays saved brand channels, public research signals, and referenced workspace documents. */

import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, FileText } from "lucide-react";

import { WorkspaceText } from "@/components/workspace-text";
import type { SavedBrand, SavedBrandDocument } from "@/lib/server/agent-workspace";

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

export function BrandResearch({ brand, path, selected }: Props) {
  const hasDocuments = Boolean(brand.designSource || brand.documents?.length);
  const researchPath = path + "?view=research";
  return (
    <div className="record-groups" id="brand-research">
      {selected ? (
        <section id="brand-document" className="record-reading record-document" aria-labelledby="document-title">
          <Link href={researchPath} className="back-link"><ArrowLeft size={14} aria-hidden="true" /> All documents</Link>
          <h2 id="document-title">{selected.document ? labelFor(selected.document.title) : "Brand document"}</h2>
          {selected.document
            ? <WorkspaceText text={selected.document.content} html={selected.document.html} empty="This document is empty." />
            : <p className="form-error" role="alert">{selected.error}</p>}
        </section>
      ) : hasDocuments && (
        <section className="record-group workspace-sources">
          <div className="record-section-heading">
            <h2>Documents</h2>
            {brand.designSource && <ExternalLink url={brand.designSource} label="Design system source" />}
          </div>
          {!!brand.documents?.length && (
            <ul className="workspace-document-list">
              {brand.documents.map(({ id, title, path: file }) => (
                <li key={file}>
                  <Link href={researchPath + "&document=" + id + "#brand-document"} prefetch={false}>
                    <FileText size={17} aria-hidden="true" />
                    <span>{labelFor(title)}<small>{file}</small></span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {!!brand.repositories?.length && (
        <section className="record-group workspace-sources">
          <h2>Repositories</h2>
          <dl className="workspace-source-list">
            {brand.repositories.map(({ label, url, commit }, index) => (
              <div key={index}>
                <dt>{labelFor(label)}</dt>
                <dd><ExternalLink url={url} />
                  {commit && <span className="workspace-source-status" title={commit}>Analyzed commit {commit.slice(0, 7)}</span>}
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
            {brand.competitors.map(({ label, url, sources }, index) => (
              <div key={index}>
                <dt>{label}</dt>
                <dd>
                  {url && <ExternalLink url={url} />}
                  {sources.map((source, i) => <ExternalLink key={i} url={source} label={"Source " + (i + 1)} />)}
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
            {brand.signals.map(({ label, status, signal }) => (
              <div key={label}>
                <dt>{labelFor(label)}</dt>
                <dd><span className="workspace-source-status">{signalLabels[status]}</span>{signal && <p>{signal}</p>}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {!selected && !hasDocuments && !brand.repositories?.length && !brand.competitors?.length && !brand.signals?.length && (
        <p className="record-empty">No brand research saved yet.</p>
      )}
    </div>
  );
}
