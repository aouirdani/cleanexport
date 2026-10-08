import Link from "next/link";
import { createPublicMetadata, publicSeoPages } from "@/lib/seo";

export const metadata = createPublicMetadata(publicSeoPages[1]);

export default function HubSpotToExcelPage() {
  return (
    <>
      <h1>Export HubSpot data to Excel, automatically</h1>
      <p>
        CleanExporter turns HubSpot CRM records into an Excel workbook you can use
        directly. Choose your properties, put the columns in your preferred order,
        and receive a clean <code>.xlsx</code> file by email.
      </p>
      <section>
        <h2>What you can export from HubSpot</h2>
        <p>
          Create an export for contacts, companies, deals or tickets, using the
          objects and properties available in your connected HubSpot portal.
          Select the columns you need, apply filters, and optionally include
          columns from an associated record.
        </p>
        <p>
          For example, a sales team can export deal amounts, close dates and owner
          names for a pipeline review. A marketing team can export contact
          properties with multi-line text kept inside a single cell.
        </p>
      </section>
      <section>
        <h2>How to export HubSpot data to Excel</h2>
        <ol>
          <li>Connect your HubSpot portal and approve the read-only permissions.</li>
          <li>Create an export, choose its object type and select your properties.</li>
          <li>Arrange the columns, choose a header style and add any filters.</li>
          <li>Add email recipients, save the export and run it from the dashboard.</li>
        </ol>
        <p>
          The <Link href="/hubspot-export-guide">HubSpot export guide</Link> walks
          through the setup and the checks to make when your workbook arrives.
        </p>
      </section>
      <section>
        <h2>An Excel workbook with usable data types</h2>
        <ul>
          <li>Date properties become Excel dates you can sort and filter.</li>
          <li>Owner properties use readable names rather than numeric owner IDs.</li>
          <li>Record IDs stay as text so Excel does not round long identifiers.</li>
          <li>Accents and line breaks stay in the exported cells.</li>
          <li>Your selected column order is preserved.</li>
        </ul>
      </section>
      <section>
        <h2>Automate the next export</h2>
        <p>
          Save the definition once, then choose daily, weekly or monthly delivery
          with a timezone and email recipients. Read about
          {" "}<Link href="/scheduled-hubspot-exports">scheduled HubSpot exports</Link>
          {" "}to choose a frequency for your reporting routine.
        </p>
      </section>
      <section>
        <h2>Scope and pricing</h2>
        <p>
          CleanExporter exports CRM records. It does not import existing HubSpot
          dashboard reports. The current product supports Excel output and one
          connected portal per account.
        </p>
        <p>
          The plan includes up to 10 export definitions, with up to 5 scheduled.
          Pricing is $29/month or $290/year, with a 14-day trial. See the
          {" "}<Link href="/#pricing">pricing and included features</Link> before
          connecting your portal.
        </p>
      </section>
    </>
  );
}
