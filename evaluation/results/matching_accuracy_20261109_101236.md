# Matching accuracy — 2026-11-09

Model `gemini-3.5-flash-lite`. 60 labelled submissions across 3 bills (49 should match an entry, 11 should match nothing). Each submission was compared with every report entry for its bill.

| Measure | Gemini | Text similarity (baseline) |
|---|---|---|
| Precision (proposals that were correct) | 91% (78–96%) | 15% (8–26%) |
| Recall (correct entry found) | 80% (66–88%) | 18% (10–31%) |
| F1 | 0.85 | 0.17 |
| Correctly proposed nothing | 91% | 0% |
| Overall accuracy | 82% (70–89%) | 15% (8–26%) |

Brackets show 95% confidence intervals (Wilson).

## By submission style (overall accuracy)

| Style | n | Gemini | Text similarity |
|---|---|---|---|
| clause | 15 | 87% | 7% |
| no_clause | 18 | 83% | 28% |
| lay | 13 | 69% | 23% |
| kiswahili | 3 | 67% | 0% |
| no_match_related | 5 | 80% | 0% |
| no_match_unrelated | 5 | 100% | 0% |
| injection | 1 | 100% | 0% |

## Gemini accuracy by confidence score

| Score | Proposals | Correct |
|---|---|---|
| 0.5–0.7 | 7 | 7 (100%) |
| 0.7–0.9 | 7 | 4 (57%) |
| 0.9–1.0 | 29 | 28 (97%) |

## Gemini errors

- **V05** (lay, missed): proposed nothing. Expected: Clause 10(2), Clause 9(2). Submission: "Small crypto start-ups cannot afford the same rules as the big exchanges. Give the small ones lighter requirements or a space to test their products first."
- **V11** (kiswahili, missed): proposed nothing. Expected: Clause 40(1). Submission: "Mamlaka ya udhibiti iweke daftari la wazi linaloonyesha kampuni zilizoadhibiwa kwa kuvunja sheria, ili umma ujue hatari kabla ya kufanya biashara nazo."
- **V16** (lay, missed): proposed nothing. Expected: Clause 1, Clause 17(1)(c). Submission: "If a crypto company closes down, customers' coins must be protected and returned to them, and an independent auditor should confirm that every customer was paid"
- **P02** (no_clause, missed): proposed nothing. Expected: Clause 9(2). Submission: "The head of the Kenya Bureau of Standards should sit on the Authority's board of directors."
- **P04** (clause, wrong_entry): proposed Clause 4 at 0.85. Expected: Clause 21. Submission: "Inspectors should have the power to seize and hold any pest control product that does not comply with the Act or its regulations."
- **P05** (no_clause, missed): proposed nothing. Expected: Clause 23, Clause 23(b). Submission: "County governments should train agro-dealers, farmers and the public on the safe and responsible use of pesticides."
- **C02** (no_clause, wrong_entry): proposed Clause 2 at 0.90. Expected: Clause 2. Submission: "The definition of coffee grower should include the individual farmer, so that the Direct Settlement System can pay money straight into farmers' accounts."
- **C06** (lay, missed): proposed nothing. Expected: Clause 56. Submission: "Licences for selling coffee on international markets should come from the Capital Markets Authority, since it is the body that regulates trading."
- **C07** (clause, wrong_entry): proposed Clause 64 at 0.85. Expected: Clause 64. Submission: "If the coffee development levy is brought back, it should be phased in gradually rather than charged in full at once."
- **C14** (lay, missed): proposed nothing. Expected: Clause 23, Clause 28. Submission: "Getting a coffee licence should happen in one central, online system instead of each county issuing its own licences."
- **C17** (no_match_related, false_match): proposed Clause 64 at 0.75. Expected: no match. Submission: "The government should guarantee farmers a minimum price per kilo of coffee cherry every season."
