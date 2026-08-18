"use client";

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { jsPDF } from "jspdf";
import type { ExecutiveBrief } from "./governance-model";

const safeName = (title: string) => (title || "Executive-Brief").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "Executive-Brief";

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function markdownParagraphs(markdown: string) {
  return markdown.split("\n").map((line) => {
    if (line.startsWith("# ")) return new Paragraph({ text: line.slice(2), heading: HeadingLevel.TITLE, spacing: { after: 180 } });
    if (line.startsWith("## ")) return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_1, spacing: { before: 180, after: 90 } });
    if (line.startsWith("- ")) return new Paragraph({ text: line.slice(2), bullet: { level: 0 }, spacing: { after: 48 } });
    if (!line.trim()) return new Paragraph({ text: "", spacing: { after: 56 } });
    return new Paragraph({ children: [new TextRun(line)], spacing: { after: 80 } });
  });
}

export async function downloadBriefDocx(brief: ExecutiveBrief) {
  const document = new Document({
    sections: [{ properties: { page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } } }, children: markdownParagraphs(brief.bodyMarkdown) }],
  });
  const blob = await Packer.toBlob(document);
  downloadBlob(blob, `${safeName(brief.title)}.docx`);
}

export function downloadBriefPdf(brief: ExecutiveBrief) {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const left = 54;
  const right = 558;
  const bottom = 738;
  let y = 58;
  for (const raw of brief.bodyMarkdown.split("\n")) {
    const isTitle = raw.startsWith("# ");
    const isHeading = raw.startsWith("## ");
    const content = raw.replace(/^#{1,2}\s/, "");
    if (!content.trim()) { y += 10; continue; }
    pdf.setFont("helvetica", isTitle || isHeading ? "bold" : "normal");
    pdf.setFontSize(isTitle ? 18 : isHeading ? 12 : 9.5);
    const lines = pdf.splitTextToSize(content, right - left);
    const needed = lines.length * (isTitle ? 21 : isHeading ? 15 : 12) + 8;
    if (y + needed > bottom) { pdf.addPage(); y = 58; }
    pdf.text(lines, left, y);
    y += needed;
  }
  pdf.save(`${safeName(brief.title)}.pdf`);
}

export function downloadBriefMarkdown(brief: ExecutiveBrief) {
  downloadBlob(new Blob([brief.bodyMarkdown], { type: "text/markdown;charset=utf-8" }), `${safeName(brief.title)}.md`);
}

