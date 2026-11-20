/** Shows saved brand and playbook details and their focused edit forms. */

import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";

import { Loading } from "@/components/ui";
import { WorkspaceRecordEditor } from "@/components/workspace-record-editor";
import { requireUser } from "@/lib/dal";
import { loadAgentWorkspace, workspaceId, type SavedBrand } from "@/lib/server/agent-workspace";

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
  const editing = query.edit === "1";
  const isBrand = record && "knowledge" in record;
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
          {query.saved === "1" && !editing && <p className="workspace-save-status" role="status">{isBrand ? "Brand saved." : "Strategy saved."}</p>}
          {editing ? (
            isBrand
              ? <WorkspaceRecordEditor collection="brands" path={path} record={record} />
              : <WorkspaceRecordEditor collection="playbooks" path={path} record={record} />
          ) : (
            <div className="workspace-overview">
              {relatedBrand && (
                <dl className="workspace-facts">
                  <div><dt>Brand</dt><dd><Link href={"/workspace/brands/" + relatedBrand.id}>{relatedBrand.name}</Link></dd></div>
                </dl>
              )}
              <section>
                <h2>{isBrand ? "Brand knowledge" : "Strategy"}</h2>
                <p className="workspace-record-copy">{isBrand ? record.knowledge || "No brand knowledge saved yet." : record.strategy || "No strategy saved yet."}</p>
              </section>
              {isBrand && <BrandAssets brand={record} />}
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

function BrandAssets({ brand }: { brand: SavedBrand }) {
  const colors = Object.entries(brand.palette);
  const assets = [
    ["Logos", Object.values(brand.logos)],
    ...Object.entries(brand.assets).map(([name, files]) => [name.charAt(0).toUpperCase() + name.slice(1), files] as const),
  ] as const;
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
      {assets.some(([, items]) => items.length > 0) && (
        <section>
          <h2>Assets</h2>
          <dl className="workspace-facts">
            {assets.filter(([, items]) => items.length > 0).map(([name, items]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd><ul className="workspace-file-list">{items.map((item, index) => <li key={index}>{item}</li>)}</ul></dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}
