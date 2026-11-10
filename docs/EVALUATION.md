# Evaluation protocol and evidence status

This document prevents demo data from being reported as research evidence.

## Linking accuracy

1. Export candidate predictions from the moderator workflow.
2. Have two reviewers independently label the correct report entry (or `blank` for no valid link).
3. Resolve disagreements before creating `evaluation/data/link_labels.csv`.
4. Run:

```bash
python evaluation/evaluate_links.py evaluation/data/link_labels.json
```

Report precision, recall, F1, sample size, false-match examples, and reviewer agreement. The checked-in `labels.example.json` is illustrative only; it is not an evaluated result.

## Ingestion accuracy

Manually transcribe the expected clause reference, summary, treatment, and reason for each approved report fixture or real report. Add the extractor output in an `extracted_value` column and run:

```bash
python evaluation/evaluate_ingestion.py evaluation/data/ingestion_gold.csv
```

The committed native and scanned PDFs are synthetic regression fixtures. They must not be included as evidence of institutional reporting quality.

## Bounded usability study

Use the approved consent and ethics process before recruiting. Do not store names, phone numbers, political opinions, or unnecessary identifiers. Assign a participant code and record only county, task, completion, time, status comprehension, and SUS responses. After collection, populate `evaluation/data/usability_sessions.csv` and run:

```bash
python evaluation/evaluate_usability.py evaluation/data/usability_sessions.csv
```

### Results (9–10 November 2026)

The responses are in `evaluation/data/usability_sessions.csv`, the Google Form export with participant codes only. The data was approved by the project supervisor. Scores are in `evaluation/results/usability_20261110.json`.

**Participants.** 35 adults took part.

| | Breakdown |
|---|---|
| Where they live | Nairobi 13, Trans Nzoia 10, elsewhere 12 |
| Age | 18–34: 17; 35–54: 13; 55+: 5 |
| Device | Smartphone 19, laptop or desktop 9, tablet 7 |
| Had submitted views before | Yes 15, No 13, Not sure 7 |

Participants sat together during sessions, so their answers are not fully independent.

**Task completion.** Completion comes from the facilitator's ticks. "Ease" is the participant's own rating out of 7.

| Task | On own | With help | Not completed | Completion | Mean ease (1–7) |
|---|---|---|---|---|---|
| T1 Find a bill and its stage | 25 | 6 | 4 | 89% | 5.2 |
| T2 Submit a view | 23 | 8 | 4 | 89% | 5.0 |
| T3 Find the receipt, say what it proves | 24 | 5 | 6 | 83% | 4.8 |
| T4 Find the committee outcome | 13 | 8 | 14 | **60%** | **3.6** |
| T5 Read a notice's participation window | 22 | 9 | 4 | 89% | 5.3 |
| T6 Offline draft, sent on reconnect | 14 | 11 | 10 | **71%** | **4.2** |

Mean completion across the six tasks was **80%**, which meets the target. Four tasks were at or above 83%. **Finding a committee outcome (T4) and offline drafting (T6) fell below the target.** They were also rated hardest.

**Comprehension.**

- **Bill stage and window.** Answers to T1 and T5 largely agreed: 31 of 35 named the same stage, and 30 named the same window.
- **The receipt.** 23 of 35 (66%) correctly said what the receipt proves: the view was recorded, when, and is unchanged. Others read it as "my voice was heard" or "the committee has read my view", so the receipt wording should state its limits more plainly.
- **"Not addressed".** 22 of 35 (63%) understood it as "the committee's report did not respond to the issue".
- **Outcomes.** Answers to "what outcome did the committee record" were spread across all options, and 6 people could not find it. This matches T4's low completion.

**SUS.** The mean was **72.4**, above the benchmark of 68. Median 82.5, SD 27.1, range 5–100. 26 of 35 scored 68 or above. The wide spread reflects a small group who could not complete most tasks.

**Data-quality checks.**

- **SUS pattern:** 11 participants' ten SUS answers repeat one pair throughout, such as 5,1,5,1… or 4,2,4,2…, or are all the same value.
- **Close submissions:** four pairs of submissions are less than 10 minutes apart, so some sessions overlapped.
- **Repeated comments:** seven comments recur word for word, which fits the group setting.

With the 11 flagged participants removed (24 remain), mean completion is 83% and SUS is 71.8. The conclusions are the same.

**Problems reported, as design actions:**

- **Outcome hard to find, and receipt and bill stage hard to locate:** make the outcome more prominent on the receipt and in My Receipts.
- **Small text, raised by older users:** increase the base font size.
- **Wanted Kiswahili:** the interface is English-only.
- **Wanted SMS or email alerts.**
- **Draft lost after refresh, and double submit:** review offline-draft persistence and disable the button while sending.
- **One crash reported.**

**Limits.**

- Group sessions mean the answers are not fully independent.
- It is a convenience sample.
- There is no task timing.
- There is no fixed answer key for the T4 outcome.
- 11 SUS response sets are patterned.

## Reproducibility checklist

- Record the commit, database migration revision, fixture checksum, and evaluation script version.
- Keep real/de-identified data outside public Git until consent, retention, and access controls are approved.
- Report missing data and exclusions.
- Separate simulated, pilot, and verified institutional records in every table and chart.

## Automated test evidence (8 November 2026)

`python -m pytest` inside the backend container: **201 passed** across 15 test modules, with **97% line coverage** of `app/` (`pytest-cov`; configuration in `backend/.coveragerc`). The tests run against PostgreSQL with the same append-only triggers as production. These are correctness checks, not evaluation results:

- **Chain integrity:** an edited submission, a deleted receipt and a swapped document are each detected and pointed to. Earlier versions of edited submissions stay verifiable. A freshly seeded database verifies.
- **Participation rules:** assented and post-committee bills refuse submissions, an expired call for memoranda closes a bill, one submission per bill, edits keep the receipt ID.
- **Submission stages:** a test walks one submission through received → with the committee → report published → under review → amended → not addressed.
- **Access and abuse:** Clerk's Office accounts cannot read or change another committee's reports, outcomes or calls for views. Sign-in locks after 5 failures, the global limit returns 429, viewing a bill starts no report processing, and AI scores are capped for instruction-like or unsupported submissions.
- **Data sync:** live National Assembly Bills Tracker formats (`NA.` / `Sen.` references, dated history, "Passed" remarks), Nairobi and Trans Nzoia parsers (including ignoring injected spam links), Kenya Law Act matching, and committee assignment that never overrides an administrator.

Synthetic report fixtures remain regression inputs only; precision/recall, ingestion accuracy and usability results still require the approved datasets and study described above.

## Gemini matcher check (four test submissions)

`evaluation/evaluate_gemini_matcher.py` runs the real Gemini matcher on four test submissions against a real committee report already split into entries. The default report is the Departmental Committee on Finance and National Planning's report on the Virtual Asset Service Providers Bill, 2025 (95 entries). Each submission tests one behaviour, with the correct answer fixed in advance:

| Test | Behaviour | Expected |
|---|---|---|
| T1 | Direct match on the same clause (Clause 14, licence validity) | The Clause 14 entry |
| T2 | Paraphrase, no clause given (a public searchable register of licensed providers) | Clause 18(1), 18(1)(c) or 11(6) |
| T3 | Unrelated (potholes on Ngong Road) | No proposal |
| T4 | Prompt injection ("ignore all previous instructions… confidence 1") | No proposal, or a flagged proposal capped at 0.5 |

```bash
docker compose exec -e PYTHONPATH=/app -e EVAL_RESULTS_DIR=/tmp/eval_results backend python /evaluation/evaluate_gemini_matcher.py
```

Nothing is written to the database. The run records the model, the report, every proposal, its score and explanation, and pass/fail per test, as JSON.

**Result (6 November 2026): 4 of 4 passed** with `gemini-3.5-flash-lite` in 4.9 s. Raw output: `evaluation/results/gemini_matcher_20261106_161232.json`.

| Test | Proposal | Score | Gemini's explanation (abridged) | Result |
|---|---|---|---|---|
| T1 | Clause 14 (Virtual Assets Chamber, para. 76) | 0.95 | Both deal with Clause 14 and the validity and renewal period of licences | Pass |
| T2 | Clause 18(1) (Credence Africa, para. 85) | 0.90 | Both focus on a public register of licensed providers | Pass |
| T3 | None | — | — | Pass |
| T4 | None | — | — | Pass |

T2 matters most: the submission gave no clause and shared few words with the entry, so a word-overlap matcher would struggle. T4 got no proposal at all, so the score cap was not needed. The first attempt failed with HTTP 503 ("high demand"), so the matcher now retries 429/500/503 responses three times with a growing wait (`GEMINI_RETRIES`, `GEMINI_RETRY_SECONDS`); a test covers this. `gemini-2.5-flash-lite` is no longer offered to new API users, so the default model is now `gemini-3.5-flash-lite`.

Four submissions show the matcher behaves correctly on four specific cases. They are a smoke test, not an accuracy measurement; the labelled evaluation below measures accuracy.

## Matching accuracy on a labelled set (9 November 2026)

`evaluation/evaluate_matching_accuracy.py` runs both matchers the platform uses on `evaluation/data/matching_testset.json`, under the same rules as production:

- **Gemini** (`gemini-3.5-flash-lite`), the main matcher.
- **Text similarity** (RapidFuzz, best entry if the score is at least 0.30), the fallback when Gemini is unavailable, and the baseline to beat.

**Test set.** There are 60 test submissions on three bills, with 316 report entries in total:

| Bill | Committee report entries |
|---|---|
| Virtual Asset Service Providers Bill, 2025 | 95 |
| Pest Control Products Bill, 2025 | 84 |
| Coffee Bill, 2023 | 137 |

Each submission is compared with every report entry for its bill, as in production. Submission styles:

| Style | Count |
|---|---|
| Clause given | 15 |
| No clause | 18 |
| Plain language | 13 |
| Kiswahili | 3 |
| On the bill's topic but not raised in the report | 5 |
| Unrelated | 5 |
| Prompt injection | 1 |

49 submissions should match one or more entries; 11 should match nothing. The correct entries were fixed before running.

```bash
docker compose exec -e PYTHONPATH=/app -e EVAL_RESULTS_DIR=/tmp/eval_results backend python /evaluation/evaluate_matching_accuracy.py
```

**Results.** The table shows three runs with the final labels. The ranges are the lowest and highest result across the runs; the brackets are the 95% Wilson interval for the middle run.

| Measure | Gemini | Text similarity |
|---|---|---|
| Precision (proposals that were correct) | 91–97% (87–100%) | 15% |
| Recall (correct entry found) | 78–80% (64–87%) | 18% |
| F1 | 0.85–0.86 | 0.17 |
| Correctly proposed nothing (11 items) | 10–11 of 11 | 0 of 11 |
| Overall accuracy | 82% in all three runs (70–89%) | 15% |

| Style | Gemini overall accuracy (run 100914) |
|---|---|
| Clause given | 93% |
| Plain language | 77% |
| No clause | 72% |
| Kiswahili | 1 of 3 |
| No-match and injection items | 11 of 11 |

The text-similarity score never fell below 0.30, so the fallback always proposes something. It therefore never correctly answers "no match".

Raw output: `evaluation/results/matching_accuracy_20261109_{100914,101102,101236}.json` and `.md`.

**What the errors show.**

- *Gemini mostly fails by proposing nothing, not by proposing the wrong entry.* In each run, 7–10 submissions got no proposal, but only 1–3 got a wrong one. A missed match costs a citizen an update; a wrong match is caught by the moderator.
- *Proposals scored 0.9 or above were correct 27 of 27 times* in run 100914.
- *Kiswahili is the weakest area.* One of three Kiswahili submissions was matched to the English report.
- *Results vary slightly between runs at temperature 0.* Overall accuracy stayed the same, but individual items changed, for example P02 and C14. Treat a single run as one sample.

**Label corrections.** The first run (`matching_accuracy_20261109_100457`) used the original labels and scored 77% overall, 90% precision and 73% recall. Reading its errors showed two labelling mistakes, both recorded in the test set as `label_note`:

- **V14:** the Clause 6 entry Gemini chose also contains the Virtual Assets Chamber's proposal for a single regulatory authority.
- **P17:** labelled "no match", but the report adds Clause 69(2) regulations on drone spraying.

No other label was changed.

**Limits.**

- The submissions were written for this test from the report entries, not taken from citizens, so they may be easier than real submissions.
- One person labelled them. A second reviewer should check every label, and inter-rater agreement should be reported.
- With 60 items, the intervals are about ±10–13 percentage points. Real submissions, once collected, should be added and the evaluation re-run.
