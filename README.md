# Research Desk

Back office for the **#ux-research** Slack channel at WalaPlus. Create polls and surveys here, colleagues answer in Slack with two taps, every answer carries the colleague's profile, and the results post goes back to the channel from here.

Slack is the front door. This app is the back office. Colleagues never sign in to it.

## What is in the box

| Part | Where | What it does |
| --- | --- | --- |
| Dashboard | `src/` | React 19 + Vite + Tailwind 4. Studies, builder with Slack preview, results with profile splits, results post, participants, settings. |
| Database | `supabase/migrations/0001_init.sql` | Studies, questions, options, participants, responses, answers, results posts, channel roster, settings, admins. Row level security: admins only. |
| Slack app | `supabase/functions/` | Four edge functions: `slack-events` (joins and leaves), `slack-interactions` (taps, profile form, survey form), `publish-due` (scheduler), `admin-actions` (buttons in the dashboard that need the bot token). |
| Scheduler | `supabase/cron.sql` | pg_cron calls `publish-due` every five minutes. |
| Slack manifest | `supabase/slack-manifest.json` | Create the Slack app from this file. |

## The rules the code enforces

- **No profile, no answer.** A colleague who taps a poll or survey without a profile gets the profile form first. The tap is remembered and saved the moment the profile is. The form is also sent by DM when a study goes live and when someone joins the channel.
- **Identified research.** Admins see who answered what, with name, age, gender, device, team and apps. The channel only ever sees totals, and any group smaller than the threshold in Settings (default 8) is written as "under 8".
- **Never asked.** The builder refuses a study that mentions PIN, OTP, card or password, in English or Arabic.
- **Not reported until posted.** A study moves to Reported only when its results post has gone to the channel.
- **One answer per member per study**, changeable until the study closes.

## Set-up, in order

### 1. Database

The schema is already applied to the "UX Lab" project if you are reading this from the first pull request. Otherwise open the SQL editor and run `supabase/migrations/0001_init.sql`.

Add yourself as admin (SQL editor):

```sql
insert into admins (email) values ('you@walaplus.com');
```

In Authentication → Providers, keep Email on. Sign in from the app with "Send sign-in link"; the first link creates the account. Set a password later from Authentication → Users if you prefer a password.

### 2. Dashboard

```bash
pnpm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the sb_publishable_ key)
pnpm dev                     # http://localhost:5173
```

Deploy anywhere static (Vercel, Netlify, Cloudflare Pages): `pnpm build`, publish `dist/`. Add the deployed URL to Authentication → URL configuration → Redirect URLs so the email link returns to the app.

### 3. Slack app

1. Go to api.slack.com/apps → Create new app → From a manifest → paste `supabase/slack-manifest.json` with `PROJECT_REF` replaced by your project ref (`lrqzizmxvgjgranooqnf`).
2. Install the app to the workspace. Copy the **Bot User OAuth Token** (`xoxb-…`) and, from Basic information, the **Signing secret**.
3. Invite the bot to the channel: `/invite @Research Desk` in #ux-research.
4. Copy the channel ID (channel details → bottom of the About tab) into Settings → Slack channel in the dashboard.

### 4. Edge functions

Set the secrets (Supabase dashboard → Edge Functions → Secrets, or the CLI):

```bash
supabase secrets set SLACK_BOT_TOKEN=xoxb-... SLACK_SIGNING_SECRET=... CRON_SECRET=$(openssl rand -hex 24)
```

Deploy (CLI; `supabase/config.toml` already turns JWT verification off for the three Slack-facing functions):

```bash
supabase link --project-ref lrqzizmxvgjgranooqnf
supabase functions deploy slack-events slack-interactions publish-due admin-actions
```

Then in the Slack app settings, Event Subscriptions and Interactivity must show the request URLs as verified (Slack calls `slack-events` with a challenge the moment you save the URL).

### 5. Scheduler

Open `supabase/cron.sql`, replace `PROJECT_REF` and `CRON_SECRET`, run it in the SQL editor. From then on scheduled studies post themselves, live studies close on their close date, the day-before reminder goes out by DM, and the channel roster is refreshed hourly.

### 6. First post

Dashboard → Participants → **Re-post profile form**. It posts and pins the profile prompt in the channel. Then create the first poll, schedule it, and watch the answers arrive.

## Development

```bash
pnpm typecheck   # tsc
pnpm build       # production bundle in dist/
deno check supabase/functions/*/index.ts   # edge functions (needs Deno 2)
```

Design tokens live in `src/styles/globals.css` (`@theme`). Colours, radii and shadows follow the WalaPlus Data Dashboards taste: Poppins, IBM Plex Sans Arabic, brand green `#00ce8b` on ink `#06352a`, WalaOne purple `#755bd8`. Icons are inline SVG in `src/components/Icon.tsx`; no icon package.

## Version two (tables already exist, pages are placeholders)

Preference tests, session recruitment and the friction inbox. See `src/pages/Friction.tsx` for what each adds.
