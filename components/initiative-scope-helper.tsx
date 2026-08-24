export function InitiativeScopeHelper() {
  return <aside className="initiative-scope-helper" aria-labelledby="initiative-scope-helper-title">
    <div className="initiative-scope-helper-heading"><span className="eyebrow">SCOPE HELPER</span><h3 id="initiative-scope-helper-title">Keep the outcome, affected object, and evidence boundary separate.</h3><p>An Initiative organizes the Government decision and evidence. It does not itself change a Platform or Product.</p></div>
    <div className="initiative-scope-helper-grid">
      <article><strong>1. Initiative title = Government outcome</strong><p><b>Modernize PMA platform</b> is valid when modernization itself is the decision. If the decision is operational availability, use an outcome title such as <b>Reduce PMA downtime and sustainment risk</b>, and describe modernization as the desired approach.</p></article>
      <article><strong>2. Affected object = linked MCP</strong><p>For a whole-platform effort, add <b>Platform → PMA</b> as an affected object on the linked Change Request. Add a Product only when that Product changes in its own right; do not use a Product as a stand-in for the Platform.</p></article>
      <article><strong>3. Technical scope = derived, not selected here</strong><p>After you link Change Requests, the Initiative derives its scope from their affected-object links and Objective effect attributions. A Platform effect stays one Platform effect. Individual baseline records count only when a Change Request explicitly links those records.</p></article>
    </div>
  </aside>;
}
