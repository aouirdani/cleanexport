import Link from "next/link";
import { createPublicMetadata, publicSeoPages } from "@/lib/seo";

export const metadata = createPublicMetadata(publicSeoPages[2]);

export default function ScheduledHubSpotExportsPage() {
  return (
    <>
      <h1>Schedule your HubSpot exports automatically</h1>
      <p>
        Set up a recurring Excel export of your HubSpot CRM records with
        CleanExporter. Keep the same properties, filters and column order for
        each run, and have the generated workbook delivered to your recipients
        by email.
      </p>
      <section>
        <h2>Choose a schedule for your reporting routine</h2>
        <ul>
          <li><strong>Daily:</strong> an export scheduled for 6am each day.</li>
          <li><strong>Weekly:</strong> an export scheduled for Monday at 6am.</li>
          <li><strong>Monthly:</strong> an export scheduled for the first day of the month at 6am.</li>
        </ul>
        <p>
          Times use the timezone selected in the export settings. The schedule
          starts the export job; delivery follows after the workbook has been
          generated. You can also keep an export on manual runs only.
        </p>
      </section>
      <section>
        <h2>Set up a scheduled HubSpot export</h2>
        <ol>
          <li>Connect the HubSpot portal you want to export from.</li>
          <li>Choose contacts, companies, deals or tickets and select your properties.</li>
          <li>Set the column order and any filters or associated columns.</li>
          <li>Select a schedule and check its timezone.</li>
          <li>Add the email recipients and save your export definition.</li>
        </ol>
        <p>
          For the full walkthrough, follow the
          {" "}<Link href="/hubspot-export-guide">HubSpot export guide</Link>.
          Scheduled delivery requires at least one recipient; the builder accepts
          up to 10 email addresses.
        </p>
      </section>
      <section>
        <h2>Use recurring exports for regular reviews</h2>
        <p>
          A weekly deal export can support a Monday pipeline review. A monthly
          company export can provide a repeatable CRM snapshot. Each run uses
          the saved export definition to fetch matching records from your
          connected portal.
        </p>
        <p>
          The result is a <Link href="/hubspot-to-excel">HubSpot-to-Excel workbook</Link>
          {" "}with real dates, readable owner names and record IDs stored as text.
          It is an export of CRM records, rather than a copy of a HubSpot dashboard report.
        </p>
      </section>
      <section>
        <h2>Follow each run from the dashboard</h2>
        <p>
          Check run history to see whether an export is queued, running,
          successful or failed. Download completed files from the dashboard,
          and use the existing pause and resume controls when you need to stop
          or restart an export.
        </p>
        <p>
          The current plan supports up to 10 export definitions, with up to
          5 scheduled, for one connected portal per account. Review the
          {" "}<Link href="/#pricing">plan details</Link> before setting up your schedules.
        </p>
      </section>
    </>
  );
}
