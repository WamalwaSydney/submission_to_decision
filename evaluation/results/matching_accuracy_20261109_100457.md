# Matching accuracy — 2026-11-09

Model `gemini-3.5-flash-lite`. 60 labelled submissions across 3 bills (48 should match an entry, 12 should match nothing). Each submission was compared with every report entry for its bill.

| Measure | Gemini | Text similarity (baseline) |
|---|---|---|
| Precision (proposals that were correct) | 90% (76–96%) | 15% (8–26%) |
| Recall (correct entry found) | 73% (59–83%) | 19% (10–32%) |
| F1 | 0.81 | 0.17 |
| Correctly proposed nothing | 92% | 0% |
| Overall accuracy | 77% (65–86%) | 15% (8–26%) |

Brackets show 95% confidence intervals (Wilson).

## By submission style (overall accuracy)

| Style | n | Gemini | Text similarity |
|---|---|---|---|
| clause | 15 | 80% | 7% |
| no_clause | 18 | 78% | 28% |
| lay | 12 | 67% | 25% |
| kiswahili | 3 | 33% | 0% |
| no_match_related | 6 | 83% | 0% |
| no_match_unrelated | 5 | 100% | 0% |
| injection | 1 | 100% | 0% |

## Gemini accuracy by confidence score

| Score | Proposals | Correct |
|---|---|---|
| 0.5–0.7 | 6 | 5 (83%) |
| 0.7–0.9 | 3 | 2 (67%) |
| 0.9–1.0 | 30 | 28 (93%) |

## Gemini errors

- **V04** (no_clause, missed): proposed nothing. Expected: Clause 41, Clause 41(1). Submission: "The fines and prison terms in this bill are far harsher than for similar offences in banking or insurance. Reduce them to match other financial laws."
- **V05** (lay, missed): proposed nothing. Expected: Clause 10(2), Clause 9(2). Submission: "Small crypto start-ups cannot afford the same rules as the big exchanges. Give the small ones lighter requirements or a space to test their products first."
- **V11** (kiswahili, missed): proposed nothing. Expected: Clause 40(1). Submission: "Mamlaka ya udhibiti iweke daftari la wazi linaloonyesha kampuni zilizoadhibiwa kwa kuvunja sheria, ili umma ujue hatari kabla ya kufanya biashara nazo."
- **V14** (clause, wrong_entry): proposed Clause 6 at 0.90. Expected: Clause 6(a). Submission: "Instead of splitting supervision between the Central Bank and the Capital Markets Authority, create one dedicated Virtual Assets Regulatory Authority staffed by"
- **V16** (lay, missed): proposed nothing. Expected: Clause 1, Clause 17(1)(c). Submission: "If a crypto company closes down, customers' coins must be protected and returned to them, and an independent auditor should confirm that every customer was paid"
- **P05** (no_clause, missed): proposed nothing. Expected: Clause 23, Clause 23(b). Submission: "County governments should train agro-dealers, farmers and the public on the safe and responsible use of pesticides."
- **P08** (no_clause, missed): proposed nothing. Expected: Clause 40. Submission: "Kenya should not allow imports of pesticides that are banned in the country where they were made, and goods in transit should be controlled so they are not dive"
- **P09** (kiswahili, missed): proposed nothing. Expected: Clause 45(2), Clause 47(3), Clause 48(3), Clause 69(1). Submission: "Serikali za kaunti zishirikishwe wakati Waziri anapotunga kanuni chini ya sheria hii ya bidhaa za kudhibiti wadudu."
- **P17** (no_match_related, false_match): proposed Clause 69(2) at 0.60. Expected: no match. Submission: "Spraying pesticides from drones near homes and schools should be banned."
- **C02** (no_clause, missed): proposed nothing. Expected: Clause 2. Submission: "The definition of coffee grower should include the individual farmer, so that the Direct Settlement System can pay money straight into farmers' accounts."
- **C04** (clause, missed): proposed nothing. Expected: Clause 7. Submission: "The Board should be more representative, with seats for farmers, cooperatives and private businesses in the coffee industry."
- **C06** (lay, missed): proposed nothing. Expected: Clause 56. Submission: "Licences for selling coffee on international markets should come from the Capital Markets Authority, since it is the body that regulates trading."
- **C07** (clause, wrong_entry): proposed Clause 64 at 0.80. Expected: Clause 64. Submission: "If the coffee development levy is brought back, it should be phased in gradually rather than charged in full at once."
- **C14** (lay, wrong_entry): proposed Clause 11 at 0.90. Expected: Clause 23, Clause 28. Submission: "Getting a coffee licence should happen in one central, online system instead of each county issuing its own licences."
