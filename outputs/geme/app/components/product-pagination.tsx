type ProductPaginationProps = {
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  hrefForPage?: (page: number) => string;
};

function getVisiblePages(page: number, pageCount: number) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const start = Math.max(2, Math.min(page - 1, pageCount - 3));
  const end = Math.min(pageCount - 1, start + 3);
  const pages = [1];
  if (start > 2) pages.push(-1);
  for (let value = start; value <= end; value += 1) pages.push(value);
  if (end < pageCount - 1) pages.push(-2);
  pages.push(pageCount);
  return pages;
}

export function ProductPagination({ page, pageCount, onPageChange, hrefForPage }: ProductPaginationProps) {
  if (pageCount <= 1) return null;

  const renderPage = (target: number, label: string, className = "") => hrefForPage
    ? <a href={hrefForPage(target)} className={className} aria-label={label} aria-current={target === page ? "page" : undefined}>{target}</a>
    : <button type="button" className={className} aria-label={label} aria-current={target === page ? "page" : undefined} onClick={() => onPageChange?.(target)}>{target}</button>;

  return <nav className="store-product-pagination" aria-label="Phân trang sản phẩm">
    {page > 1 && (hrefForPage
      ? <a className="store-product-pagination-direction" href={hrefForPage(page - 1)} aria-label="Trang trước">‹</a>
      : <button className="store-product-pagination-direction" type="button" aria-label="Trang trước" onClick={() => onPageChange?.(page - 1)}>‹</button>)}
    {getVisiblePages(page, pageCount).map((value, index) => value < 0
      ? <span key={`ellipsis-${index}`} aria-hidden="true">…</span>
      : <span key={value}>{renderPage(value, `Trang ${value}`, value === page ? "is-current" : "")}</span>)}
    {page < pageCount && (hrefForPage
      ? <a className="store-product-pagination-direction" href={hrefForPage(page + 1)} aria-label="Trang sau">›</a>
      : <button className="store-product-pagination-direction" type="button" aria-label="Trang sau" onClick={() => onPageChange?.(page + 1)}>›</button>)}
  </nav>;
}
