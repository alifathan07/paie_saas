import prisma from "../../db.ts";

const ELIGIBLE_STATUSES = ["VALIDATED", "CLOSED"];

function validatePeriod({ employeeId, companyId, year, month }) {
    const employee = Number(employeeId);
    const company = Number(companyId);
    const targetYear = Number(year);
    const targetMonth = Number(month);
    if (!Number.isInteger(employee) || employee <= 0
        || !Number.isInteger(company) || company <= 0
        || !Number.isInteger(targetYear) || targetYear < 1
        || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
        throw new Error("BIRTH_LEAVE_PERIOD_INVALID");
    }
    return { employeeId: employee, companyId: company, year: targetYear, month: targetMonth };
}

export async function listBirthLeaveReferencePayslips(period, client = prisma) {
    const target = validatePeriod(period);
    // Only finalized prior months are stable historical inputs; the current payslip
    // is excluded because its SBI would include the birth-leave compensation itself.
    return client.payslip.findMany({
        where: {
            employeeId: target.employeeId,
            employee: { companyId: target.companyId },
            status: { in: ELIGIBLE_STATUSES },
            OR: [
                { year: { lt: target.year } },
                { year: target.year, month: { lt: target.month } },
            ],
            AND: [{
                OR: [
                    { workingTimeMode: "DAYS", workedDays: { gt: 0 } },
                    { workingTimeMode: "HOURS", workedHours: { gt: 0 } },
                    {
                        workingTimeMode: null,
                        OR: [{ workedDays: { gt: 0 } }, { workedHours: { gt: 0 } }],
                    },
                ],
            }],
        },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        take: 12,
        select: {
            year: true,
            month: true,
            status: true,
            workedDays: true,
            workedHours: true,
            workingTimeMode: true,
            sbi: true,
        },
    });
}
