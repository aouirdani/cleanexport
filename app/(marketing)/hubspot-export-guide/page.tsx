import Link from "next/link";
import { createPublicMetadata, publicSeoPages } from "@/lib/seo";

export const metadata = createPublicMetadata(publicSeoPages[3]);

export default function HubSpotExportGuidePage() {
  return (
    <>
      <h1>How to export HubSpot data to Excel</h1>
      <p>
        Start by deciding which CRM records and columns your spreadsheet needs.
        This guide shows how to create an Excel export with CleanExporter, check
        the workbook and reuse the same setup for recurring delivery.
      </p>
      <section>
        <h2>1. Define what belongs in the spreadsheet</h2>
        <p>
          Choose one object type: contacts, companies, deals or tickets. For a
          pipeline review, start with deals and select the properties used in
          your review, such as amount, close date and owner. Use properties
          available in your portal rather than assuming every HubSpot account
          has the same fields.
        </p>
        <p>
          If you need an existing dashboard report, note the distinction:
          CleanExporter exports CRM records and selected properties. It does
          not import a saved HubSpot dashboard report or reproduce its charts.
        </p>
      </section>
      <section>
        <h2>2. Connect HubSpot with read-only access</h2>
        <p>
          Open <Link href="/">CleanExporter</Link> and choose Connect HubSpot.
          Select your portal and approve the requested permissions. The
          connection reads your CRM data; it does not write changes back to
          contacts, companies or deals. Access can be revoked from HubSpot.
        </p>
        <p>Each CleanExporter account connects to one portal in the current product.</p>
      </section>
      <section>
        <h2>3. Create the export and arrange its columns</h2>
        <p>
          In the dashboard, choose New export, give it a recognizable name and
          select its object type. Pick the properties you need and drag them
          into the order you want in Excel. Choose labels, internal property
          names or both for the column headers.
        </p>
        <p>
          Add filters if you only need a subset of records. Optionally include
          columns from an associated record. Use the preview to check selected
          columns and sample values before saving.
        </p>
      </section>
      <section>
        <h2>4. Run an export and check the workbook</h2>
        <p>
          Add at least one recipient to receive the file, save the definition
          and choose Run now. Follow its status in run history. When it
          succeeds, open the emailed download link or download the file from
          the dashboard.
        </p>
        <ul>
          <li>Check that the column order and headers match your intended layout.</li>
          <li>Sort a date column to confirm it contains Excel dates.</li>
          <li>Check a long record ID: it should remain intact as text.</li>
          <li>Inspect a multi-line field to confirm the text stays within its cell.</li>
          <li>Compare a few records with HubSpot to confirm your filters select the intended data.</li>
        </ul>
        <p>
          See <Link href="/hubspot-to-excel">what CleanExporter preserves in Excel exports</Link>
          {" "}for more about dates, owner names and identifiers.
        </p>
      </section>
      <section>
        <h2>5. Reuse the definition on a schedule</h2>
        <p>
          When creating the export, choose a daily, weekly or monthly schedule
          if you want recurring delivery. Check the timezone and recipients
          before saving. Follow the
          {" "}<Link href="/scheduled-hubspot-exports">scheduled export setup</Link>
          {" "}for the available frequencies and times.
        </p>
        <p>
          If a run fails, read its status and error in run history before trying
          again. If your portal is disconnected, use the dashboard reconnect
          prompt to restore access.
        </p>
      </section>
    </>
  );
}
