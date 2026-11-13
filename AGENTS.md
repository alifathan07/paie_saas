
# Architecture Understanding — Mandatory Workflow

My goal is to become an independent software engineer, not just someone who delegates everything to AI agents.

Every agent working on this repository must help me understand the architecture.

## Before Implementation
1. Identify the relevant files and modules.
2. Explain the existing implementation.
3. Trace the actual request-to-database-to-response flow.
4. Identify architectural layers and dependencies.
5. Explain why each module has its responsibility.
6. Identify risks to payroll calculations, company isolation and historical data.
7. For complex changes, propose an implementation plan and wait for approval.

Do not modify files before completing the analysis.

## During Implementation
- Make targeted changes.
- Preserve existing architecture and business rules.
- Explain important engineering decisions.
- Avoid unnecessary rewrites.

## After Implementation
1. Explain every important file changed.
2. Explain how the modified modules communicate.
3. Describe runtime execution.
4. Explain tests and edge cases.
5. Identify technical debt and weaknesses.
6. Explain what I should inspect manually.

## Knowledge Verification
After significant architectural changes:
- Ask me three technical questions.
- Wait for my answers.
- Correct misunderstandings.
- Do not assume that reading an explanation means understanding it.

## Payroll Generation Architecture Exercise

When requested, analyze the complete payslip-generation flow without modifying files.

Trace:

1. EJS page initiating the request.
2. Frontend JavaScript.
3. Express route.
4. Middleware.
5. Controller.
6. Services.
7. PayrollEngine.
8. Prisma models and database queries.
9. Payslip persistence.
10. Response and frontend display.

For each step, provide exact file paths, functions, inputs, outputs and dependencies.

Create a Mermaid sequence diagram representing the actual execution.

Distinguish verified behavior from assumptions. Never invent missing architectural details.

Finally, identify five architectural concepts I need to understand to maintain this flow independently.

## Non-negotiable objective

Help me become capable of understanding, debugging, maintaining and architecting this application independently.

AI should increase my engineering capabilities, never replace my engineering judgment.
# Project Instructions

## Project
Moroccan payroll management application.

## Technology
- Node.js
- Express
- EJS
- Bootstrap
- MySQL
- Prisma

## Architecture
Follow the existing application architecture.
Do not introduce a new framework or redesign the application without explicit approval.

## Critical Rules

### Payroll
- Payroll calculations are sensitive business logic.
- Never invent tax rates, contribution rates, caps or legal rules.
- Reuse existing calculation services.
- Preserve calculation precision and rounding conventions.
- Distinguish taxable and non-taxable elements.

### Security
- Preserve authentication and authorization.
- Every company-owned query must respect the active company boundary.
- Never trust company IDs supplied directly by clients.
- Validate user input.
- Never expose sensitive employee information.

### Database
- Inspect Prisma schema before changing models.
- Avoid destructive migrations.
- Preserve existing relationships and constraints.
- Use transactions when operations require atomicity.

### Development
- Inspect relevant files before implementation.
- Prefer targeted changes.
- Avoid unrelated refactoring.
- Do not duplicate existing functionality.
- Run relevant tests after changes.

## Documentation
Read relevant documents in docs/ before modifying complex features.

### Application documentation
- [System overview](docs/architecture/SYSTEM_OVERVIEW.md)
- [Authentication and authorization](docs/architecture/AUTH_AND_AUTHORIZATION.md)
- [Database schema](docs/database/DATABASE_SCHEMA.md)
- [Payroll workflow](docs/business/PAYROLL_WORKFLOW.md)
- [Implemented Moroccan payroll rules](docs/business/MOROCCAN_PAYROLL_RULES.md)
- [Business constraints and caveats](docs/business/BUSINESS_CONSTRAINTS.md)
- [Coding conventions](docs/development/CODING_CONVENTIONS.md)
- [Development and deployment commands](docs/development/COMMANDS.md)

## Agent Responsibilities
- Researcher: investigation only.
- Implementer: implementation.
- Reviewer: independent review, no modifications.

## Completion
Always report modified files, verification results and unresolved risks.
