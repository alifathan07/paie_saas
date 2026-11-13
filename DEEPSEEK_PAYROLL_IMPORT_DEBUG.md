# DeepSeek Payroll Import Failure

The payroll-book import is not failing because of the API key or database.

The DeepSeek request succeeds, but the response is truncated:

```text
model: deepseek-flash
finishReason: "length"
messageKeys: ["role", "content", "reasoning_content"]
message.content: empty
message.reasoning_content: present
```

Because `finish_reason` is `length`, the model reaches its output-token limit before producing the final JSON response. The application then sees an empty `message.content` and throws `DEEPSEEK_EMPTY_RESPONSE`.

## Required Fix

1. Detect `finish_reason === "length"`.
2. Log token-usage and response-limit metadata.
3. Retry with a larger `max_tokens` value.
4. Prefer a non-reasoning or JSON-focused model for structured extraction when available.
5. Keep the extraction prompt short and request compact JSON only.
6. Do not parse `reasoning_content` as the final payroll data.
7. If the retry fails, show a clear “response was truncated” error.
8. Query employees and generate bulletins only after valid JSON is received and validated.

## Expected Response Shape

```json
{
  "period": { "month": 9, "year": 2026 },
  "employees": [
    {
      "matricule": "0001",
      "numeroCNSS": "141169162",
      "nomPrenom": "AZOUAGH NORDINE",
      "baseSalary": 11000,
      "workedDays": 26,
      "workedHours": 191,
      "heuresSup25": 0,
      "heuresSup50": 0,
      "heuresSup100": 0,
      "paidLeaveDays": 0,
      "avances": 0,
      "pretDeduction": 0,
      "variablePrimes": [],
      "nimpLines": []
    }
  ]
}
```
