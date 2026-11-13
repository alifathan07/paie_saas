SET @pret_monthly_amount_exists = (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'prets'
      AND column_name = 'monthlyAmount'
);

SET @pret_monthly_amount_ddl = IF(
    @pret_monthly_amount_exists = 0,
    'ALTER TABLE `prets` ADD COLUMN `monthlyAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0',
    'SELECT 1'
);

PREPARE pret_monthly_amount_statement FROM @pret_monthly_amount_ddl;
EXECUTE pret_monthly_amount_statement;
DEALLOCATE PREPARE pret_monthly_amount_statement;
