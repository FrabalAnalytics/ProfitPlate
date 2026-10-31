This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

ProfitPlate's database foundation lives in `supabase/migrations`. Start with the [database workflow](supabase/README.md) and [schema/permissions contract](docs/Database_Foundation.md). Run `npm run db:test` for isolated checks or `npm run db:test:native` for PostgreSQL 17 concurrency checks.

## Getting Started

Authentication and the first UI slice are implemented. See [Authentication_and_UI.md](docs/Authentication_and_UI.md) for local review, session behavior, hosted Auth settings, browser tests, and remaining UI increments.

Location management is available from **Workspace → Locations**. Owners and admins can add, edit, deactivate, and reactivate locations; other active members can view them. It uses the existing audited database commands and requires no additional migration. Browser checks include the location workflow and phone/desktop layouts.

The **Inventory** workspace includes categories, recipe versions/live costs, opening stock, receipts, transfers, standard-batch production, waste, general usage, CSV sales imports, independent manager approvals, period controls and movement history. [Role workspaces and procurement](docs/Role_Workspaces_and_Procurement.md) adds team onboarding, role dashboards, a central approval queue, master data, purchasing and department requisitions. [First-version reporting](docs/First_Version_Reporting.md) supersedes earlier GM/rollout rules: Operations Manager approval, a separate Administrator, explicit additional duties, physical counts/adjustments, net sales import, COGS/food cost/margin reports, protected report revisions, CSV export and management actions. Read [Operational_Workflows.md](docs/Operational_Workflows.md) for underlying valuation policies. Reversals and release sign-off remain pending; this is a controlled test increment.

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
