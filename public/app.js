// ---------- state ----------
let lastResumeText = "";
let lastJdText = "";
let lastResult = null; // includes .id from the server
let originalMatchScore = null; // baseline score from the first match, for delta comparison after edits
let selectedTemplateId = localStorage.getItem("fitcheck_template") || "classic";

const TEMPLATE_META = {
  classic: { name: "Classic", description: "Centered serif header, thin section rules. Traditional and safe for conservative industries. Black and white, ATS-friendly." },
  modern: { name: "Modern", description: "Sans-serif, bold section headings, no rule lines. Reads clean for tech/product roles. Black and white, ATS-friendly." },
  compact: { name: "Compact", description: "Tight spacing and smaller type to fit more onto one page, minimal styling. Black and white, ATS-friendly." },
};

// ---------- tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    if (btn.dataset.tab === "archive") loadArchiveList();
    if (btn.dataset.tab === "templates") renderTemplateCards();
  });
});

function switchTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.id !== `tab-${tabName}`));
  if (tabName === "templates") renderTemplateCards();
}

// ---------- match ----------
const runBtn = document.getElementById("runBtn");
const statusMsg = document.getElementById("statusMsg");
const results = document.getElementById("results");

runBtn.addEventListener("click", async () => {
  const resumeText = document.getElementById("resumeText").value.trim();
  const jdText = document.getElementById("jdText").value.trim();
  const resumeFile = document.getElementById("resumeFile").files[0];
  const jdFile = document.getElementById("jdFile").files[0];

  if (!resumeText && !resumeFile) return setStatus(statusMsg, "Add a resume first.");
  if (!jdText && !jdFile) return setStatus(statusMsg, "Add a job description first.");

  const formData = new FormData();
  if (resumeFile) formData.append("resume", resumeFile);
  else formData.append("resumeText", resumeText);
  if (jdFile) formData.append("jd", jdFile);
  else formData.append("jdText", jdText);

  runBtn.disabled = true;
  setStatus(statusMsg, "Reading both documents and scoring the match…");
  results.classList.add("hidden");
  document.getElementById("revisedBlock").classList.add("hidden");

  try {
    const res = await fetch("/api/match", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      setStatus(statusMsg, data.error || "Something went wrong.");
      runBtn.disabled = false;
      return;
    }

    // Keep plain-text copies for the revise step (files aren't re-readable from input elements)
    lastResumeText = resumeText || "(uploaded file)";
    lastJdText = jdText || "(uploaded file)";
    lastResult = data;
    originalMatchScore = data.match_score ?? null;

    renderResults(data);
    document.getElementById("recheckResult").classList.add("hidden");
    setStatus(statusMsg, "");
  } catch (err) {
    setStatus(statusMsg, "Network error — is the server running?");
  } finally {
    runBtn.disabled = false;
  }
});

function setStatus(el, text) {
  el.textContent = text;
}

function renderResults(data) {
  document.getElementById("scoreValue").textContent = data.match_score ?? "—";
  document.getElementById("scoreFill").style.width = `${data.match_score ?? 0}%`;
  document.getElementById("scoreSummary").textContent = data.summary || "";

  fillList("strengthsList", data.strengths);
  fillList("gapsList", data.gaps);

  fillChips("keywordMatches", data.keyword_matches, "match");
  fillChips("keywordMissing", data.missing_keywords, "missing");

  const tbody = document.querySelector("#editsTable tbody");
  tbody.innerHTML = "";
  (data.suggested_edits || []).forEach((edit) => {
    const tr = document.createElement("tr");
    const tdSection = document.createElement("td");
    tdSection.textContent = edit.section || "";
    const tdSuggestion = document.createElement("td");
    tdSuggestion.textContent = edit.suggestion || "";
    tr.appendChild(tdSection);
    tr.appendChild(tdSuggestion);
    tbody.appendChild(tr);
  });

  document.getElementById("atsRisk").textContent = data.ats_risk || "unknown";
  document.getElementById("atsNotes").textContent = data.ats_notes || "";

  results.classList.remove("hidden");
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fillList(id, items) {
  const el = document.getElementById(id);
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
}

function fillChips(id, items, cls) {
  const el = document.getElementById(id);
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const span = document.createElement("span");
    span.className = `chip ${cls}`;
    span.textContent = item;
    el.appendChild(span);
  });
}

// ---------- apply suggested edits ----------
const applyEditsBtn = document.getElementById("applyEditsBtn");
const applyStatus = document.getElementById("applyStatus");
const revisedBlock = document.getElementById("revisedBlock");
const revisedTextArea = document.getElementById("revisedText");

applyEditsBtn.addEventListener("click", async () => {
  if (!lastResult) return;
  if (lastResumeText === "(uploaded file)") {
    setStatus(applyStatus, "Applying edits needs pasted resume text — paste your resume into the box and re-run the match.");
    return;
  }

  applyEditsBtn.disabled = true;
  setStatus(applyStatus, "Rewriting your resume with the suggested edits…");

  try {
    const res = await fetch("/api/revise", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: lastResult.id,
        resumeText: lastResumeText,
        jdText: lastJdText,
        suggestedEdits: lastResult.suggested_edits || [],
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(applyStatus, data.error || "Could not revise the resume.");
      return;
    }

    revisedTextArea.value = data.revisedText;
    revisedBlock.classList.remove("hidden");
    revisedBlock.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus(applyStatus, "");
    document.getElementById("recheckResult").classList.add("hidden"); // clear any stale recheck from a prior edit
  } catch {
    setStatus(applyStatus, "Network error while revising.");
  } finally {
    applyEditsBtn.disabled = false;
  }
});

// ---------- re-check match score (after applying edits) ----------
const recheckBtn = document.getElementById("recheckBtn");
const recheckStatus = document.getElementById("recheckStatus");
const recheckResult = document.getElementById("recheckResult");

recheckBtn.addEventListener("click", async () => {
  const revisedResumeText = revisedTextArea.value.trim();
  if (!revisedResumeText) {
    setStatus(recheckStatus, "Nothing to check yet — apply edits first.");
    return;
  }
  if (!lastJdText || lastJdText === "(uploaded file)") {
    setStatus(recheckStatus, "Re-checking needs the original job description as text — re-run the match with pasted JD text first.");
    return;
  }

  recheckBtn.disabled = true;
  setStatus(recheckStatus, "Re-scoring the revised resume against the job description…");
  recheckResult.classList.add("hidden");

  try {
    const formData = new FormData();
    formData.append("resumeText", revisedResumeText);
    formData.append("jdText", lastJdText);

    const res = await fetch("/api/match", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) {
      setStatus(recheckStatus, data.error || "Could not re-check the match.");
      return;
    }

    renderRecheckResult(data);
    setStatus(recheckStatus, "");
  } catch {
    setStatus(recheckStatus, "Network error while re-checking.");
  } finally {
    recheckBtn.disabled = false;
  }
});

function renderRecheckResult(data) {
  const newScore = data.match_score ?? null;
  let deltaHtml = "";

  if (newScore !== null && originalMatchScore !== null) {
    const delta = newScore - originalMatchScore;
    const cls = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
    const sign = delta > 0 ? "+" : "";
    deltaHtml = `<span class="recheck-delta ${cls}">${sign}${delta} from original ${originalMatchScore}</span>`;
  }

  recheckResult.innerHTML = `
    <div class="recheck-score-row">
      <span class="recheck-score-value">${newScore ?? "—"}<span class="recheck-score-unit">/100</span></span>
      ${deltaHtml}
    </div>
    <p class="recheck-summary">${escapeHtml(data.summary || "")}</p>
  `;
  recheckResult.classList.remove("hidden");
}

// ---------- export ----------
async function withButtonLoading(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function exportText(text, format, button) {
  const doExport = async () => {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, format, filename: "revised-resume", templateId: selectedTemplateId }),
    });
    if (!res.ok) {
      alert("Export failed.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revised-resume.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  if (button) await withButtonLoading(button, "Formatting…", doExport);
  else await doExport();
}

// Plain export (no resume template) — used for cover letters, which are a simple business letter, not a resume layout.
async function exportPlainText(text, format, baseFilename, button) {
  const doExport = async () => {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, format, filename: baseFilename }),
    });
    if (!res.ok) {
      alert("Export failed.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseFilename}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  if (button) await withButtonLoading(button, "Preparing…", doExport);
  else await doExport();
}

document.getElementById("exportDocxBtn").addEventListener("click", (e) => {
  exportText(revisedTextArea.value, "docx", e.currentTarget);
});
document.getElementById("exportPdfBtn").addEventListener("click", (e) => {
  exportText(revisedTextArea.value, "pdf", e.currentTarget);
});

document.getElementById("changeTemplateLink").addEventListener("click", (e) => {
  e.preventDefault();
  switchTab("templates");
});

function updateActiveTemplateLabel() {
  const label = document.getElementById("activeTemplateLabel");
  if (label) label.textContent = TEMPLATE_META[selectedTemplateId]?.name || selectedTemplateId;
}
updateActiveTemplateLabel();

// ---------- templates ----------
function renderTemplateCards() {
  const container = document.getElementById("templateCards");
  container.innerHTML = "";

  Object.entries(TEMPLATE_META).forEach(([id, meta]) => {
    const card = document.createElement("div");
    card.className = `template-card${id === selectedTemplateId ? " selected" : ""}`;
    card.innerHTML = `
      <div class="template-preview tp-${id}">
        ${previewMarkup(id)}
      </div>
      <h4>${meta.name}</h4>
      <p>${meta.description}</p>
      <button class="template-select-btn">${id === selectedTemplateId ? "Selected" : "Use this template"}</button>
    `;
    card.addEventListener("click", () => {
      selectedTemplateId = id;
      localStorage.setItem("fitcheck_template", id);
      updateActiveTemplateLabel();
      renderTemplateCards();
    });
    container.appendChild(card);
  });
}

function previewMarkup(id) {
  if (id === "modern") {
    return `
      <div class="p-line p-name"></div>
      <div class="p-line p-sub"></div>
      <div class="p-line p-heading"></div>
      <div class="p-line" style="width:90%"></div>
      <div class="p-line" style="width:75%"></div>
      <div class="p-line p-heading" style="margin-top:10px"></div>
      <div class="p-line" style="width:85%"></div>
      <div class="p-line" style="width:60%"></div>
    `;
  }
  if (id === "compact") {
    return `
      <div class="p-line p-name"></div>
      <div class="p-rule"></div>
      <div class="p-line p-heading"></div>
      <div class="p-line" style="width:95%"></div>
      <div class="p-line" style="width:80%"></div>
      <div class="p-line p-heading" style="margin-top:6px"></div>
      <div class="p-line" style="width:90%"></div>
      <div class="p-line" style="width:70%"></div>
      <div class="p-line" style="width:65%"></div>
    `;
  }
  // classic (default)
  return `
    <div class="p-line p-name"></div>
    <div class="p-line p-sub"></div>
    <div class="p-rule"></div>
    <div class="p-line p-heading"></div>
    <div class="p-line" style="width:90%"></div>
    <div class="p-line" style="width:70%"></div>
    <div class="p-line p-heading" style="margin-top:10px"></div>
    <div class="p-line" style="width:85%"></div>
    <div class="p-line" style="width:55%"></div>
  `;
}

// ---------- archive ----------
const archiveList = document.getElementById("archiveList");
const archiveEmpty = document.getElementById("archiveEmpty");
const archiveDetail = document.getElementById("archiveDetail");
const archiveDetailBody = document.getElementById("archiveDetailBody");

async function loadArchiveList() {
  archiveDetail.classList.add("hidden");
  archiveList.classList.remove("hidden");
  const res = await fetch("/api/archive");
  const entries = await res.json();

  archiveList.innerHTML = "";
  if (entries.length === 0) {
    archiveEmpty.classList.remove("hidden");
    return;
  }
  archiveEmpty.classList.add("hidden");

  entries.forEach((entry) => {
    const div = document.createElement("div");
    div.className = "archive-item";
    div.innerHTML = `
      <div class="archive-item-main">
        <div class="archive-item-title">${escapeHtml(entry.title)}</div>
        <div class="archive-item-date">${new Date(entry.timestamp).toLocaleString()}</div>
      </div>
      ${entry.hasRevision ? '<span class="archive-item-badge">Revised</span>' : ""}
      ${entry.hasCoverLetter ? '<span class="archive-item-badge">Cover letter</span>' : ""}
      <div class="archive-item-score">${entry.match_score ?? "—"}</div>
    `;
    div.addEventListener("click", () => loadArchiveDetail(entry.id));
    archiveList.appendChild(div);
  });
}

async function loadArchiveDetail(id) {
  const res = await fetch(`/api/archive/${id}`);
  if (!res.ok) return;
  const entry = await res.json();

  archiveList.classList.add("hidden");
  archiveDetail.classList.remove("hidden");

  const r = entry.result || {};
  archiveDetailBody.innerHTML = `
    <div class="archive-detail-section">
      <h4>${escapeHtml(entry.title)} — ${new Date(entry.timestamp).toLocaleString()}</h4>
      <div class="score-number" style="font-size:40px;">${r.match_score ?? "—"}<span class="score-unit">/100</span></div>
      <p>${escapeHtml(r.summary || "")}</p>
    </div>
    <div class="archive-detail-section">
      <h4>Where it lined up</h4>
      <ul>${(r.strengths || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
    </div>
    <div class="archive-detail-section">
      <h4>Where it fell short</h4>
      <ul>${(r.gaps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
    </div>
    ${entry.revisedText ? `
    <div class="archive-detail-section">
      <h4>Revised resume</h4>
      <textarea class="revised-textarea" readonly>${escapeHtml(entry.revisedText)}</textarea>
      <div class="export-row">
        <button class="archive-export-docx">Download .docx</button>
        <button class="archive-export-pdf">Download .pdf</button>
      </div>
    </div>` : ""}
    ${entry.coverLetter ? `
    <div class="archive-detail-section">
      <h4>Cover letter</h4>
      <textarea class="revised-textarea" readonly>${escapeHtml(entry.coverLetter)}</textarea>
      <div class="export-row">
        <button class="archive-export-cover-docx">Download .docx</button>
        <button class="archive-export-cover-pdf">Download .pdf</button>
      </div>
    </div>` : ""}
    <div class="archive-detail-section">
      <button id="archiveDeleteBtn" class="archive-delete" style="border:1px solid;padding:9px 18px;background:#fff;border-radius:2px;cursor:pointer;">Delete this entry</button>
    </div>
  `;

  const docxBtn = archiveDetailBody.querySelector(".archive-export-docx");
  const pdfBtn = archiveDetailBody.querySelector(".archive-export-pdf");
  if (docxBtn) docxBtn.addEventListener("click", (e) => exportText(entry.revisedText, "docx", e.currentTarget));
  if (pdfBtn) pdfBtn.addEventListener("click", (e) => exportText(entry.revisedText, "pdf", e.currentTarget));

  const coverDocxBtn = archiveDetailBody.querySelector(".archive-export-cover-docx");
  const coverPdfBtn = archiveDetailBody.querySelector(".archive-export-cover-pdf");
  if (coverDocxBtn) coverDocxBtn.addEventListener("click", (e) => exportPlainText(entry.coverLetter, "docx", "cover-letter", e.currentTarget));
  if (coverPdfBtn) coverPdfBtn.addEventListener("click", (e) => exportPlainText(entry.coverLetter, "pdf", "cover-letter", e.currentTarget));

  document.getElementById("archiveDeleteBtn").addEventListener("click", async () => {
    if (!confirm("Delete this archived match? This can't be undone.")) return;
    await fetch(`/api/archive/${id}`, { method: "DELETE" });
    loadArchiveList();
  });
}

document.getElementById("archiveBack").addEventListener("click", loadArchiveList);

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------- cover letter ----------
const generateCoverBtn = document.getElementById("generateCoverBtn");
const coverStatus = document.getElementById("coverStatus");
const coverBlock = document.getElementById("coverBlock");
const coverLetterTextArea = document.getElementById("coverLetterText");

generateCoverBtn.addEventListener("click", async () => {
  if (!lastResumeText || !lastJdText) {
    setStatus(coverStatus, "Run a match on the Match tab first — this uses that resume and job description.");
    return;
  }
  if (lastResumeText === "(uploaded file)" || lastJdText === "(uploaded file)") {
    setStatus(coverStatus, "Cover letters need pasted text — paste your resume/JD on the Match tab and re-run, then come back here.");
    return;
  }

  // Prefer the revised resume (post "Apply edits") if one exists — the cover letter should
  // reflect the version you're actually planning to submit, not the pre-edit original.
  const revisedAvailable = revisedTextArea.value.trim().length > 0;
  const resumeForLetter = revisedAvailable ? revisedTextArea.value.trim() : lastResumeText;

  generateCoverBtn.disabled = true;
  setStatus(coverStatus, revisedAvailable ? "Drafting your cover letter from the revised resume…" : "Drafting your cover letter…");

  try {
    const res = await fetch("/api/cover-letter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: lastResult?.id,
        resumeText: resumeForLetter,
        jdText: lastJdText,
        notes: document.getElementById("coverNotes").value.trim(),
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(coverStatus, data.error || "Could not generate the cover letter.");
      return;
    }

    coverLetterTextArea.value = data.coverLetter;
    coverBlock.classList.remove("hidden");
    setStatus(coverStatus, "");
  } catch {
    setStatus(coverStatus, "Network error while generating.");
  } finally {
    generateCoverBtn.disabled = false;
  }
});

document.getElementById("exportCoverDocxBtn").addEventListener("click", (e) => {
  exportPlainText(coverLetterTextArea.value, "docx", "cover-letter", e.currentTarget);
});
document.getElementById("exportCoverPdfBtn").addEventListener("click", (e) => {
  exportPlainText(coverLetterTextArea.value, "pdf", "cover-letter", e.currentTarget);
});
