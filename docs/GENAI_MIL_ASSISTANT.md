# GenAI.mil grounded assistant

The assistant is an optional, operator-invoked decision-support feature. It is
not a system of record, an evidence repository, or a decision authority.

## What it does

The **Ask GenAI.mil** button is in the top action area on Initiative, Change
Request, Product, and Platform pages, next to ordinary record controls. It
opens a focused workspace without sending a model request. Each request is
independent—there is no retained chat history.
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

The default transport is **JSON review proposals**, which is compatible with
the current configuration. If the approved GenAI.mil deployment supports
OpenAI-compatible function tools, you can reconfigure while the app is stopped:

```powershell
npm run local:genai:configure -- -ToolMode native-tools
```

Native tools still only create review cards. They never invoke an external tool
or write a record until the operator presses **Apply reviewed change**. Use
`json-proposals` to return to the known-compatible default.

If the key is deactivated or expires, the app reports that it must be refreshed;
the workspace is not changed. The endpoint is intentionally not probed at
startup.

For an AWS Workspace proxy that uses an approved private CA, set
`NODE_EXTRA_CA_CERTS` to the trusted CA PEM path before starting Node. Do not
disable TLS verification with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Prompts, notes, and proposed changes

- **Starter prompts** are available per page type. The prompt library can save
  a reusable prompt either for that page type or for all assistant pages. It
  can also revise or remove a prompt without touching source data.
- **Save analysis scratchpad** stores a deliberate, user-selected copy of the
  question, response, model name, grounded-context summary, and any proposals.
  It is explicitly labelled analysis only—not source evidence, a Government
  assessment, or an adjudicated decision.
- The model may suggest a **create Initiative**, **update Initiative**,
  **save Objective**, **save milestone**, or **create technical call record**
  action. It never executes one
  itself. The user must review the fields and press **Apply reviewed change**.
  The existing server-side validators, role checks, relation checks, and audit
  trail still apply. A proposal is rejected if its grounded record graph has
  changed since it was returned, or if it is incomplete or invalid.

Model output is rendered through a restricted local Markdown renderer. It does
not render returned HTML, links, images, or embeds. The assistant never
interprets model output as instructions or active content.

This first implementation intentionally does not use semantic search,
embeddings, Bedrock, a live external-system connector, or an uncontrolled agent
loop. The assistant reasons over the explicit current record graph supplied for
the page you are viewing.
