import { PageHeader } from "@/components/AppShell";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";

export default function Friction() {
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-2">Friction inbox <Chip tone="v2">version two</Chip></span>} sub="Colleagues report a broken step from Slack. Each report lands here with the app, the screen and who sent it." />
      <div className="px-7 pb-8 max-w-2xl">
        <Card title="What version two adds">
          <ul className="text-[13px] text-ink-2 space-y-2 list-disc pl-5">
            <li>A slash command in Slack, /friction, that opens a short form: app, what you tried, what happened, a screenshot.</li>
            <li>Reports arrive here with the sender's profile, so you can reply by DM and tag the report fixed, duplicate or by design.</li>
            <li>A weekly digest to the channel: reports received, fixed, still open.</li>
          </ul>
          <p className="text-[12.5px] text-muted mt-4">The friction_reports table already exists in the schema, so version two is a Slack command and this page, nothing more.</p>
        </Card>
      </div>
    </>
  );
}
