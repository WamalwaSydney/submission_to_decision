// Technical Report — Submission-to-Decision Traceability Platform
// Build: typst compile docs/TECHNICAL_REPORT.typ docs/TECHNICAL_REPORT.pdf

#let accent = rgb("#1f5fbf")
#let title = "Technical Report — Submission-to-Decision Traceability Platform"
#let author = "Sydney Erik Wamalwa"

#set document(title: title, author: author)
#set page(
  paper: "a4",
  margin: (x: 1.7cm, top: 2.0cm, bottom: 1.6cm),
  header: context {
    set text(size: 8pt, fill: luma(110))
    grid(columns: (1fr, auto), [Technical Report — Submission-to-Decision Traceability Platform], [#author])
    line(length: 100%, stroke: 0.4pt + luma(170))
  },
  footer: context align(center, text(size: 8pt, counter(page).display())),
)
#set text(size: 8.9pt, lang: "en")
#set par(justify: true, leading: 0.52em, spacing: 0.75em)
#set heading(numbering: "1")
#show heading.where(level: 1): it => {
  v(0.35em)
  text(size: 12.5pt, weight: "bold", fill: accent, it)
  v(0.05em)
}
#show raw: set text(size: 7.6pt)
#set table(stroke: 0.4pt + luma(185), inset: (x: 4pt, y: 2.6pt))
#show table.cell.where(y: 0): set text(weight: "bold")
#show table: set par(justify: false)  // narrow cells read better left-aligned

#align(center)[
  #text(size: 17pt, weight: "bold", fill: accent)[Technical Report] \
  #text(size: 10.5pt)[Submission-to-Decision Traceability Platform] \
  #text(size: 8.5pt, fill: luma(110))[#author · 14 November 2026]
]

= Scope Alignment and Feature Validation

The approved workflow is implemented end to end. Citizens send views on tracked bills and receive hash-chained receipts. Committee reports are read and split into entries. An AI proposes which entry answers each view, and a moderator confirms or rejects every proposal before any outcome is shown. This release extends the trace beyond the committee report, which was the earlier stopping point. Each submission recorded in a report can now be followed to what the House decided in the Committee of the Whole House, and to whether it appears in the final Act. A citizen's own receipt joins that trace once a moderator confirms its match. Coverage is the National Assembly and the two pilot counties, Nairobi City and Trans Nzoia. *Status* below is local validation on 14 November; the production database now holds the same trace, while the newest code awaits deployment (Section 3, item 5).

#table(
  columns: (1.15fr, 1.9fr, 1.05fr, 2.1fr),
  fill: (_, y) => if y == 0 { rgb("#e8eef9") },
  table.header[Planned feature][Purpose][Status][Evidence / caveat],
  [National Assembly tracking], [Bills, stage and dated history from Parliament's Bills Tracker; the bill text itself.], [Implemented, tested], [`sync_legislation.py`: 726 bills in total. Bill PDFs come from Parliament's Bills pages, or Mzalendo's copy when Parliament lists none: 304 of 321 National Assembly and Senate bills (proposals excluded) have their text.],
  [County assemblies], [Nairobi and Trans Nzoia bills, their Acts, committee reports on bills, and county committees.], [Implemented, tested], [`sync_county_bills.py`, `act_library.py`: 114 + 4 records, 28 committees. Act PDFs and dates of assent come from Nairobi's own Acts page; 60 county Act texts are loaded. 49 Nairobi committee reports on bills, 23 linked to their bill and read by OCR. Assemblies publish no bill stages, so none are invented.],
  [Participation and submission], [Accept views only while a committee takes them; one view per bill, editable; memoranda upload.], [Implemented, tested], [Only the "Public participation" stage accepts views. The sync sets it while a call for memoranda is open and moves the bill on when the call closes; a clerk recording a call does the same. On 14 November no call from Parliament was open (the newest closed on 31 August), so no real bill accepted views; a clearly labelled local demo bill is open for the demonstration.],
  [Receipt integrity], [Append-only SHA-256 chain; edits as new versions; full and single-receipt verification.], [Implemented, tested], [`receipt_service.py`, database triggers. Hosted chain (7 November): 10 of 10 receipts verify after the demo-data cleanup.],
  [Calls for memoranda], [Parliament's calls, with window, mode and bill-text access.], [Implemented, tested], [34 notices. Shown as a status on each bill with a "Has a call for views" filter; the separate notices page was retired.],
  [Matching and review], [Propose which report entry answers each platform view; a moderator decides.], [Implemented; 82% accuracy on 60 labelled cases], [`llm_matching_service.py`, `ModeratorPages.tsx`. Precision 91–97%, recall 78–80% (text-similarity baseline: 15% and 18%).],
  [What each report records], [Who made each submission in a committee report, what they asked, and the committee's decision.], [Implemented, tested], [`report_analysis_service.py`: 1,072 submissions in 110 reports on 77 bills, including Nairobi's. Names are recovered from merged table cells; 255 (24%) stay "Not named in the report" because the report never attributes them, and the stakeholders it lists are shown instead.],
  [What the House decided ], [Each adopted recommendation's fate in the Committee of the Whole House.], [Implemented, tested; 17 bills], [`house_trace_service.py`, Hansard via Mzalendo. 243 recommendations: 105 agreed, 1 negatived, 83 change not made (clause passed unchanged or no amendment), 54 could not confirm. No debate found for 11 passed bills, mostly Senate or older sittings.],
  [Whether it became law], [Check each adopted recommendation against the final Act; read the Act with those passages highlighted.], [Implemented, tested; 14 Acts], [`act_trace_service.py`. 142 bills linked to their Act; 88 Act texts loaded (28 national, 60 county). 256 recommendations checked: 167 in the Act, 29 not, 60 could not confirm. Act reader at `/bills/:id/act`.],
  [Receipt to law ], [A citizen's receipt follows its matched report entry through the House and into the Act.], [Implemented, tested], [Receipt timeline "From this view to the law"; matched report entries marked "Also sent on this platform". Needs a confirmed match, so no hosted receipt shows it yet.],
  [Roles, stages, offline], [Role home pages; Clerk's Office limited to one committee; abuse limits; plain-language stages; offline drafts.], [Implemented, tested], [`ensure_committee_scope`, `rate_limit.py`, `submission_stage.py`, `utils/offline.ts`; `test_security.py`.],
)

Outside this release: forwarding submissions to committee clerks (so the platform cannot yet prove delivery); a moderator sign-off for the AI's report, House and Act readings (they are checked automatically, but no person confirms them); automatic downloads from Kenya Law; Senate and older House debates that Mzalendo does not hold; an interface in Kiswahili (notifications are bilingual); and assemblies beyond the two pilot counties.

= Technical Functionality and Architecture

A React/TypeScript (Vite) client on Netlify calls a FastAPI REST API on Render backed by PostgreSQL on Neon. Requests pass an in-memory rate limiter, JWT authentication and role checks; Clerk's Office actions also pass a committee-scope check. Routes delegate to domain modules: `participation` (when a bill accepts views, and the stage a call for memoranda implies), `submission_stage`, `receipt_service`, `ingestion_service` (`pdftotext` with Tesseract OCR fallback), `linking_service` and `llm_matching_service` (Gemini proposals), and three new tracing services: `report_analysis_service`, `house_trace_service` and `act_trace_service`. A shared `evidence` module supports all three. Sync scripts read official sources and accept only same-domain links. Each AI step runs from a script or a staff action, never from a page view. Results are stored in `report_analyses`, `house_traces` and `act_traces` (five new migrations). Because OCR and Gemini runs are slow and costly, they run once, locally; `trace_bundle` then copies reports, entries, analyses and traces to production. It matches records by their official PDF address and bill identifier rather than database ids, and never replaces entries already matched to a citizen's submission.

*Performance.* The app starts from one `/bootstrap` response. It had grown to 35 MB, uncompressed, because it carried every report's full text and all 8,034 report entries. It now leaves out report texts and sends only the entries matched to a submission (pages that list every entry load them from `/report-entries`), and responses are gzip-compressed: 228 kB over the network. Pages other than the home page load their code on first visit, Roboto is served from the app, and page transitions use CSS instead of an animation library.

*Sources.* Bills, stages, reports, calls for memoranda and bill PDFs come from parliament.go.ke. House debates come from Mzalendo's copy of the Hansard, read politely and credited on every page that uses it; robots.txt allows this, and a note to Mzalendo about reuse is pending. Nairobi's Acts, with dates of assent, and its committee reports come from the assembly's own website; bill PDFs missing from Parliament's pages come from Mzalendo's bill tracker. Kenya Law serves Act pages behind an automated-traffic challenge and asks that its content not be used as AI input. The platform therefore reads only its public listing, to link each bill to its Act, and never downloads Act pages. Other Act texts come from PDFs that staff download in a browser and upload, or from Parliament's own Acts page, which lists only five. The Laws.Africa API would automate this but is paid.

*How AI evidence is checked.* Gemini never supplies the evidence itself. It receives the Act, bill or Hansard with numbered lines and cites a line range; the platform takes the wording from those lines. A claim stands only if checks the platform runs itself agree:
- *Act:* the cited Act wording must not already be in the bill as published (clause numbers ignored), unless the stakeholder supported that wording. A deletion must name bill wording that is missing from the Act.
- *House:* the cited lines must record an amendment being moved and the decision, on the clause the recommendation concerns. "(Clauses 29–32 agreed to)" counts as *passed unchanged*, never as an agreed change.
- *Second check:* a separate Gemini call sees only the word-level difference, or the amendment moved, and must agree that it carries out the recommendation.

Answers that fail a check are retried once with the reason; anything still unproven shows as "could not confirm". Stakeholder names are accepted only if they appear in the report text shown to the model. Receipts keep their earlier protections: triggers reject UPDATE and DELETE, edits are new versions, and hashes cover uploaded documents.

= Testing Approaches and Results

*1. Automated checks.* `npm run typecheck` and `npm run build` pass. Pages are now split: the code loaded on a first visit is 520 kB (164 kB gzip), down from 1,370 kB (397 kB gzip), and each other page loads its own code. `npm audit` reports 5 advisories (3 moderate, 2 high) in react-router, vite, uuid and source-map-js; the React Router open-redirect case is mitigated in the sign-in redirect helper. The backend suite gives *248 passed* with *87% line coverage*; one timing-sensitive test failed once while the machine was under load and passed on rerun. Coverage is down from 97%: the command-line scripts `trace_acts`, `trace_house` and `analyse_reports` are untested, and so is the Hansard-fetching half of `house_trace_service` (56%). Routes stay at 98%, and the new county sync, `act_library` and `trace_bundle` are at 98%, 91% and 93%. Tests run against PostgreSQL with the production append-only triggers. Gemini, HTTP and PDF tools are faked, so tests never go online. Beyond the earlier areas (tamper detection, participation windows, committee scope, rate limits, AI-score capping, the tracker and county parsers), new tests cover:
- the participation stage following calls for memoranda, and a clerk's call opening a First Reading bill;
- the evidence checks: invented quotes, renumbered unchanged wording, supported wording, deletions, OCR misreadings ("issucd" for "issued") but never a changed number ("ten" for "five"), and the second check rejecting an unrelated change;
- House rules: wrong clause, no amendment moved, and "passed unchanged";
- name recovery rejecting a name that is not in the report;
- a receipt following its report entry through the House into the Act;
- the county Acts page, Acts that follow their bill by up to three years (never for yearly laws such as Finance Bills), and one Act stored under two spellings;
- Nairobi reports linking only to county bills, and copying the trace to a database with different ids without replacing entries matched to submissions;
- the start-up data leaving out report texts and unmatched entries, and being compressed.

*2. Browser checks (local, Playwright, Chromium).* The bill page, the Act reader, the receipt timeline and the Bills filters rendered with no console errors. A defect was found and fixed: when two submissions pointed to the same Act wording, the reader listed the second under "could not confirm" although its badge said "In the final Act".

*3. Matching and usability (unchanged since 10 November).* Matching scored 82% accuracy over three runs on 60 labelled submissions against three real reports (precision 91–97%, recall 78–80%; baseline 15% and 18%). Every proposal scored 0.9 or above was correct; Kiswahili was weakest (1 of 3). The usability study of 35 adults gave 80% mean task completion and a mean SUS of 72.4 (68 benchmark). Finding the committee outcome was hardest (60%). This release addresses that with the receipt timeline and the per-submission trace on bill pages.

*3a. Traceability checks (14 November 2026).* The House and Act checks ran on every passed bill with an analysed report and on every Act text available; 14 Acts had adopted recommendations to check.

#table(
  columns: (2.2fr, 1.4fr, 1.4fr),
  fill: (_, y) => if y == 0 { rgb("#e8eef9") },
  table.header[Bill (strongest cases)][House: agreed / checked][Act: in the Act / checked],
  [Tax Procedures (Amendment) (No. 2) Bill, 2024], [43 / 55], [44 / 55],
  [Sugar Bill, 2022], [debate not on Mzalendo], [40 / 52],
  [Business Laws (Amendment) Bill, 2024], [11 / 11], [11 / 11],
  [Coffee Bill, 2023 (Senate)], [debate not on Mzalendo], [16 / 26],
  [Insurance Professionals Bill, 2024], [13 / 19], [15 / 19],
  [Privatization Bill, 2025], [9 / 17], [11 / 17],
  [Virtual Asset Service Providers Bill, 2025], [3 / 41], [11 / 41],
)

Strictness was tested and adjusted. The first line-based version confirmed 25 of 41 VASP recommendations. Spot checks found false positives, for example a request to replace the Capital Markets Authority with a single regulator, marked as in the Act because s. 5 differs slightly from the bill. Adding the second check removed these. Allowing longer line ranges (60 Hansard lines, 25 Act lines) then cut House "could not confirm" results caused only by long amendments. Counts move between runs because the model's answers vary. Across the three runs with all checks in place, VASP gave 8, 18 and 10 confirmations. Tax Procedures (41, 45, 47) and Business Laws (8, 9, 10) varied less. Since the checks can only downgrade a claim, variation adds "could not confirm" rather than false confirmations. The figures above are the stored results the pages show.

*4. Performance (Lighthouse 12.2, Chrome 157, 14 November).* Lighthouse found the 35 MB start-up response described in Section 2. Results after the fixes, from two mobile runs each:

#table(
  columns: (1.6fr, 1.3fr, 1.3fr),
  fill: (_, y) => if y == 0 { rgb("#e8eef9") },
  table.header[Page and device][Before][After],
  [Home, mobile (4× slower CPU, slow 4G)], [44; largest paint 5.4 s], [74–78; 2.6–2.9 s],
  [Home, desktop], [not measured], [99; 0.6 s],
  [Bills, mobile], [33; 35 MB loaded], [65–68; 5.0–5.7 s],
  [Bills, desktop], [82; layout shift 0.455], [95; layout shift 0.046],
)

Accessibility and best practices both score 100. Mobile stays under 90 because each page is built in the browser: the phone must download and run the main script, much of it Material UI styling, before anything shows. The bills page then loads its own code and the list of 724 bills, one after the other.

*5. Hosted state.* Checks on 6–7 November found the hosted API and schema on the previous release. After a `pg_dump` backup, a cleanup removed demo data and resealed the chain; 10 of 10 receipts verify. On 14 November the production database was found to be missing a column (`act_traces.bill_text`) that the code reads, because a migration had been edited after production ran it. A new migration adds the column where it is missing and has been applied. The trace was then copied to production with `trace_bundle`: production now holds 266 linked reports, 108 analysed reports with 959 submissions, 17 House traces and 88 Act texts (14 checked). One report failed on a dropped connection and will be added on the next import. The production sync runs nightly on GitHub Actions. The performance changes and the new migration file are not yet deployed.

*Next steps:* moderator sign-off for AI readings, more Act texts, a labelled test set for the House and Act checks, a second labeller for matching, server-side paging of the bills list, and a second usability round with individual sessions and timings.

= Code Quality Practices

Concerns are separated: typed pages and shared components for presentation, `src/api/` for HTTP, routes for coordination, models for persistence, and services for domain logic. Rules that both sides need are defined once per side with the same vocabulary: the submission stages, the participation reason, and the trace statuses. Tests sit at the trust boundaries: chain integrity, access scope, rate limits, untrusted parser input, and AI output. AI output is never trusted directly. Its evidence is taken from the source text and re-checked by deterministic rules before it is shown, and every check has a test. Sync code is defensive: official columns are read before free text, ambiguous rows are skipped rather than guessed, and bills are matched to Acts and Hansard by official number first, then exact title.

Quality risks remain:
- *Large modules:* `routes.py` has grown to about 2,280 lines and should be split by domain.
- *Mobile performance:* the home page scores 74–78 and the bills page 65–68 on Lighthouse mobile; reaching 90 needs pre-rendered pages, less runtime styling and a paged bills list.
- *Scaling:* rate-limit counters live in memory, so they need Redis before the API runs as several instances.
- *Dependencies:* the npm advisories are still open.
- *AI readings:* report, House and Act readings are checked automatically but not signed off by a person; results vary between runs; and scanned Acts and bills (Privatization) depend on OCR quality.
- *Sources:* Kenya Law Act texts need manual downloads, Nairobi's reports are scans read by OCR, and House decisions depend on Mzalendo's Hansard copy.
- *Schema drift:* a migration edited after it ran left production without a column; an applied migration must never be edited.
- *Matching accuracy:* measured on 60 constructed, single-labeller test submissions; it needs a second labeller, real submissions and better Kiswahili handling.