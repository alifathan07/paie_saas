ALTER TABLE `users`
    ADD COLUMN `username` VARCHAR(191) NULL,
    ADD COLUMN `twoFactorEnabled` BOOLEAN NOT NULL DEFAULT false;

UPDATE `users`
SET `username` = CONCAT('user_', `id`)
WHERE `username` IS NULL;

ALTER TABLE `users`
    ADD UNIQUE INDEX `users_username_key`(`username`);
