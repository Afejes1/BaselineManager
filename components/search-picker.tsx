"use client";

import { useMemo, useState } from "react";

export type SearchPickerItem = {
  id: string;
  label: string;
  detail?: string;
  status?: string;
};

type SearchPickerProps = {
  label: string;
  items: SearchPickerItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  emptyLabel: string;
  help?: string;
  disabled?: boolean;
  maxResults?: number;
};

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function SearchPicker({ label, items, value, onChange, placeholder, emptyLabel, help, disabled = false, maxResults = 12 }: SearchPickerProps) {
  const [query, setQuery] = useState("");
  const selected = items.find((item) => item.id === value) || null;
  const matches = useMemo(() => {
    const term = normalized(query);
    if (!term) return [];
    return items
      .filter((item) => normalized(`${item.label} ${item.detail || ""} ${item.status || ""}`).includes(term))
      .sort((left, right) => {
        const leftExact = normalized(left.label).startsWith(term) ? 0 : 1;
        const rightExact = normalized(right.label).startsWith(term) ? 0 : 1;
        return leftExact - rightExact || left.label.localeCompare(right.label);
      })
      .slice(0, maxResults);
  }, [items, maxResults, query]);

  function choose(id: string) {
    onChange(id);
    setQuery("");
  }

  return <div className="search-picker">
    <label className="modal-field" htmlFor={`${label.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}-search`}>
      {label}
      <span className="search">
        <span aria-hidden="true">⌕</span>
        <input
          id={`${label.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}-search`}
          type="search"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches.length) {
              event.preventDefault();
              choose(matches[0].id);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
      </span>
    </label>
    {selected ? <div className="search-picker-selection">
      <div>
        <span>Selected</span>
        <strong>{selected.label}</strong>
        {selected.detail || selected.status ? <small>{[selected.detail, selected.status].filter(Boolean).join(" · ")}</small> : null}
      </div>
      <button type="button" className="text-action" disabled={disabled} onClick={() => choose("")}>Clear</button>
    </div> : <p className="search-picker-help">{help || "Start typing to find a record."}</p>}
    {query.trim() ? <div className="search-picker-results" role="listbox" aria-label={`${label} results`}>
      {matches.map((item) => <button key={item.id} type="button" role="option" aria-selected={item.id === value} disabled={disabled} onClick={() => choose(item.id)}>
        <strong>{item.label}</strong>
        {item.detail || item.status ? <small>{[item.detail, item.status].filter(Boolean).join(" · ")}</small> : null}
      </button>)}
      {!matches.length ? <p>{emptyLabel}. Search by identifier, title, type, release, or owner.</p> : null}
      {matches.length === maxResults ? <p>Showing the first {maxResults} matches. Refine the search to narrow the list.</p> : null}
    </div> : null}
  </div>;
}
