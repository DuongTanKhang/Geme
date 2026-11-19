import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter } from "../../components/site-footer";
import { SiteHeader } from "../../components/site-header";
import { getStorePolicy } from "../../lib/store-api";
import { absoluteSiteUrl } from "../../lib/seo";
import styles from "./policy-page.module.css";

type Props = { params: Promise<{ slug: string }> };
const policySlugs = new Set(["mua-hang", "doi-tra", "bao-hanh", "bao-mat", "khieu-nai"]);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { policy } = await getStorePolicy(slug);
  const title = policy?.title || "Chính sách GEME";
  return {
    title,
    description: `Thông tin ${title.toLocaleLowerCase("vi")} tại GEME.`,
    alternates: { canonical: `/chinh-sach/${slug}` },
    openGraph: { type: "website", siteName: "GEME", title, description: `Thông tin ${title.toLocaleLowerCase("vi")} tại GEME.`, url: absoluteSiteUrl(`/chinh-sach/${slug}`) },
  };
}

function PolicyBody({ content }: { content: string }) {
  return <div className={styles.body}>{content.split(/\n\s*\n/).filter((block) => block.trim()).map((block, index) => {
    const text = block.trim();
    if (text.startsWith("### ")) return <h3 key={index}>{text.slice(4)}</h3>;
    if (text.startsWith("## ")) return <h2 key={index}>{text.slice(3)}</h2>;
    if (text.startsWith("# ")) return <h2 key={index}>{text.slice(2)}</h2>;
    return <p key={index}>{text}</p>;
  })}</div>;
}

export default async function PolicyPage({ params }: Props) {
  const { slug } = await params;
  if (!policySlugs.has(slug)) notFound();
  const { policy, connected } = await getStorePolicy(slug);
  if (!policy && connected) notFound();

  return <>
    <SiteHeader />
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Đường dẫn"><a href="/">Trang chủ</a><span>/</span><span>Chính sách</span>{policy && <><span>/</span><span>{policy.title}</span></>}</nav>
      <article className={styles.article}>
        <span className={styles.eyebrow}>GEME · THÔNG TIN KHÁCH HÀNG</span>
        <h1>{policy?.title || "Chính sách GEME"}</h1>
        {!connected ? <div className={styles.notice}>Chưa tải được nội dung. Vui lòng thử lại sau.</div> : policy?.status === "DRAFT" ? <div className={styles.notice}><strong>Bản nháp, chưa công bố.</strong> Nội dung này đang được GEME rà soát và sẽ cập nhật sau khi hoàn tất.</div> : policy ? <PolicyBody content={policy.content} /> : null}
      </article>
    </main>
    <SiteFooter variant="catalog" />
  </>;
}
