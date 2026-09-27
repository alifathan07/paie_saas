

export const employees = [
  {
    id: 1,
    name: "Ali",
    baseSalary: 12000,
    dateEmbauche: "2020-03-10", // ~6 years, comfortably mid-bracket
    bonuses: [
      { name: "Prime de Rendement", amount: 1500, taxable: true },
      { name: "Indemnité de Transport", amount: 500, taxable: false }
    ],
    dependents: 2
  },
  {
    id: 2,
    name: "Omard",
    baseSalary: 6500,
    dateEmbauche: "2024-08-25", // ~3 years
    bonuses: [
      { name: "Prime de Rendement", amount: 800, taxable: true }
    ],
    dependents: 0
  },
  {
    id: 3,
    name: "Sara",
    baseSalary: 4000,
    dateEmbauche: "2025-05-01", // ~1 year
    bonuses: [],
    dependents: 6
  },
  {
    id: 4,
    name: "Youssef",
    baseSalary: 20000,
    dateEmbauche: "2021-08-24", // EXACTLY 5 years ago today — ancienneté tier boundary test
    bonuses: [
      { name: "Prime de Rendement", amount: 3000, taxable: true },
      { name: "Indemnité de Logement", amount: 1000, taxable: true }
    ],
    dependents: 4
  },
  {
    id: 5,
    name: "Hind",
    baseSalary: 3000,
    dateEmbauche: "2026-05-15", // hired 3 months ago — under 2 years, naive-subtraction trap if you did currentYear - hireYear
    bonuses: [],
    dependents: 7
  }

];