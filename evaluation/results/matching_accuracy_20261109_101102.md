# Matching accuracy — 2026-11-09

Model `gemini-3.5-flash-lite`. 60 labelled submissions across 3 bills (49 should match an entry, 11 should match nothing). Each submission was compared with every report entry for its bill.

| Measure | Gemini | Text similarity (baseline) |
|---|---|---|
| Precision (proposals that were correct) | 95% (84–99%) | 15% (8–26%) |
| Recall (correct entry found) | 78% (64–87%) | 18% (10–31%) |
| F1 | 0.85 | 0.17 |
| Correctly proposed nothing | 100% | 0% |
| Overall accuracy | 82% (70–89%) | 15% (8–26%) |

Brackets show 95% confidence intervals (Wilson).

## By submission style (overall accuracy)

| Style | n | Gemini | Text similarity |
|---|---|---|---|
| clause | 15 | 100% | 7% |
| no_clause | 18 | 72% | 28% |
| lay | 13 | 77% | 23% |
| kiswahili | 3 | 0% | 0% |
| no_match_related | 5 | 100% | 0% |
| no_match_unrelated | 5 | 100% | 0% |
| injection | 1 | 100% | 0% |

## Gemini accuracy by confidence score

| Score | Proposals | Correct |
|---|---|---|
| 0.5–0.7 | 8 | 7 (88%) |
| 0.7–0.9 | 2 | 2 (100%) |
| 0.9–1.0 | 30 | 29 (97%) |

## Gemini errors

- **V04** (no_clause, missed): proposed nothing. Expected: Clause 41, Clause 41(1). Submission: "The fines and prison terms in this bill are far harsher than for similar offences in banking or insurance. Reduce them to match other financial laws."
- **V05** (lay, missed): proposed nothing. Expected: Clause 10(2), Clause 9(2). Submission: "Small crypto start-ups cannot afford the same rules as the big exchanges. Give the small ones lighter requirements or a space to test their products first."
- **V11** (kiswahili, missed): proposed nothing. Expected: Clause 40(1). Submission: "Mamlaka ya udhibiti iweke daftari la wazi linaloonyesha kampuni zilizoadhibiwa kwa kuvunja sheria, ili umma ujue hatari kabla ya kufanya biashara nazo."
- **V16** (lay, wrong_entry): proposed Clause 26(1) at 0.60. Expected: Clause 1, Clause 17(1)(c). Submission: "If a crypto company closes down, customers' coins must be protected and returned to them, and an independent auditor should confirm that every customer was paid"
- **P02** (no_clause, missed): proposed nothing. Expected: Clause 9(2). Submission: "The head of the Kenya Bureau of Standards should sit on the Authority's board of directors."
- **P05** (no_clause, missed): proposed nothing. Expected: Clause 23, Clause 23(b). Submission: "County governments should train agro-dealers, farmers and the public on the safe and responsible use of pesticides."
- **P08** (no_clause, missed): proposed nothing. Expected: Clause 40. Submission: "Kenya should not allow imports of pesticides that are banned in the country where they were made, and goods in transit should be controlled so they are not dive"
- **P09** (kiswahili, missed): proposed nothing. Expected: Clause 45(2), Clause 47(3), Clause 48(3), Clause 69(1). Submission: "Serikali za kaunti zishirikishwe wakati Waziri anapotunga kanuni chini ya sheria hii ya bidhaa za kudhibiti wadudu."
- **C02** (no_clause, wrong_entry): proposed Clause 2 at 0.90. Expected: Clause 2. Submission: "The definition of coffee grower should include the individual farmer, so that the Direct Settlement System can pay money straight into farmers' accounts."
- **C06** (lay, missed): proposed nothing. Expected: Clause 56. Submission: "Licences for selling coffee on international markets should come from the Capital Markets Authority, since it is the body that regulates trading."
- **C09** (kiswahili, missed): proposed nothing. Expected: Clause 27. Submission: "Kila serikali ya kaunti iwasilishe kwa Bodi nakala ya daftari la wakulima wa kahawa kila mwaka."
