# Lockheed Objective Feed

## Purpose

The Lockheed GitLab Pages JSON export is a recurring external-source feed. It
helps an analyst observe what Lockheed reported about Objectives on a given
day: Jira identifier, reported JPO/MCP references, schedule, ROM, percent
complete, domains, and reported dependency references.

It is not a Government decision record, an approved schedule, or a source for
changing the Working Technical Baseline automatically.

## Daily operating sequence

1. Save the supplied JSON file in an approved local location.
2. Open **Import Hub & Quality → Import Objective JSON**.
3. Select the file and enter the source snapshot date.
4. Review every parsed record: new, changed, unchanged, removed, and invalid.
   Approve or skip each valid row. When evidence supports it, select an
   existing governed LM Objective as the explicit canonical mapping.
5. Inspect reported `blocks` and `blocked_by` references in the interactive
   dependency view. Unresolved references are retained rather than guessed.
6. Apply the snapshot.
7. Use the recorded deltas to ask focused questions in the next technical call.
8. Record any Government assessment, dependency decision, estimate, or evidence
   separately on its governed object.

Every applied upload is an immutable receipt. An unchanged daily file is still
useful evidence that the external source was observed and did not change.

### Synthetic smoke test

Fixtures under `examples/lockheed-objective-feed/` are clearly labeled
synthetic and are not Lockheed, Government, GitLab, or program data. Upload
`01-synthetic-day-one.json` and apply it. Upload
`02-synthetic-day-two.json` and inspect Preview before applying it. The second
preview demonstrates added, changed, unchanged, removed, no-JPO, multi-JPO,
and resolved/unresolved dependency cases.

## Source-field interpretation

| Feed field | Meaning in this application |
| --- | --- |
| Root object key | Retained external feed identity; used to resolve feed dependency values such as `13` or `arch_plan_44` |
| `jira` | Lockheed external Objective identifier when supplied |
| `jpo` | Reported JPO/MCP reference; blank, one, or several comma-separated values are valid |
| `blocks`, `blocked_by` | Lockheed-reported dependency references; they may target an Objective feed key or an unresolved external planning reference |
| `target_start`, `target_finish`, `rom`, `percent_complete` | Supplier-reported delivery values. Changes are source deltas, not Government schedule, cost, or progress approval. |
| `domains`, `rel-to`, `roadmap_parent`, `scope`, `funding`, `release`, `overview`, `background` | Retained external context. Values not explicitly modeled remain in the raw immutable item payload. |

The importer accepts `rel-to` and the legacy `cel-to` spelling, and accepts both
`1-n` and `i-n` for the reported item number.

## Relationship rules

- A JPO/MCP value is a reported source association. It does not automatically
  establish Government ownership, funding approval, or a technical effect.
- A missing JPO/MCP is valid. The feed entry remains available for trend and
  dependency analysis.
- A multi-valued JPO/MCP value is retained as multiple source associations.
- The analyst may explicitly link an external feed subject to an existing
  governed LM Objective when evidence supports that decision. This link does
  not alter the governed Objective's owning Change Request or the reported
  JPO/MCP associations.
- A source subject may remain unlinked to a governed LM Objective indefinitely;
  it remains a valid historical source observation.
- A reported `blocks` or `blocked_by` value is not converted to a Government
  dependency unless the analyst records the governed dependency with a basis.

## Portability and recovery

Applied feed snapshots, source items, reported links, dependencies, and deltas
are included in a full `.a2oworkspace` transfer. They are not represented in
the 24-column A2O Tech Stack XLSX exchange file.

For the current prototype, the feed is loaded from a locally selected file. The
application does not fetch the GitLab page directly; that avoids hidden network
access and keeps the air-gapped workflow explicit.
