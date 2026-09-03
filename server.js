// server.js
// Backend for the resume <-> job description matcher.
// Keeps the Anthropic API key server-side (never expose it in a mobile/web client).

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require("docx");
const PDFDocument = require("pdfkit");
const { TEMPLATES, buildDocxDocument, renderPdf } = require("./templates");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-sonnet-4-6";

// --- tiny local archive (JSON file, no DB needed at this scale) ---------

const DATA_DIR = path.join(__dirname, "data");
const ARCHIVE_FILE = path.join(DATA_DIR, "archive.json");

function ensureArchive() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ARCHIVE_FILE)) fs.writeFileSync(ARCHIVE_FILE, "[]");
}

function readArchive() {
  ensureArchive();
  try {
    return JSON.parse(fs.readFileSync(ARCHIVE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeArchive(entries) {
  ensureArchive();
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(entries, null, 2));
}

function guessTitle(jdText) {
  const firstLine = (jdText || "").split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (!firstLine) return "Untitled role";
  return firstLine.length > 70 ? firstLine.slice(0, 70) + "…" : firstLine;
}

// --- helpers -----------------------------------------------------------

async function extractText(file) {
  if (!file) return "";
  const { originalname, buffer, mimetype } = file;

  if (mimetype === "application/pdf" || originalname.toLowerCase().endsWith(".pdf")) {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    originalname.toLowerCase().endsWith(".docx")
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  return buffer.toString("utf-8");
}

function buildMatchPrompt(resumeText, jdText) {
  return `You are an expert technical recruiter and resume coach. Compare the RESUME against the JOB DESCRIPTION and respond with ONLY valid JSON — no markdown fences, no preamble — matching this exact shape:

{
  "match_score": <integer 0-100>,
  "summary": "<2-3 sentence overall verdict>",
  "strengths": ["<specific match point>", "..."],
  "gaps": ["<specific missing or weak area>", "..."],
  "keyword_matches": ["<keyword/skill found in both>", "..."],
  "missing_keywords": ["<important JD keyword/skill absent from resume>", "..."],
  "suggested_edits": [
    {"section": "<resume section>", "suggestion": "<concrete rewrite or addition, specific not generic>"}
  ],
  "ats_risk": "<low|medium|high>",
  "ats_notes": "<1-2 sentences on formatting/keyword risk for applicant tracking systems>"
}

Be specific and evidence-based — cite actual phrases/requirements from the JD and actual experience from the resume rather than generic advice. Do not invent resume content that isn't there.

RESUME:
"""
${resumeText}
"""

JOB DESCRIPTION:
"""
${jdText}
"""`;
}

function buildRevisePrompt(resumeText, suggestedEdits, jdText) {
  const editsList = (suggestedEdits || [])
    .map((e, i) => `${i + 1}. [${e.section || "General"}] ${e.suggestion}`)
    .join("\n");

  return `You are an expert resume editor. Rewrite the RESUME below, applying the SUGGESTED EDITS as faithfully as you can. Keep everything else from the original resume intact — do not remove real experience, do not invent employers, titles, or dates that aren't in the original. Only strengthen wording, add relevant keywords that are truthfully supported by the person's real background, and restructure bullet points for clarity and impact.

Respond with ONLY the full revised resume as plain text (no markdown, no commentary, no headers like "Here is the revised resume"). Preserve section structure (e.g. Summary, Experience, Skills, Education) as plain text headings.

ORIGINAL RESUME:
"""
${resumeText}
"""

SUGGESTED EDITS TO APPLY:
${editsList || "(none provided — lightly tighten wording for the target role below)"}

TARGET JOB DESCRIPTION (for context only, do not copy from it):
"""
${jdText || "(not provided)"}
"""`;
}

function buildStructurePrompt(resumeText) {
  return `Parse the RESUME below into structured JSON. Respond with ONLY valid JSON — no markdown fences, no commentary — matching this exact shape:

{
  "name": "<full name>",
  "title": "<current/target headline title, or empty string if none>",
  "contact": {"email": "", "phone": "", "location": "", "links": ["<linkedin/portfolio urls if present>"]},
  "summary": "<summary/objective paragraph, or empty string if none>",
  "experience": [
    {"title": "", "company": "", "location": "", "start": "", "end": "", "bullets": ["", "..."]}
  ],
  "skills": ["<individual skill/keyword>", "..."],
  "education": [
    {"degree": "", "school": "", "year": ""}
  ],
  "additional": ["<any other notable line — certifications, patents, awards, publications — one per entry>"]
}

Use only content that is actually present in the resume — do not invent anything. If a field isn't present, use an empty string or empty array as appropriate.

RESUME:
"""
${resumeText}
"""`;
}

async function structureResume(resumeText) {
  const raw = await callClaude(buildStructurePrompt(resumeText), 3000);
  return extractJson(raw);
}

// Cache structured-resume results by content hash so exporting the same
// text twice (e.g. .docx then .pdf, or re-downloading) doesn't re-run the
// Claude call each time. Simple bounded in-memory cache — fine for a
// single-user local server, not meant to survive a restart.
const STRUCTURE_CACHE = new Map();
const STRUCTURE_CACHE_MAX = 30;

async function structureResumeCached(resumeText) {
  const key = crypto.createHash("sha256").update(resumeText).digest("hex");
  if (STRUCTURE_CACHE.has(key)) return STRUCTURE_CACHE.get(key);

  const structured = await structureResume(resumeText);

  if (STRUCTURE_CACHE.size >= STRUCTURE_CACHE_MAX) {
    const oldestKey = STRUCTURE_CACHE.keys().next().value;
    STRUCTURE_CACHE.delete(oldestKey);
  }
  STRUCTURE_CACHE.set(key, structured);
  return structured;
}

function buildCoverLetterPrompt(resumeText, jdText, notes) {
  return `You are an expert cover letter writer. Write a compelling, specific cover letter for this candidate applying to this role. Ground every claim in the actual resume — do not invent employers, titles, or achievements that aren't there. Reference concrete requirements from the job description and connect them to concrete experience from the resume, rather than generic enthusiasm.

Keep it to 3-4 paragraphs: an opening that names the role and a specific hook, one or two body paragraphs connecting real experience to the role's actual requirements, and a brief closing. No placeholder brackets like [Company Name] — infer the company/role name from the job description text itself if possible, and if it truly isn't stated, write around it naturally instead of leaving a blank.

Respond with ONLY the cover letter text — no subject line, no commentary, no markdown.

${notes ? `ADDITIONAL NOTES FROM THE CANDIDATE TO INCORPORATE:\n${notes}\n` : ""}
RESUME:
"""
${resumeText}
"""

JOB DESCRIPTION:
"""
${jdText}
"""`;
}

async function callClaude(prompt, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error("Anthropic API error");
    err.details = errText;
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  return data.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function extractJson(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(slice);
}

// --- routes: match -------------------------------------------------------

app.post("/api/match", upload.fields([{ name: "resume" }, { name: "jd" }]), async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY. Set it in .env." });
    }

    let resumeText = req.body.resumeText || "";
    let jdText = req.body.jdText || "";

    if (req.files?.resume?.[0]) resumeText = await extractText(req.files.resume[0]);
    if (req.files?.jd?.[0]) jdText = await extractText(req.files.jd[0]);

    if (!resumeText.trim() || !jdText.trim()) {
      return res.status(400).json({ error: "Both a resume and a job description are required." });
    }

    const raw = await callClaude(buildMatchPrompt(resumeText, jdText), 4000);

    let parsed;
    try {
      parsed = extractJson(raw);
    } catch {
      return res.status(502).json({ error: "Could not parse model output", raw });
    }

    // Save to archive
    const entries = readArchive();
    const id = crypto.randomUUID();
    entries.unshift({
      id,
      timestamp: new Date().toISOString(),
      title: guessTitle(jdText),
      match_score: parsed.match_score ?? null,
      resumeText,
      jdText,
      result: parsed,
      revisedText: null,
      coverLetter: null,
    });
    writeArchive(entries);

    res.json({ ...parsed, id });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Unexpected server error", details: err.details });
  }
});

// --- routes: revise (apply suggested edits) ------------------------------

app.post("/api/revise", async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY. Set it in .env." });
    }

    const { id, resumeText, suggestedEdits, jdText } = req.body;
    if (!resumeText || !resumeText.trim()) {
      return res.status(400).json({ error: "resumeText is required." });
    }

    const revisedText = (await callClaude(buildRevisePrompt(resumeText, suggestedEdits, jdText), 3000)).trim();

    if (id) {
      const entries = readArchive();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx !== -1) {
        entries[idx].revisedText = revisedText;
        writeArchive(entries);
      }
    }

    res.json({ revisedText });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Unexpected server error", details: err.details });
  }
});

// --- routes: cover letter --------------------------------------------------

app.post("/api/cover-letter", async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY. Set it in .env." });
    }

    const { id, resumeText, jdText, notes } = req.body;
    if (!resumeText || !resumeText.trim() || !jdText || !jdText.trim()) {
      return res.status(400).json({ error: "resumeText and jdText are required." });
    }

    const coverLetter = (await callClaude(buildCoverLetterPrompt(resumeText, jdText, notes), 1500)).trim();

    if (id) {
      const entries = readArchive();
      const idx = entries.findIndex((e) => e.id === id);
      if (idx !== -1) {
        entries[idx].coverLetter = coverLetter;
        writeArchive(entries);
      }
    }

    res.json({ coverLetter });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || "Unexpected server error", details: err.details });
  }
});

// --- routes: export (docx / pdf) -----------------------------------------

app.post("/api/export", async (req, res) => {
  try {
    const { text, format, filename, templateId } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "text is required." });
    const safeName = (filename || "resume").replace(/[^a-z0-9\-_]/gi, "_");

    // Templated path: parse the resume into structured data, then render with the chosen visual style.
    if (templateId) {
      let structured;
      try {
        structured = await structureResumeCached(text);
      } catch (err) {
        console.error("Structuring failed, falling back to plain export:", err);
      }

      if (structured) {
        if (format === "docx") {
          const doc = buildDocxDocument(templateId, structured);
          const buffer = await Packer.toBuffer(doc);
          res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
          return res.send(buffer);
        }
        if (format === "pdf") {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
          const doc = new PDFDocument({ margin: 50 });
          doc.pipe(res);
          renderPdf(templateId, structured, doc);
          doc.end();
          return;
        }
        return res.status(400).json({ error: "format must be 'docx' or 'pdf'." });
      }
      // fall through to plain-text rendering below if structuring failed
    }

    if (format === "docx") {
      const paragraphs = text.split("\n").map((line) => {
        const trimmed = line.trim();
        const looksLikeHeading = trimmed.length > 0 && trimmed.length < 40 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
        return new Paragraph({
          heading: looksLikeHeading ? HeadingLevel.HEADING_2 : undefined,
          children: [new TextRun(line)],
        });
      });
      const doc = new Document({ sections: [{ children: paragraphs }] });
      const buffer = await Packer.toBuffer(doc);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.docx"`);
      return res.send(buffer);
    }

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);
      doc.font("Helvetica").fontSize(11);
      text.split("\n").forEach((line) => {
        const trimmed = line.trim();
        const looksLikeHeading = trimmed.length > 0 && trimmed.length < 40 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
        if (looksLikeHeading) {
          doc.moveDown(0.5).font("Helvetica-Bold").fontSize(13).text(line);
          doc.font("Helvetica").fontSize(11);
        } else {
          doc.text(line);
        }
      });
      doc.end();
      return;
    }

    res.status(400).json({ error: "format must be 'docx' or 'pdf'." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Export failed", details: String(err) });
  }
});

// --- routes: archive -------------------------------------------------------

app.get("/api/archive", (_req, res) => {
  const entries = readArchive().map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    title: e.title,
    match_score: e.match_score,
    hasRevision: !!e.revisedText,
    hasCoverLetter: !!e.coverLetter,
  }));
  res.json(entries);
});

app.get("/api/archive/:id", (req, res) => {
  const entries = readArchive();
  const entry = entries.find((e) => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Not found" });
  res.json(entry);
});

app.delete("/api/archive/:id", (req, res) => {
  const entries = readArchive();
  const next = entries.filter((e) => e.id !== req.params.id);
  writeArchive(next);
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/templates", (_req, res) => {
  res.json(Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Resume matcher running on http://localhost:${PORT}`));
