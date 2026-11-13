UPDATE `users` AS target
LEFT JOIN `users` AS existing
    ON existing.`username` = LOWER(SUBSTRING_INDEX(target.`email`, '@', 1))
    AND existing.`id` <> target.`id`
LEFT JOIN `users` AS duplicate_email
    ON duplicate_email.`id` <> target.`id`
    AND LOWER(SUBSTRING_INDEX(duplicate_email.`email`, '@', 1)) = LOWER(SUBSTRING_INDEX(target.`email`, '@', 1))
SET target.`username` = LOWER(SUBSTRING_INDEX(target.`email`, '@', 1))
WHERE target.`username` IS NULL
  AND existing.`id` IS NULL
  AND duplicate_email.`id` IS NULL;

UPDATE `users`
SET `username` = CONCAT(
    LEFT(LOWER(SUBSTRING_INDEX(`email`, '@', 1)), 54),
    '_',
    `id`
)
WHERE `username` IS NULL;
