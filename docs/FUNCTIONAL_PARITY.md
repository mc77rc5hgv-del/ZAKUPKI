# Functional parity target

The product target is functional parity with the core operator workflows described by Kontur.Zakupki, adapted to the data and actions actually available on RTS Market. It does not copy Kontur source code, branding, or interface.

Official reference pages:

- https://zakupki.kontur.ru/site/features
- https://zakupki.kontur.ru/site/features/filter
- https://zakupki.kontur.ru/site/features/analytic
- https://zakupki.kontur.ru/site/features/komandnaya-rabota
- https://zakupki.kontur.ru/site/features/uvedomleniya-na-pochtu
- https://zakupki.kontur.ru/price

## Capability matrix

| Workflow | Current implementation | Remaining parity work | Priority |
|---|---|---|---|
| Search and filters | Keywords, exclusions, price, customer, region, territorial districts, status, OKPD2, deadlines, documents, sorting; native RTS filter adapter | Exact phrase/morphology, industry tree, procurement type/law, SME/advantages, advance payment, origin/manufacturer, urgent orders, saved-query quality metrics | P0 |
| Results | RTS cards with title, order number, price, buyer, region, status and deadline | Facets, result deduplication across sources, hidden/archive reasons, Excel export | P0 |
| Notifications | Telegram watches for new matching tenders and changes | Delivery schedules, quiet hours, grouped urgent digest, per-user channels, notification history/retry UI | P0 |
| Tender analysis | Dossier, completeness/risk checks, document download, comparison, change tracking | Similar tenders, protocol/contract history, participant extraction, winner price and discount, explainable risk score | P1 |
| Customer/supplier analysis | Organization details discovered from RTS pages | INN/OGRN lookup, participation/win statistics, customer reliability, competitor graph, FAS/court/public-source enrichment | P1 |
| Market analytics | Bid economics and tender comparison | Demand volume, average contract value, regions, customers, suppliers, seasonality, PDF/Excel reports | P1 |
| Team workflow | Pipeline, statuses, assignee, notes, deadlines and history | Multiple roles, comments, audit journal, task reminders, workload dashboard, exports/webhooks | P1 |
| Participation | Readiness checklist, work plan, safe offer draft preview | Reusable document vault, requirement-to-document mapping, controlled form filling, explicit confirmation flow | P2 |
| Integrations | Telegram Mini App, bot, MCP bridge and local RTS agent | Stable public API, CRM/webhooks, email delivery, calendar sync | P2 |

## Acceptance rules

1. Search acceptance uses live RTS fixtures plus deterministic unit tests. A visible RTS card must appear with an empty filter and with every matching individual filter.
2. Monitoring reuses the same search engine as interactive search; no separate filtering semantics are allowed.
3. Every notification is idempotent and contains the canonical RTS URL, matched filters and deadline.
4. Automated actions that can create legal consequences remain preview-only until the user gives an explicit, operation-specific confirmation.
5. Credentials, cookies, CAPTCHA, SMS codes and electronic-signature PINs remain on the user's computer and are never returned to Railway or Telegram.
