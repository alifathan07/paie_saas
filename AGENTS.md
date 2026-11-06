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
