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
- **Closed before deleted.** A live study cannot be deleted, from the dashboard or straight in the database. Close it, and Delete on the study page removes the study, its answers or bookings and its images, and by default the bot's posts for it in the channel. Drafts and scheduled studies can be deleted from the editor, since nothing of theirs reached Slack.

## Set-up, in order

### 1. Database

The schema is already applied to the "UX Lab" project if you are reading this from the first pull request. Otherwise open the SQL editor and run the files in `supabase/migrations/` in order, `0001` to `0004`.

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

**Hosted copy.** Every push to `main` publishes the dashboard to GitHub Pages at https://aeltwaty-design.github.io/UX-lab2/ (workflow `.github/workflows/pages.yml`; the project URL and publishable key are written in the workflow, repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` override them). If the first run fails with a Pages error, turn on Settings → Pages → Source: GitHub Actions once. Add that URL to Supabase → Authentication → URL configuration → Site URL and Redirect URLs so the email link returns to the app. Any other static host works the same way: `pnpm build`, publish `dist/`.

### 3. Slack app

1. Go to api.slack.com/apps → Create new app → From a manifest → paste `supabase/slack-manifest.json` with `PROJECT_REF` replaced by your project ref (`lrqzizmxvgjgranooqnf`). For an app that already exists, open it → Features → App Manifest, paste the same JSON, save, then reinstall from Install App (the `commands` and `files:read` scopes and the `/friction` command need the reinstall).
2. Install the app to the workspace. If the button reads **Request to Workspace Install**, a Slack admin has to approve the request first; after approval it becomes **Install to WalaPlus**. Copy the **Bot User OAuth Token** (`xoxb-…`) and, from Basic information, the **Signing secret**.
3. Invite the bot to the channel: `/invite @research_desk` in the channel (the handle stays `research_desk` whatever the display name is).
4. Copy the channel ID (channel details → bottom of the About tab) into Settings → Slack channel in the dashboard.

### 4. Edge functions

Set the secrets (Supabase dashboard → Edge Functions → Secrets, or the CLI):

```bash
supabase secrets set SLACK_BOT_TOKEN=xoxb-... SLACK_SIGNING_SECRET=...
```

The scheduler secret needs no setting: migration `0002_cron_secret.sql` generates it inside the database and `publish-due` reads it from there. Set `CRON_SECRET` only if you want to override it.

Deploy (CLI; `supabase/config.toml` already turns JWT verification off for the three Slack-facing functions):

```bash
supabase link --project-ref lrqzizmxvgjgranooqnf
supabase functions deploy slack-events slack-interactions publish-due admin-actions
```

Then in the Slack app settings, Event Subscriptions and Interactivity must show the request URLs as verified (Slack calls `slack-events` with a challenge the moment you save the URL).

### 5. Scheduler

Open `supabase/cron.sql`, replace `PROJECT_REF`, run it in the SQL editor (already done for the "UX Lab" project). From then on scheduled studies post themselves, live studies close on their close date, the day-before reminder goes out by DM, and the channel roster is refreshed hourly.

### 6. First post

Dashboard → Participants → **Re-post profile form**. It posts and pins the profile prompt in the channel. Then create the first poll, schedule it, and watch the answers arrive.

## Development

```bash
pnpm typecheck   # tsc
pnpm build       # production bundle in dist/
deno check supabase/functions/*/index.ts   # edge functions (needs Deno 2)
```

Design tokens live in `src/styles/globals.css` (`@theme`). Colours, radii and shadows follow the WalaPlus Data Dashboards taste: Poppins, IBM Plex Sans Arabic, brand green `#00ce8b` on ink `#06352a`, WalaOne purple `#755bd8`. Icons are inline SVG in `src/components/Icon.tsx`; no icon package.

## Version two (live)

Three more things colleagues can do from Slack, all behind the same profile gate:

- **Preference test.** The builder takes two to six images (uploaded to the public `study-images` bucket) with a short label each. The post shows the images and one button per image; a tap is a poll answer, so it can be changed until the study closes. Results show each image with its share.
- **Session recruitment.** The builder takes slots (start, length, place or link, seats). The post lists the slots, strikes through full ones and offers a picker; a booking confirms by DM with a cancel button, counts against the weekly hours cap, and gets a reminder DM the day before. Moving to another slot cancels the first one. Tables `session_slots` and `session_bookings`.
- **Friction inbox.** `/friction` anywhere in Slack, or the pinned "Report a broken step" button (Friction inbox → Post the prompt), opens a form: app, what you tried, what happened, optional screenshot. The screenshot is copied into the private `friction` bucket (the Slack link is kept as a fallback). The inbox shows each report with the sender's profile; you set the status (new, fixed, duplicate, by design), keep a private note and reply by DM. Every Sunday at 09:00 Riyadh the bot posts a digest to the channel (received, fixed, open); "Send digest now" posts it on demand.

Migration `supabase/migrations/0003_version_two.sql` adds the columns, tables, view change, buckets and policies. The Slack manifest gained the `commands` and `files:read` scopes and the slash command, so an existing app needs its manifest updated and a reinstall. `0004_delete_guard.sql` adds the trigger that refuses to delete a live study.
