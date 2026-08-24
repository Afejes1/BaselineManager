export function InitiativeScopeHelper() {
  return <aside className="initiative-scope-helper" aria-labelledby="initiative-scope-helper-title">
    <div className="initiative-scope-helper-heading"><span className="eyebrow">SCOPE HELPER</span><h3 id="initiative-scope-helper-title">Keep the outcome, affected object, and evidence boundary separate.</h3><p>An Initiative organizes the Government decision and evidence. It does not itself change a Platform or Product.</p></div>
    <div className="initiative-scope-helper-grid">
      <article><strong>1. Initiative title = Government outcome</strong><p><b>Modernize PMA platform</b> is valid when modernization itself is the decision. If the decision is operational availability, use an outcome title such as <b>Reduce PMA downtime and sustainment risk</b>, and describe modernization as the desired approach.</p></article>
      <article><strong>2. Affected object = linked MCP</strong><p>For a whole-platform effort, add <b>Platform → PMA</b> as an affected object on the linked Change Request. Add a Product only when that Product changes in its own right; do not use a Product as a stand-in for the Platform.</p></article>
      <article><strong>3. Baseline evidence scope = this form</strong><p>This selector controls the as-is records shown in the Initiative and its one-pager. It is not an assertion that every selected Product is changing or fielded. For a platform-only proposal, use the entire relevant baseline release rather than choosing an unrelated Product as a proxy.</p></article>
    </div>
  </aside>;
}
