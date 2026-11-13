-- Client accounts require email verification by default.
UPDATE `users`
SET `twoFactorEnabled` = true
WHERE `isAdmin` = false;

ALTER TABLE `users`
    ALTER COLUMN `twoFactorEnabled` SET DEFAULT true;
