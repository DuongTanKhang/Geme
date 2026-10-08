"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

type TableOfContentsItem = { id: string; title: string; number: string; level: 2 | 3 };

const normalizeText = (value: string) => value.replace(/\s+/g, " ").trim();

const slugifyHeading = (value: string) => value
  .toLocaleLowerCase("vi")
  .replace(/đ/g, "d")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "muc";

const existingNumber = (value: string) => value.match(/^\s*(\d{1,3}(?:\.\d{1,3})?)\s*[/.–—-]\s*/)?.[1] ?? null;

export function BlogArticleReader({ content, summary, tags }: { content: string; summary: string | null; tags: string[] }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const hasPotentialToc = (content.match(/<h[23](?=[\s>])/gi)?.length || 0) >= 2;
  const [toc, setToc] = useState<TableOfContentsItem[]>([]);
  const [activeId, setActiveId] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;

    // The summary is shown on the cover. If the CMS also repeats it as the first
    // paragraph, remove only that exact duplicate from the rendered body.
    const firstBlock = root.firstElementChild;
    if (summary && firstBlock?.tagName === "P" && normalizeText(firstBlock.textContent || "") === normalizeText(summary)) {
      firstBlock.remove();
    }

    const headings = Array.from(root.querySelectorAll("h2, h3")) as HTMLHeadingElement[];
    const usedIds = new Set<string>();
    let sectionNumber = 0;
    let subsectionNumber = 0;
    const items = headings.map((heading, index) => {
      const level: 2 | 3 = heading.tagName.toLowerCase() === "h3" ? 3 : 2;
      const title = normalizeText(heading.textContent || "") || `Mục ${index + 1}`;
      if (level === 2) {
        sectionNumber += 1;
        subsectionNumber = 0;
      } else subsectionNumber += 1;
      const base = slugifyHeading(title);
      let id = base;
      let duplicateIndex = 2;
      while (usedIds.has(id)) {
        id = `${base}-${duplicateIndex}`;
        duplicateIndex += 1;
      }
      usedIds.add(id);
      heading.id = id;
      const currentNumber = existingNumber(title);
      const number = currentNumber || (level === 2
        ? String(sectionNumber).padStart(2, "0")
        : `${String(sectionNumber).padStart(2, "0")}.${subsectionNumber}`);
      heading.dataset.tocNumber = number;
      if (!currentNumber) heading.dataset.editorialNumber = number;
      else delete heading.dataset.editorialNumber;
      return { id, title, number, level };
    });

    setToc(items);
    setActiveId(items[0]?.id || "");

    if (typeof IntersectionObserver === "undefined" || items.length < 2) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const nextId = visible[0]?.target.id;
      if (nextId) setActiveId(nextId);
    }, { rootMargin: "-18% 0px -72% 0px", threshold: 0 });
    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [content, summary]);

  const jumpTo = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    window.history.replaceState(null, "", `#${encodeURIComponent(id)}`);
    setActiveId(id);
    setMobileOpen(false);
  };

  return <div className={`blog-detail-reading-area${hasPotentialToc ? " has-toc" : ""}`}>
    {toc.length >= 2 && <nav className={`blog-detail-toc${mobileOpen ? " is-open" : ""}`} aria-label="Mục lục bài viết">
      <span className="blog-detail-toc-label">TRONG BÀI VIẾT</span>
      <button className="blog-detail-toc-toggle" type="button" aria-expanded={mobileOpen} aria-controls="blog-detail-toc-list" onClick={() => setMobileOpen((open) => !open)}>
        Trong bài viết <span aria-hidden="true">{mobileOpen ? "−" : "+"}</span>
      </button>
      <div className="blog-detail-toc-list" id="blog-detail-toc-list">
        {toc.map((item) => <a className={`${item.level === 3 ? "is-subheading" : ""}${activeId === item.id ? " is-active" : ""}`} href={`#${item.id}`} onClick={jumpTo(item.id)} key={item.id}>
          <span>{item.number}</span><span>{item.title}</span>
        </a>)}
      </div>
    </nav>}
    {toc.length < 2 && hasPotentialToc && <nav className="blog-detail-toc is-pending" aria-hidden="true"><span className="blog-detail-toc-label">TRONG BÀI VIẾT</span></nav>}

    <article className="blog-detail-article">
      <div ref={contentRef} className="blog-dynamic-content" dangerouslySetInnerHTML={{ __html: content }}/>
      {tags.length > 0 && <div className="blog-dynamic-tags" aria-label="Thẻ bài viết">{tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
    </article>
  </div>;
}
