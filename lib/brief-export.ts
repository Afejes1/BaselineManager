"use client";

import { AlignmentType, Document, ExternalHyperlink, Footer, Header, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { jsPDF } from "jspdf";
import type { ExecutiveBrief } from "./governance-model.js";

const safeName = (title: string) => (title || "Executive-Brief").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "Executive-Brief";
const defaultMarking = "PROGRAM WORKING DATA — DRAFT / UNCONTROLLED";
const handlingMarking = (brief: ExecutiveBrief) => brief.snapshot.handlingMarking || defaultMarking;
const markedMarkdown = (brief: ExecutiveBrief) => brief.bodyMarkdown.includes(handlingMarking(brief)) ? brief.bodyMarkdown : `> **${handlingMarking(brief)}**\n> Snapshot ${brief.snapshot.asOf || brief.updatedAt}.\n\n${brief.bodyMarkdown}`;

export function downloadPreparedBrief(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export type BriefInline = { text: string; bold?: boolean; italics?: boolean; href?: string };
export type BriefMarkdownBlock = { kind: "title" | "heading1" | "heading2" | "quote" | "bullet" | "body" | "blank"; inline: BriefInline[] };

function appendInline(output: BriefInline[], value: BriefInline) {
  if (!value.text) return;
  const previous = output.at(-1);
  if (previous && previous.bold === value.bold && previous.italics === value.italics && previous.href === value.href) previous.text += value.text;
  else output.push(value);
}

function closingDelimiter(input: string, delimiter: string, start: number) {
  for (let index = start; index <= input.length - delimiter.length; index += 1) {
    if (input[index] === "\\") { index += 1; continue; }
    if (input.startsWith(delimiter, index)) return index;
  }
  return -1;
}

export function parseBriefInline(input: string, inherited: Pick<BriefInline, "bold" | "italics"> = {}): BriefInline[] {
  const output: BriefInline[] = [];
  let plain = "";
  const flush = () => { appendInline(output, { text: plain, ...inherited }); plain = ""; };
  for (let index = 0; index < input.length;) {
    if (input[index] === "\\" && index + 1 < input.length && /[\\`*_[\]{}<>#+!|]/.test(input[index + 1])) {
      plain += input[index + 1]; index += 2; continue;
    }
    const delimiter = input.startsWith("**", index) ? "**" : input[index] === "*" || input[index] === "_" ? input[index] : "";
    if (delimiter) {
      const end = closingDelimiter(input, delimiter, index + delimiter.length);
      if (end >= 0) {
        flush();
        const nested = parseBriefInline(input.slice(index + delimiter.length, end), delimiter === "**" ? { ...inherited, bold: true } : { ...inherited, italics: true });
        for (const item of nested) appendInline(output, item);
        index = end + delimiter.length;
        continue;
      }
    }
    if (input[index] === "[") {
      const labelEnd = closingDelimiter(input, "]", index + 1);
      if (labelEnd >= 0 && input[labelEnd + 1] === "(") {
        const targetEnd = closingDelimiter(input, ")", labelEnd + 2);
        if (targetEnd >= 0) {
          flush();
          const href = input.slice(labelEnd + 2, targetEnd).trim();
          const label = parseBriefInline(input.slice(index + 1, labelEnd), inherited);
          for (const item of label) appendInline(output, { ...item, href });
          index = targetEnd + 1;
          continue;
        }
      }
    }
    plain += input[index];
    index += 1;
  }
  flush();
  return output;
}

export function parseBriefMarkdown(markdown: string): BriefMarkdownBlock[] {
  return markdown.split("\n").map((line) => {
    if (!line.trim()) return { kind: "blank", inline: [] };
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) return { kind: heading[1].length === 1 ? "title" : heading[1].length === 2 ? "heading1" : "heading2", inline: parseBriefInline(heading[2]) };
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) return { kind: "quote", inline: parseBriefInline(quote[1]) };
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) return { kind: "bullet", inline: parseBriefInline(bullet[1]) };
    return { kind: "body", inline: parseBriefInline(line) };
  });
}

const plainInline = (inline: BriefInline[]) => inline.map((item) => item.text).join("");

function resolvedHref(value: string) {
  if (/^(?:https?:|mailto:)/i.test(value)) return value;
  if (value.startsWith("/") && typeof window !== "undefined") return new URL(value, window.location.origin).href;
  return null;
}

function docxRuns(inline: BriefInline[]) {
  return inline.map((item) => {
    const link = item.href ? resolvedHref(item.href) : null;
    const run = new TextRun({ text: item.text, bold: item.bold, italics: item.italics, color: link ? "1155CC" : undefined, underline: link ? {} : undefined });
    return link ? new ExternalHyperlink({ link, children: [run] }) : run;
  });
}

function markdownParagraphs(markdown: string, marking: string) {
  return parseBriefMarkdown(markdown).filter((block) => !(block.kind === "quote" && plainInline(block.inline) === marking)).map((block) => {
    if (block.kind === "title") return new Paragraph({ children: docxRuns(block.inline), heading: HeadingLevel.TITLE, spacing: { after: 180 } });
    if (block.kind === "heading1") return new Paragraph({ children: docxRuns(block.inline), heading: HeadingLevel.HEADING_1, spacing: { before: 180, after: 90 } });
    if (block.kind === "heading2") return new Paragraph({ children: docxRuns(block.inline), heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 70 } });
    if (block.kind === "bullet") return new Paragraph({ children: docxRuns(block.inline), bullet: { level: 0 }, spacing: { after: 48 } });
    if (block.kind === "quote") return new Paragraph({ children: docxRuns(block.inline), indent: { left: 360 }, spacing: { after: 80 } });
    if (block.kind === "blank") return new Paragraph({ text: "", spacing: { after: 56 } });
    return new Paragraph({ children: docxRuns(block.inline), spacing: { after: 80 } });
  });
}

export async function prepareBriefDocx(brief: ExecutiveBrief) {
  const marking = handlingMarking(brief);
  const document = new Document({
    sections: [{
      properties: { page: { margin: { top: 900, right: 900, bottom: 900, left: 900 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: marking, bold: true, size: 16 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generated ${brief.snapshot.asOf || brief.updatedAt} · decision-support draft`, size: 14 })] })] }) },
      children: markdownParagraphs(markedMarkdown(brief), marking),
    }],
  });
  const blob = await Packer.toBlob(document);
  return { blob, fileName: `${safeName(brief.title)}.docx` };
}

export function prepareBriefPdf(brief: ExecutiveBrief) {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const marking = handlingMarking(brief);
  const left = 54;
  const right = 558;
  const bottom = 738;
  const markPage = () => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.text(marking, 306, 24, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(`Generated ${brief.snapshot.asOf || brief.updatedAt} · decision-support draft`, 306, 770, { align: "center" });
  };
  markPage();
  let y = 48;
  for (const block of parseBriefMarkdown(markedMarkdown(brief)).filter((item) => !(item.kind === "quote" && plainInline(item.inline) === marking))) {
    const isTitle = block.kind === "title";
    const isHeading = block.kind === "heading1" || block.kind === "heading2";
    const prefix = block.kind === "bullet" ? "• " : "";
    const content = `${prefix}${plainInline(block.inline)}`;
    if (!content.trim()) { y += 10; continue; }
    const x = block.kind === "quote" || block.kind === "bullet" ? left + 14 : left;
    pdf.setFont("helvetica", isTitle || isHeading ? "bold" : block.inline.some((item) => item.italics) ? "italic" : "normal");
    pdf.setFontSize(isTitle ? 18 : block.kind === "heading1" ? 12 : block.kind === "heading2" ? 10.5 : 9.5);
    const lines = pdf.splitTextToSize(content, right - x);
    const lineHeight = isTitle ? 21 : isHeading ? 15 : 12;
    const needed = lines.length * lineHeight + 8;
    if (y + needed > bottom) { pdf.addPage(); markPage(); y = 48; }
    pdf.text(lines, x, y);
    const link = block.inline.find((item) => item.href)?.href;
    const resolved = link ? resolvedHref(link) : null;
    if (resolved && lines.length === 1) pdf.link(x, y - lineHeight + 3, Math.min(pdf.getTextWidth(content), right - x), lineHeight, { url: resolved });
    y += needed;
  }
  return { blob: pdf.output("blob"), fileName: `${safeName(brief.title)}.pdf` };
}

export function prepareBriefMarkdown(brief: ExecutiveBrief) {
  return { blob: new Blob([markedMarkdown(brief)], { type: "text/markdown;charset=utf-8" }), fileName: `${safeName(brief.title)}.md` };
}
