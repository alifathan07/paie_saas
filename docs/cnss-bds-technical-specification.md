# CNSS e-BDS BDS technical specification

## Scope and source

This document records the format implemented by the CNSS e-BDS exporter. The
normative source consulted is the CNSS *Cahier des Charges relatif à la
réalisation des déclarations des salaires en Mode Échange de Fichiers entre la
CNSS et ses Affiliés*, version 1.3/1.4. It specifies seven fixed-width record
types, each 260 characters, followed by a line-feed (`ASCII 10`). The uploaded
pre-established file is the source of truth for the B00/B01 header and B02
identity/family-allowance fields.

Reference: [CNSS e-BDS technical specification (v1.3 text)](https://fr.scribd.com/document/456993223/CNSS-Regles-de-gestion-emission-et-preetabliV7-pdf).

## Record layouts

Offsets below are zero-based and end-exclusive. Numeric fields are unsigned,
right-aligned with zero padding. Alphanumeric fields are left-aligned and
space-padded. Monetary values are integer centimes.

| Record | Fields in order (offset, length) | Filler |
|---|---|---|
| B00 | type (0,3); transfer id (3,14); category (17,2) | 241 spaces |
| B01 | type (0,3); affiliation (3,7); period (10,6); company name (16,40); activity (56,40); address (96,120); city (216,20); postal code (236,6); agency (242,2); emission date (244,8); due date (252,8) | none |
| B02 | type (0,3); affiliation (3,7); period (10,6); CNSS number (16,9); name (25,60); children (85,2); AF due (87,6); AF deduction (93,6); AF net (99,6); AF reverse (105,6); days (111,2); real salary (113,13); capped salary (126,9); situation (135,2); control (137,19) | 104 spaces |
| B03 | type (0,3); affiliation (3,7); period (10,6); employee count (16,6); children total (22,6); AF due total (28,12); AF deduction total (40,12); AF net total (52,12); CNSS sum (64,15); AF reverse total (79,12); days total (91,6); real salary total (97,15); capped salary total (112,13); control total (125,19) | 116 spaces |
| B04 | type (0,3); affiliation (3,7); period (10,6); CNSS number (16,9); name (25,60); CIN (85,8); days (93,2); real salary (95,13); capped salary (108,9); control (117,19) | 124 spaces |
| B05 | type (0,3); affiliation (3,7); period (10,6); entrant count (16,6); CNSS sum (22,15); days total (37,6); real salary total (43,15); capped salary total (58,13); control total (71,19) | 170 spaces |
| B06 | type (0,3); affiliation (3,7); period (10,6); total count (16,6); CNSS sum (22,15); days total (37,6); real salary total (43,15); capped salary total (58,13); control total (71,19) | 170 spaces |

The B00 payload must equal A00 except for `A00 → B00` and `A0 → B0`.
The B01 payload must equal A01 except for `A01 → B01`. The application does
not store every B01 field, so the exporter never rebuilds the header from
partial company data.

## Application data mapping

| CNSS data | Application source | Rule |
|---|---|---|
| affiliation/period | `Company.numeroAffiliationCnss`, selected payroll period | Must match the A01/template values |
| existing employee membership | A02 CNSS number + monthly `Payslip` employee | Every A02 must match exactly one payroll record |
| B02 days | `Payslip.workedDays` | Integer, 0–26; blocked payroll uses zero and its stored situation |
| B02 real salary | `Payslip.sbg` | Converted from DH to centimes; no payroll rule is changed |
| B02 capped salary | `min(real salary, PayrollConfig.cnssPlafond)` | Ceiling is read from existing payroll configuration |
| B02 identity/AF fields | A02 template row | Must remain identical to the CNSS pre-established declaration |
| B04 entrant data | monthly payroll record not present in A02 | Requires a valid 9-digit CNSS number, name and CIN supplied by caller |

The current schema has no independent activity, postal-code, agency, emission
date, due-date, or period-specific family-allowance ledger. Those values are
therefore preserved from the official uploaded pre-established file; no schema
change is introduced.

## Controls and summaries

For each B02:

`CNSS number + AF reverse + declared days + real salary + capped salary + situation rank`

Situation ranks are: blank=0, SO=1, DE=2, IT=3, IL=4, AT=5, CS=6, MS=7,
MP=8. For each B04:

`CNSS number + declared days + real salary + capped salary`

B03 is the vertical sum of all emitted B02 rows. B05 is the vertical sum of
all emitted B04 rows. B06 is the sum of the B02 and B04 populations and their
numeric totals. All three summaries are emitted even when their population is
zero. In that case one empty B04 row is emitted with blank identity fields,
`00` days and zero numeric amounts.

## Validation rules

- Every record is exactly 260 characters; output uses CRLF for compatibility
  with the existing download path.
- The source must contain valid 260-character A00/A01 and A02 records.
- Affiliation is seven digits and period is `AAAAMM`.
- Every pre-established A02 employee must be present in the period payroll;
  otherwise export fails with `BDS_PREESTABLISHED_EMPLOYEE_MISSING`.
- Payroll CNSS numbers must be unique and nine digits.
- Days must be integer 0–26. For a normal blank situation, days and salary
  values are required; CS/MS requires zero days and zero salaries.
- Salary cap cannot exceed real salary.
- Situation must be blank, SO, DE, IT, IL, AT, CS, MS or MP.
- B02/B03 common fields remain tied to the pre-established file. The exporter
  does not rename A records or invent family allowances.

## October 2026 reference checks

The supplied October 2026 reference contains eight B02 employees, then B03,
an empty B04, B05 with zero totals, and B06. The following B02 values are
verified by the golden test:

| Employee | CNSS | Days | Real salary (DH) | Capped salary (DH) |
|---|---:|---:|---:|---:|
| BIROUCHE AZIZ | 101323592 | 26 | 3938.75 | 3938.75 |
| HAKIMY AHMED | 114942876 | 26 | 3938.75 | 3938.75 |
| MIRA MOHAMED | 122732342 | 26 | 3767.50 | 3767.50 |
| AZOUAGH NORDINE | 141169162 | 26 | 12650.00 | 6000.00 |
| AMMOR HOCINE | 144284363 | 26 | 12650.00 | 6000.00 |
| LAHRAICHI KHADIJA | 178996174 | 26 | 3967.50 | 3967.50 |
| BENHRAF MERIEM | 185310108 | 26 | 3767.50 | 3767.50 |
| MOUAMMINE SAADIA | 186973750 | 26 | 6143.30 | 6000.00 |

For AZOUAGH NORDINE the control is:

`141169162 + 0 + 26 + 1265000 + 600000 + 0 = 143034188`,

encoded as the 19-character value `0000000000143034188`.

## Uncertainties

The local task materials include the completed October BDS fixture but not a
separate raw `AFFEBDS_7425342_202610.txt` file. The exporter supports raw A00,
A01 and A02 input according to the official layout, but a byte-for-byte test
against that missing source file cannot be performed here. The CNSS document
also distinguishes occasional labour entrants; Paie Train currently has no
export-specific occasional-labour model, so missing/invalid CNSS numbers are
rejected and must be resolved before export.
