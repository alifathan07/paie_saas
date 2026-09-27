export const calculateMonths = (dateEmbauche, targetDate = new Date()) => {
  if (!dateEmbauche) return 0;
  const target = new Date(targetDate);
  const start = new Date(dateEmbauche);

  let months =
    (target.getFullYear() - start.getFullYear()) * 12 +
    (target.getMonth() - start.getMonth());

  if (target.getDate() < start.getDate()) {
    months--;
  }

  return Math.max(0, months);
};
