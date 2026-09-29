import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from './src/lib/db.js';
import { calculateLive, generateBulletin, validateBulletin } from './src/controllers/bulletins.controller.js';
import { calculateFraisProfessionnels } from './src/payroll-engine/calculators/fraisProfessionnels.calculator.js';
import { calculateOvertime } from './src/payroll-engine/calculators/overtime.calculator.js';
import { calculateCNSSPatronale } from './src/payroll-engine/calculators/cnss.calculator.js';
import { IR_RULES } from './src/payroll-engine/rules/ir.rules.js';

const round = value => Number(value.toFixed(2));
const log = (label, value) => console.log(`\n${label}\n${JSON.stringify(value, (_key, item) => item === Infinity ? 'Infinity' : item, 2)}`);
const money = value => Number(value).toFixed(2);

function explainIRRules({ month, monthlySNI, cumulativeSNI, periods, annualSNI, annualIR, cumulativeIR, priorIR, saved }) {
  console.log(`\nBARÈME IR ANNUEL DU LOGICIEL — ${month}/2026 (montants en DH)`);
  console.log('Règle générale : annualiser le SNI cumulé, sélectionner la tranche, appliquer son taux et sa déduction.');
  console.log('IR annuel estimé = max(0, SNI annuel estimé × taux de la tranche − déduction annuelle).');
  console.log('La déduction du barème tient compte des tranches inférieures ; le taux seul ne donne pas l’IR final.');
  console.table(IR_RULES.map(rule => {
    const selected = annualSNI >= rule.min && annualSNI <= rule.max;
    return {
      'SNI annuel minimum': money(rule.min),
      'SNI annuel maximum': Number.isFinite(rule.max) ? money(rule.max) : 'Sans plafond',
      'Taux IR': `${round(rule.taux * 100)} %`,
      'Déduction annuelle': money(rule.deduction),
      'SNI annuel comparé': money(annualSNI),
      'Comparaison': annualSNI < rule.min ? 'En dessous' : annualSNI > rule.max ? 'Au-dessus' : 'DANS LA TRANCHE',
      'Tranche retenue': selected ? 'OUI' : 'Non',
      'IR annuel obtenu': selected ? money(annualIR) : '—',
    };
  }));
  const rule = IR_RULES.find(rule => annualSNI >= rule.min && annualSNI <= rule.max);
  const expectedMonthlyIR = round(cumulativeIR - priorIR);
  console.log(`\nDU SNI AU RÉSULTAT IR — ${month}/2026`);
  console.table([
    { étape: 'SNI du bulletin', calcul: 'SBI − cotisations déductibles − frais professionnels', résultat: money(monthlySNI) },
    { étape: 'SNI cumulé', calcul: 'Somme des SNI des périodes retenues, courant inclus', résultat: money(cumulativeSNI) },
    { étape: 'SNI annuel estimé', calcul: `${money(cumulativeSNI)} / ${periods} × 12`, résultat: money(annualSNI) },
    { étape: 'IR annuel estimé', calcul: `max(0, ${money(annualSNI)} × ${rule.taux} − ${money(rule.deduction)})`, résultat: money(annualIR) },
    { étape: 'IR cumulé dû', calcul: `${money(annualIR)} × ${periods} / 12`, résultat: money(cumulativeIR) },
    { étape: 'IR des bulletins précédents', calcul: 'Somme des retenues antérieures validées/clôturées', résultat: money(priorIR) },
    { étape: 'IR du mois attendu', calcul: `${money(cumulativeIR)} − ${money(priorIR)}`, résultat: money(expectedMonthlyIR) },
    { étape: 'IR du mois enregistré', calcul: 'Valeur irNet du bulletin en base de données', résultat: money(saved.irNet) },
    { étape: 'Écart enregistré − attendu', calcul: 'Doit être 0.00', résultat: money(Number(saved.irNet) - expectedMonthlyIR) },
  ]);
  console.log('Les montants calculés sont arrondis à 2 décimales à chaque étape monétaire, après application de la formule.');
  console.log('La retenue du mois régularise le cumul : elle peut différer de l’IR annuel estimé / 12.');
  console.log('Ce scénario comporte zéro charge de famille. Le barème affiché provient des règles actuelles du projet.');
  assert.equal(Number(saved.irNet), expectedMonthlyIR, 'IR enregistré = IR calculé à partir du barème annuel et du cumul');
}
function response() {
  return {
    code: 200,
    status(code) { this.code = code; return this; },
    send(message) { throw new Error(`HTTP ${this.code}: ${message}`); },
    json(data) { assert.equal(this.code, 200); assert.equal(data.ok, true); this.data = data; },
    redirect(url) { assert.equal(this.code, 200); assert.notEqual(url, '/bulletins', 'Controller failed'); this.url = url; },
  };
}

async function main() {
  const company = await prisma.company.findFirst({ orderBy: { id: 'asc' } });
  assert.ok(company, 'An existing company is required');
  const tag = randomUUID();
  const resumeId = process.argv[2] ? Number(process.argv[2]) : null;
  const employee = resumeId ? await prisma.employee.findUnique({ where: { id: resumeId } }) : await prisma.employee.create({ data: {
    companyId: company.id, matricule: `TEST-3M-${tag}`, cin: `TEST-${tag}`,
    nom: 'TEST BULLETIN', prenom: 'Trois Mois', dateNaissance: new Date('1990-01-01'),
    dateEmbauche: new Date('2026-07-01'), sexe: 'M', situationFam: 'CELIBATAIRE',
    nbPersonacharge: 0, nbEnfantCharge: 0, baseSalary: 12000,
    cimrRate: 0.06, cimrReduitBaseImposable: true,
  } });
  assert.ok(employee && employee.matricule.startsWith('TEST-3M-') && employee.nom === 'TEST BULLETIN', 'Only this test fixture may be resumed');
  if (!resumeId) assert.equal(await prisma.payslip.count({ where: { employeeId: employee.id } }), 0);
  log(resumeId ? 'Resuming test employee' : 'Fresh test employee — zero existing bulletins', employee);
  log('IR brackets used by the application', IR_RULES);
  const scenarios = [
    { month: 7, workedDays: 26, heuresSup25: 8, heuresSup50: 0, heuresSup100: 0, avances: 500, prime: 2000 },
    { month: 8, workedDays: 24, heuresSup25: 0, heuresSup50: 4, heuresSup100: 0, avances: 0, prime: 500 },
    { month: 9, workedDays: 26, heuresSup25: 0, heuresSup50: 0, heuresSup100: 2, avances: 250, prime: 1000 },
  ];
  const summary = [];
  const history = [];
  console.log('\nSNI mensuel = revenu imposable du bulletin. SNI cumulé = somme des SNI de cette année.');
  console.log('SNI annuel estimé = SNI cumulé / nombre de périodes × 12 : projection, pas revenu annuel réellement payé.');
  console.log('Dans cette application, seules les périodes antérieures VALIDATED/CLOSED du même salarié et de la même année comptent.');
  console.log('Juillet = période 1, août = période 2, septembre = période 3 pour ce nouveau salarié.');
  console.log('Ce test vérifie les règles implémentées dans le logiciel, pas leur conformité fiscale.');
  let priorSNI = 0;
  let priorIR = 0;
  for (const [index, scenario] of scenarios.entries()) {
    const { prime, ...variables } = scenario;
    const input = { ...variables, year: 2026, baseSalary: 12000,
      primesLabels: ['Prime de test'], primesAmounts: [prime],
      nimpLabels: ['Indemnité de transport test'], nimpAmounts: [650] };
    const req = { params: { id: String(employee.id) }, body: input, query: input,
      session: { user: { companyId: company.id } } };
    console.log(`\n================ BULLETIN ${scenario.month}/2026 ================`);
    log('Inputs', input);
    const preview = response();
    await calculateLive(req, preview);
    const calc = preview.data;
    assert.ok(calc, 'Preview must return calculations');
    log('Complete live calculation (employee + employer contributions)', calc);
    const frais = calculateFraisProfessionnels(calc.sbi);
    log('Calculation details', {
      base: `${input.baseSalary} / 26 × ${input.workedDays} = ${calc.baseSalary}`,
      overtime: calculateOvertime(calc.baseSalary, input.heuresSup25, input.heuresSup50, input.heuresSup100),
      cnssEmployer: calculateCNSSPatronale(calc.sbi),
      fraisProfessionnels: { base: calc.sbi, rate: frais.rate, cap: frais.cap,
        beforeCap: round(calc.sbi * frais.rate), deducted: frais.amount },
      sni: `${calc.sbi} - ${calc.cnss} - ${calc.amo} - ${calc.cimr} - ${calc.fraisPro} = ${calc.sni}`,
      netAPayer: `${calc.sbg} - ${calc.cnss} - ${calc.amo} - ${calc.cimr} - ${calc.irNet} - ${calc.avances} = ${calc.netAPayer}`,
    });
    const key = { employeeId_month_year: { employeeId: employee.id, year: 2026, month: scenario.month } };
    const existing = await prisma.payslip.findUnique({ where: key });
    if (existing?.status !== 'VALIDATED') await generateBulletin(req, response());
    const saved = await prisma.payslip.findUnique({ where: key, include: { bonuses: true } });
    assert.ok(saved, 'Generated bulletin must exist');
    for (const field of ['sbg', 'sbi', 'cnss', 'amo', 'cimr', 'fraisPro', 'sni', 'irNet', 'netAPayer']) {
      assert.equal(Number(saved[field]), calc[field], `Preview/persistence mismatch: ${field}`);
    }
    assert.equal(Number(saved.baseSalary), input.baseSalary);
    assert.equal(calc.baseSalary, round(input.baseSalary / 26 * input.workedDays));
    assert.equal(saved.moisEcoules, index + 1);
    assert.equal(Number(saved.sniCumule), round(priorSNI + calc.sni));
    assert.equal(Number(saved.irPrecedent), priorIR);
    assert.equal(Number(saved.sniAnnuelEstime), round(Number(saved.sniCumule) / (index + 1) * 12));
    assert.equal(Number(saved.irCumule), round(Number(saved.irAnnuelEstime) * ((index + 1) / 12)));
    assert.equal(calc.irNet, round(Number(saved.irCumule) - priorIR));
    const periods = index + 1;
    const cumulativeSNI = round(priorSNI + calc.sni);
    const annualSNI = round(cumulativeSNI / periods * 12);
    const bracket = IR_RULES.find(rule => annualSNI >= rule.min && annualSNI <= rule.max);
    assert.ok(bracket, 'Annualized SNI must match an annual IR bracket');
    const annualIR = round(Math.max(0, annualSNI * bracket.taux - bracket.deduction));
    const cumulativeIR = round(annualIR * (periods / 12));
    assert.equal(Number(saved.irAnnuelEstime), annualIR, 'Annual IR must use annualized SNI');
    assert.equal(Number(saved.irRate), bracket.taux);
    assert.equal(Number(saved.sommeADeduire), bracket.deduction);
    assert.equal(calc.irNet, round(cumulativeIR - priorIR));
    explainIRRules({ month: scenario.month, monthlySNI: calc.sni, cumulativeSNI, periods,
      annualSNI, annualIR, cumulativeIR, priorIR, saved });
    console.log('\nHISTORIQUE UTILISÉ POUR LA RÉGULARISATION');
    console.table([...history, { month: `${scenario.month}/2026`, SNI: calc.sni, IR: calc.irNet, role: 'Courant' }]);
    log('SNI mensuel → SNI annuel estimé → IR mensuel : calcul détaillé en DH', {
      '1. SNI du mois': `${calc.sbi} SBI - ${calc.cnss} CNSS - ${calc.amo} AMO - ${calc.cimr} CIMR déductible - ${calc.fraisPro} frais pro = ${calc.sni}`,
      '2. SNI cumulé réel': `${priorSNI} SNI antérieur + ${calc.sni} SNI courant = ${cumulativeSNI}`,
      '3. Périodes': `${index} bulletin(s) antérieur(s) + 1 courant = ${periods} (pas le numéro du mois ${scenario.month})`,
      '4. SNI moyen mensuel': `${cumulativeSNI} / ${periods} = ${cumulativeSNI / periods} (pas d’arrondi intermédiaire)`,
      '5. SNI annuel estimé': `arrondi((${cumulativeSNI} / ${periods}) × 12) = ${annualSNI}`,
      '6. Tranche annuelle retenue': { min: bracket.min, max: bracket.max, taux: bracket.taux, deductionAnnuelle: bracket.deduction },
      '7. IR théorique annuel': `${annualSNI} × ${bracket.taux} = ${round(annualSNI * bracket.taux)}`,
      '8. IR annuel estimé': `arrondi(max(0, ${annualSNI} × ${bracket.taux} - ${bracket.deduction})) = ${annualIR}`,
      '9. IR cumulé dû': `arrondi(${annualIR} × (${periods} / 12)) = ${cumulativeIR}`,
      '10. IR déjà retenu': priorIR,
      '11. IR à retenir ce mois': `${cumulativeIR} - ${priorIR} = ${calc.irNet}`,
      '12. Contrôle après retenue': `${priorIR} + ${calc.irNet} = ${round(priorIR + calc.irNet)} (doit égaler IR cumulé dû)`,
      chargesDeFamille: '0 personne à charge dans ce scénario ; la déduction familiale n’est pas testée.',
      fraisPro: 'Déduits du SBI mensuel pour obtenir le SNI ; ils ne sont pas une retenue sur le net à payer.',
    });
    assert.equal(round(priorIR + calc.irNet), cumulativeIR);
    assert.equal(calc.fraisPro, frais.amount);
    assert.equal(calc.sni, round(calc.sbi - calc.cnss - calc.amo - calc.cimr - calc.fraisPro));
    assert.equal(calc.netAPayer, Number((round(calc.sbg - calc.cnss - calc.amo - calc.cimr - calc.irNet - calc.avances) + calc.arrondi).toFixed(2)));
    assert.equal(saved.bonuses.length, 2);
    if (saved.status !== 'VALIDATED') await validateBulletin(req, response());
    const validated = await prisma.payslip.findUnique({ where: key, include: { bonuses: true } });
    assert.equal(validated.status, 'VALIDATED');
    log('All persisted fields, cumulative IR and bonus lines', validated);
    priorSNI = round(priorSNI + calc.sni);
    priorIR = round(priorIR + calc.irNet);
    history.push({ month: `${scenario.month}/2026`, SNI: calc.sni, IR: calc.irNet, role: 'Antérieur validé' });
    summary.push({ month: `${scenario.month}/2026`, bulletinId: saved.id, periode: saved.moisEcoules,
      SBI: calc.sbi, fraisPro: calc.fraisPro, SNI: calc.sni, SNIcumule: priorSNI,
      SNIannuelEstime: annualSNI, IRannuelEstime: annualIR, IRcumule: cumulativeIR,
      IRprecedent: Number(saved.irPrecedent), IR: calc.irNet, netAPayer: calc.netAPayer, status: validated.status });
  }
  assert.equal(await prisma.payslip.count({ where: { employeeId: employee.id } }), 3);
  console.table(summary);
  console.log(`PASS: three bulletins retained for test employee ${employee.id} (${employee.matricule}).`);
  console.log(`Open /bulletins/${employee.id}?month=9&year=2026`);
}

main().catch(error => { console.error('FAIL:', error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
