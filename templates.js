// templates.js
// Renders a structured resume object into a styled .docx or .pdf.
//
// ATS-COMPLIANCE RULES followed by every template here (do not violate these
// when editing): single-column flow only; no tables used for layout; no
// shaded/filled color blocks or reversed (light-on-dark) text; no tab-stop
// columns for dates (plain sequential text instead); no text boxes, images,
// or icons; no content in document headers/footers; only standard,
// widely-installed fonts; standard section heading words an ATS parser
// will recognize (Summary, Experience, Skills, Education). No color at all
// — every template is pure black text on white. Visual variety between
// templates comes only from font choice, weight, letter-spacing/case, and
// thin black/gray rule lines — never from color, fills, or multi-column
// positioning.

const { Document, Paragraph, TextRun, AlignmentType, BorderStyle } = require("docx");

const TEMPLATES = {
  classic: {
    name: "Classic",
    description: "Centered serif header, thin section rules. Traditional and safe for conservative industries. Black and white, ATS-friendly single column.",
  },
  modern: {
    name: "Modern",
    description: "Sans-serif, bold section headings, no rule lines. Reads clean for tech/product roles. Black and white, ATS-friendly single column.",
  },
  compact: {
    name: "Compact",
    description: "Tight spacing and smaller type to fit more onto one page, minimal styling. Black and white, ATS-friendly single column.",
  },
};

function joinContact(contact) {
  if (!contact) return "";
  const parts = [contact.email, contact.phone, contact.location, ...(contact.links || [])].filter(Boolean);
  return parts.join("   |   ");
}

function dateRangeLine(exp) {
  return [exp.start, exp.end].filter(Boolean).join(" – ");
}

// ---------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------

function buildDocxDocument(templateId, resume) {
  const builders = { classic: docxClassic, modern: docxModern, compact: docxCompact };
  const build = builders[templateId] || docxClassic;
  return new Document({
    sections: [{ properties: {}, children: build(resume) }],
  });
}

function sectionHeading(text, { size = 22, font = "Georgia", border = true } = {}) {
  return new Paragraph({
    spacing: { before: 220, after: 90 },
    border: border
      ? { bottom: { color: "999999", space: 2, style: BorderStyle.SINGLE, size: 4 } }
      : undefined,
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size, font })],
  });
}

function bulletParagraph(text, { size = 20, font = "Georgia" } = {}) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size, font })],
  });
}

// Single-column, tab-free job header: title/company on one line, plain text
// dates on the line below. No tab stops — sequential plain text only, so an
// ATS parser reads it in the same order a human does, every time.
function experienceBlock(exp, { size = 20, font = "Georgia" } = {}) {
  const lines = [
    new Paragraph({
      spacing: { before: 140, after: 20 },
      children: [
        new TextRun({ text: `${exp.title || ""}${exp.company ? " — " + exp.company : ""}`, bold: true, size: size + 2, font }),
      ],
    }),
  ];
  const dateLine = dateRangeLine(exp);
  if (dateLine || exp.location) {
    lines.push(
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: [exp.location, dateLine].filter(Boolean).join("   ·   "), italics: true, size, font })],
      })
    );
  }
  (exp.bullets || []).forEach((b) => lines.push(bulletParagraph(b, { size, font })));
  return lines;
}

function sharedBody(resume, opts) {
  const children = [];

  if (resume.summary) {
    children.push(sectionHeading("Summary", opts));
    children.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: resume.summary, size: 20, font: opts.font })] }));
  }

  if ((resume.skills || []).length) {
    children.push(sectionHeading("Skills", opts));
    children.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: resume.skills.join(", "), size: 20, font: opts.font })] }));
  }

  if ((resume.experience || []).length) {
    children.push(sectionHeading("Experience", opts));
    resume.experience.forEach((exp) => children.push(...experienceBlock(exp, { font: opts.font, size: opts.bodySize })));
  }

  if ((resume.education || []).length) {
    children.push(sectionHeading("Education", opts));
    resume.education.forEach((ed) => {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: `${ed.degree || ""}${ed.school ? ", " + ed.school : ""}${ed.year ? " — " + ed.year : ""}`, size: 20, font: opts.font })],
        })
      );
    });
  }

  if ((resume.additional || []).length) {
    children.push(sectionHeading("Additional Information", opts));
    resume.additional.forEach((a) => children.push(bulletParagraph(a, { font: opts.font })));
  }

  return children;
}

function docxClassic(resume) {
  const children = [];
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: resume.name || "", bold: true, size: 40, font: "Georgia" })],
    })
  );
  if (resume.title) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [new TextRun({ text: resume.title, italics: true, size: 24, font: "Georgia" })],
      })
    );
  }
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      border: { bottom: { color: "000000", space: 4, style: BorderStyle.SINGLE, size: 6 } },
      children: [new TextRun({ text: joinContact(resume.contact), size: 18, font: "Georgia" })],
    })
  );
  children.push(...sharedBody(resume, { size: 22, font: "Georgia", bodySize: 20, border: true }));
  return children;
}

function docxModern(resume) {
  const children = [];
  children.push(
    new Paragraph({
      spacing: { after: 20 },
      children: [new TextRun({ text: resume.name || "", bold: true, size: 36, font: "Calibri" })],
    })
  );
  if (resume.title) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: resume.title, bold: true, size: 22, font: "Calibri" })],
      })
    );
  }
  children.push(
    new Paragraph({
      spacing: { after: 160 },
      border: { bottom: { color: "000000", space: 4, style: BorderStyle.SINGLE, size: 8 } },
      children: [new TextRun({ text: joinContact(resume.contact), size: 18, font: "Calibri" })],
    })
  );
  children.push(...sharedBody(resume, { size: 22, font: "Calibri", bodySize: 20, border: false }));
  return children;
}

function docxCompact(resume) {
  const children = [];
  children.push(
    new Paragraph({
      spacing: { after: 20 },
      border: { bottom: { color: "000000", space: 2, style: BorderStyle.SINGLE, size: 6 } },
      children: [
        new TextRun({ text: resume.name || "", bold: true, size: 26, font: "Calibri" }),
        new TextRun({ text: resume.title ? "   —   " + resume.title : "", size: 18, font: "Calibri", italics: true }),
      ],
    })
  );
  children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: joinContact(resume.contact), size: 16, font: "Calibri" })] }));
  children.push(...sharedBody(resume, { size: 18, font: "Calibri", bodySize: 18, border: false }));
  return children;
}

// ---------------------------------------------------------------------
// PDF (pdfkit) — `doc` is an already-created, already-piped PDFDocument.
// This function only draws; the caller calls doc.end().
// Single column, plain text flow, black text only — no positioned columns,
// no filled rectangles behind text, no images.
// ---------------------------------------------------------------------

function renderPdf(templateId, resume, doc) {
  const renderers = { classic: pdfClassic, modern: pdfModern, compact: pdfCompact };
  const render = renderers[templateId] || pdfClassic;
  render(resume, doc);
}

function pdfExperienceBlock(doc, exp, { font = "Times-Roman", boldFont = "Times-Bold", size = 11 } = {}) {
  doc.moveDown(0.5);
  doc.font(boldFont).fontSize(size + 1).fillColor("black").text(`${exp.title || ""}${exp.company ? " — " + exp.company : ""}`);
  const dateLine = [exp.location, dateRangeLine(exp)].filter(Boolean).join("   ·   ");
  if (dateLine) doc.font(font).fontSize(size - 1).text(dateLine, { oblique: true });
  doc.font(font).fontSize(size);
  (exp.bullets || []).forEach((b) => doc.text(`•  ${b}`, { indent: 12 }));
}

function pdfSharedBody(resume, doc, opts) {
  const heading = (t) => {
    doc.moveDown(0.6).font(opts.headingFont).fontSize(13).fillColor("black").text(t.toUpperCase());
    if (opts.rule) {
      doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("#999999").stroke();
    }
    doc.moveDown(0.3).fillColor("black").font(opts.font).fontSize(opts.bodySize);
  };

  if (resume.summary) { heading("Summary"); doc.text(resume.summary); }
  if ((resume.skills || []).length) { heading("Skills"); doc.text(resume.skills.join(", ")); }
  if ((resume.experience || []).length) {
    heading("Experience");
    resume.experience.forEach((e) => pdfExperienceBlock(doc, e, { font: opts.font, boldFont: opts.boldFont, size: opts.bodySize }));
  }
  if ((resume.education || []).length) {
    heading("Education");
    resume.education.forEach((ed) => doc.text(`${ed.degree || ""}${ed.school ? ", " + ed.school : ""}${ed.year ? " — " + ed.year : ""}`));
  }
  if ((resume.additional || []).length) { heading("Additional Information"); resume.additional.forEach((a) => doc.text(`•  ${a}`)); }
}

function pdfClassic(resume, doc) {
  doc.font("Times-Bold").fontSize(22).fillColor("black").text(resume.name || "", { align: "center" });
  if (resume.title) doc.font("Times-Italic").fontSize(13).text(resume.title, { align: "center" });
  doc.moveDown(0.3);
  doc.font("Times-Roman").fontSize(10).text(joinContact(resume.contact), { align: "center" });
  doc.moveDown(0.4);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("black").stroke();
  doc.moveDown(0.6);
  pdfSharedBody(resume, doc, { font: "Times-Roman", boldFont: "Times-Bold", headingFont: "Times-Bold", bodySize: 11, rule: true });
}

function pdfModern(resume, doc) {
  doc.font("Helvetica-Bold").fontSize(20).fillColor("black").text(resume.name || "");
  if (resume.title) doc.font("Helvetica-Bold").fontSize(12).text(resume.title);
  doc.font("Helvetica").fontSize(10).text(joinContact(resume.contact));
  doc.moveDown(0.3);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).lineWidth(1.5).strokeColor("black").stroke();
  doc.moveDown(0.5);
  pdfSharedBody(resume, doc, { font: "Helvetica", boldFont: "Helvetica-Bold", headingFont: "Helvetica-Bold", bodySize: 11, rule: false });
}

function pdfCompact(resume, doc) {
  doc.font("Helvetica-Bold").fontSize(16).fillColor("black").text(resume.name || "", { continued: !!resume.title });
  if (resume.title) doc.font("Helvetica-Oblique").fontSize(10).text(`   —   ${resume.title}`);
  doc.moveDown(0.15);
  doc.font("Helvetica").fontSize(9).text(joinContact(resume.contact));
  doc.moveDown(0.3);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor("black").stroke();
  pdfSharedBody(resume, doc, { font: "Helvetica", boldFont: "Helvetica-Bold", headingFont: "Helvetica-Bold", bodySize: 9.5, rule: false });
}

module.exports = { TEMPLATES, buildDocxDocument, renderPdf };
