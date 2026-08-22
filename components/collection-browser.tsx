"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";

type SearchableText<T> = (item: T) => string;

export type CollectionBrowser<T> = {
  query: string;
  setQuery: (value: string) => void;
  page: number;
  setPage: (value: number) => void;
  pageSize: number;
  setPageSize: (value: number) => void;
  pageCount: number;
  start: number;
  end: number;
  total: number;
  filteredItems: T[];
  pageItems: T[];
};

function normalized(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

/**
 * Keeps large source registers bounded without changing their underlying
 * records or an analyst's import decisions.  The calling page owns any
 * domain-specific filter; this hook handles search and pagination only.
 */
export function useCollectionBrowser<T>(items: T[], searchableText: SearchableText<T>, initialPageSize = 50): CollectionBrowser<T> {
  const [query, setQueryState] = useState("");
  const [page, setPageState] = useState(0);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const filteredItems = useMemo(() => {
    const term = normalized(query);
    if (!term) return items;
    return items.filter((item) => normalized(searchableText(item)).includes(term));
  }, [items, query, searchableText]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = filteredItems.length ? safePage * pageSize + 1 : 0;
  const end = Math.min((safePage + 1) * pageSize, filteredItems.length);
  const pageItems = useMemo(() => filteredItems.slice(safePage * pageSize, safePage * pageSize + pageSize), [filteredItems, pageSize, safePage]);

  return {
    query,
    setQuery: (value) => { setQueryState(value); setPageState(0); },
    page: safePage,
    setPage: (value) => setPageState(Math.max(0, Math.min(value, pageCount - 1))),
    pageSize,
    setPageSize: (value) => { setPageSizeState(value); setPageState(0); },
    pageCount,
    start,
    end,
    total: items.length,
    filteredItems,
    pageItems,
  };
}

type CollectionControlsProps = {
  browser: Pick<CollectionBrowser<unknown>, "query" | "setQuery" | "pageSize" | "setPageSize" | "total" | "filteredItems">;
  itemLabel: string;
  placeholder: string;
  children?: ReactNode;
};

export function CollectionControls({ browser, itemLabel, placeholder, children }: CollectionControlsProps) {
  return <div className="collection-controls">
    <label className="search collection-search"><span aria-hidden="true">⌕</span><input type="search" value={browser.query} onChange={(event) => browser.setQuery(event.target.value)} placeholder={placeholder} /></label>
    {children}
    <label className="collection-page-size">Rows<select aria-label={`Rows per page for ${itemLabel}`} value={browser.pageSize} onChange={(event) => browser.setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label>
    <span className="collection-count">{browser.filteredItems.length.toLocaleString()} of {browser.total.toLocaleString()} {itemLabel}</span>
  </div>;
}

type CollectionPagerProps = {
  browser: Pick<CollectionBrowser<unknown>, "page" | "setPage" | "pageCount" | "start" | "end" | "filteredItems" | "total">;
  itemLabel: string;
};

export function CollectionPager({ browser, itemLabel }: CollectionPagerProps) {
  const noun = browser.filteredItems.length === 1 ? itemLabel.replace(/s$/, "") : itemLabel;
  return <footer className="collection-pagination">
    <span>{browser.filteredItems.length ? `Showing ${browser.start.toLocaleString()}–${browser.end.toLocaleString()} of ${browser.filteredItems.length.toLocaleString()} ${noun}` : `No ${itemLabel} match the current view`}{browser.filteredItems.length !== browser.total ? ` · ${browser.total.toLocaleString()} loaded` : ""}</span>
    <div><button className="ghost-button" type="button" disabled={browser.page === 0} onClick={() => browser.setPage(browser.page - 1)}>Previous</button><strong>Page {browser.page + 1} of {browser.pageCount}</strong><button className="ghost-button" type="button" disabled={browser.page >= browser.pageCount - 1} onClick={() => browser.setPage(browser.page + 1)}>Next</button></div>
  </footer>;
}
