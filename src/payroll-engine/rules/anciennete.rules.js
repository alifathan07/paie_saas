export const getAncienneteRate = (months) => {
  if (months >= 24 && months < 60) {
    return 0.05; // 2 à 5 ans : 5%
  } else if (months >= 60 && months < 144) {
    return 0.10; // 5 à 12 ans : 10%
  } else if (months >= 144 && months < 240) {
    return 0.15; // 12 à 20 ans : 15%
  } else if (months >= 240 && months < 300) {
    return 0.20; // 20 à 25 ans : 20%
  } else if (months >= 300) {
    return 0.25; // 25 ans et plus : 25%
  }

  return 0;
};
