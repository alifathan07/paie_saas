-- Existing non-taxable employee indemnities are included in the paid-leave base by default.
UPDATE employee_bonuses eb
INNER JOIN bonuses b ON b.id = eb.bonusId
SET eb.implementerEnConge = true
WHERE b.taxable = false;
