# GenAI.mil grounded assistant

The assistant is an optional, operator-invoked decision-support feature. It is
not a system of record, an evidence repository, or a decision authority.

## What it does

The **Ask GenAI.mil** card appears on Initiative, Change Request, Product, and
Platform pages. Each request is independent—there is no retained chat history.
When asked, the app builds bounded context from the current object and its
explicit relationships. For example, an Initiative request includes its linked
Change Requests, Objectives, estimates, affected-object effects, requirements,
acceptance, milestones, dependencies, linked records, and eligible supporting
documents. Product and Platform requests additionally include fielding and
infrastructure context.

The model is instructed to distinguish incumbent-reported source information,
Government assessment, and adjudicated Government decisions. It must identify
missing data instead of filling gaps with assumed facts.

## Enable it deliberately

With the app stopped, configure the assistant once for this local workspace:

```powershell
npm run local:genai:configure
```

The command asks once for the complete approved OpenAI-compatible
chat-completions endpoint, model identifier, and active API key. It writes them
to `.a2o-secrets\genai-mil.runtime.env`, which is ACL-protected, excluded from
Git, and loaded automatically by later `npm run local:start` commands. It never
tests the endpoint or sends a request during setup or startup. To replace an
expired/deactivated key, stop the app and run the command again.

The endpoint must be on `https://genai.mil` or a `*.genai.mil` host. The
endpoint, model, and key are never sent to the browser. Nothing is sent to
GenAI.mil in the background: an outbound call is made only after the operator
presses **Ask GenAI.mil**.

If the key is deactivated or expires, the app reports that it must be refreshed;
the workspace is not changed. The endpoint is intentionally not probed at
startup.

For an AWS Workspace proxy that uses an approved private CA, set
`NODE_EXTRA_CA_CERTS` to the trusted CA PEM path before starting Node. Do not
disable TLS verification with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Prompts, notes, and proposed changes

- **Starter prompts** are available per page type. You may write a custom
  prompt and save it for that page type.
- **Save analysis scratchpad** stores a deliberate, user-selected copy of the
  question, response, model name, grounded-context summary, and any proposals.
  It is explicitly labelled analysis only—not source evidence, a Government
  assessment, or an adjudicated decision.
- The model may suggest a **create Initiative**, **update Initiative**,
  **save Objective**, or **save milestone** action. It never executes one
  itself. The user must review the fields and press **Apply reviewed change**.
  The existing server-side validators, role checks, relation checks, and audit
  trail still apply. An incomplete or invalid proposal is rejected without
  altering the data.

This first implementation intentionally does not use semantic search,
embeddings, Bedrock, a live external-system connector, or an uncontrolled agent
loop. The assistant reasons over the explicit current record graph supplied for
the page you are viewing.
