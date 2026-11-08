# CNSS BDS reference comparison

## October 2026 golden comparison

`test_cnss_bds_generation.js` feeds the supplied completed October 2026 file
back through the exporter as source data and compares the generated payload
byte-for-byte. The comparison passes with the same CRLF line endings and 260
character records.

The reference has this structure:

`B00 → B01 → 8×B02 → B03 → empty B04 → B05 → B06`

The golden comparison verifies all eight employee identifiers, names, 26
declared days, real salaries, capped salaries, and horizontal controls. In
particular, AZOUAGH NORDINE is encoded as:

`141169162 + 0 + 26 + 1265000 + 600000 + 0 = 143034188`

with control field `0000000000143034188`.

## What was wrong in the previous implementation

- It enriched A02 records in place and retained the A-type/pre-established
  structure instead of producing the seven B record types.
- It omitted unmatched pre-established employees, although CNSS requires all
  A02 employees to be present in B02.
- It rebuilt B01 from partial company columns, potentially changing activity,
  agency and dates that must remain equal to A01.
- It allowed application employee identity/family-allowance fields to replace
  the official pre-established values.
- It did not emit the complete B03/B04/B05/B06 sequence in the old format.
- It treated a generated text file as sufficient without validating the
  documented fixed-width fields and control totals.

## Corrected behavior tested

- Seven record types are emitted in CNSS order and every record is exactly 260
  characters.
- B00/B01 preserve the pre-established payload, changing only the record type.
- B02 real salary is sourced from `Payslip.sbg` and capped using the existing
  `PayrollConfig.cnssPlafond` value.
- B03/B05/B06 totals are recomputed from emitted details.
- No entrants still emits an empty B04 and a zero B05.
- Missing/invalid payroll CNSS numbers, duplicate payroll numbers, missing
  pre-established employees, period mismatch and affiliation mismatch fail
  explicitly.

The local workspace does not contain a separate raw
`AFFEBDS_7425342_202610.txt` file, so the raw-A-file-to-completed-file byte
comparison remains an unresolved fixture gap. The parser and golden test do
support A00/A01/A02 input layouts documented by CNSS.
