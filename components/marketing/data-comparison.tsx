/**
 * Ported from the reference's data-comparison.tsx (row numbers, column
 * letters, formula bar, BEFORE/AFTER badges, footnote - all its visual
 * language kept) but populated with our real before/after proof instead
 * of its fictional owner-ID example: the mangled-accent Name cell and the
 * Notes field that splits one contact into four rows are both lifted
 * verbatim from our own before/after copy. Two adaptations the content
 * required: 4 columns (Name/Notes/Date created/Owner) instead of the
 * reference's 3, and 5 rows on the raw side (1 header + the 4 rows our
 * actual broken export produces) instead of its fixed 4 - our real data
 * doesn't fit its row count, so the row count follows the data.
 */
import { ExcelMark, Icon } from "./icons"

function RawSpreadsheet() {
  return (
    <figure className="spreadsheet-card spreadsheet-card--raw">
      <figcaption className="spreadsheet-heading">
        <div>
          <span className="raw-file-icon">
            <Icon name="file" size={24} />
          </span>
          <div>
            <strong>Raw HubSpot export</strong>
            <span>hubspot_export.csv</span>
          </div>
        </div>
        <span className="before-after-badge">BEFORE</span>
      </figcaption>
      <div className="sheet-formula" aria-hidden="true">
        <span>A2</span>
        <i>fx</i>
        <span>Klaus MÃ¼ller</span>
      </div>
      <div className="spreadsheet-grid">
        <table aria-label="Raw export example: one contact split across four rows, with the accent in the name mangled">
          <thead>
            <tr>
              <th className="row-number" aria-label="Row" />
              <th scope="col">A</th>
              <th scope="col">B</th>
              <th scope="col">C</th>
              <th scope="col">D</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sheet-column-names">
              <th className="row-number" scope="row">1</th>
              <td>Name</td>
              <td>Notes</td>
              <td>Date created</td>
              <td>Owner</td>
            </tr>
            <tr className="sheet-data-row">
              <th className="row-number" scope="row">2</th>
              <td className="raw-id">Klaus MÃ¼ller</td>
              <td>Interested in Enterprise plan.</td>
              <td>
                <span className="raw-date">3/1/2024</span>
              </td>
              <td className="raw-id">96879917</td>
            </tr>
            <tr className="sheet-broken-row">
              <th className="row-number" scope="row">3</th>
              <td />
              <td>Follow up after Q3 renewal.</td>
              <td />
              <td />
            </tr>
            <tr className="sheet-broken-row">
              <th className="row-number" scope="row">4</th>
              <td />
              <td>Wants pricing for 50 seats.</td>
              <td />
              <td />
            </tr>
            <tr className="sheet-broken-row">
              <th className="row-number" scope="row">5</th>
              <td />
              <td>Loop in the CS team before renewal.</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sheet-tabs" aria-hidden="true">
        <Icon name="plus" size={12} />
        <span>hubspot_export</span>
        <span className="sheet-record-status">Cleanup required</span>
      </div>
      <div className="spreadsheet-footnote">
        <Icon name="minus" size={15} />
        <span>Raw IDs. Dates as text. One record, four rows.</span>
      </div>
    </figure>
  )
}

function CleanSpreadsheet() {
  return (
    <figure className="spreadsheet-card spreadsheet-card--clean">
      <figcaption className="spreadsheet-heading">
        <div>
          <ExcelMark size={30} />
          <div>
            <strong>CleanExporter XLSX</strong>
            <span>weekly_contacts.xlsx</span>
          </div>
        </div>
        <span className="before-after-badge">AFTER</span>
      </figcaption>
      <div className="sheet-formula" aria-hidden="true">
        <span>A2</span>
        <i>fx</i>
        <span>Klaus Müller</span>
      </div>
      <div className="spreadsheet-grid">
        <table aria-label="Clean XLSX example: the same contact as one row, accent intact, notes preserved in a single cell">
          <thead>
            <tr>
              <th className="row-number" aria-label="Row" />
              <th scope="col">A</th>
              <th scope="col">B</th>
              <th scope="col">C</th>
              <th scope="col">D</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sheet-column-names">
              <th className="row-number" scope="row">1</th>
              <td>Name</td>
              <td>Notes</td>
              <td>Date created</td>
              <td>Owner</td>
            </tr>
            <tr className="sheet-data-row">
              <th className="row-number" scope="row">2</th>
              <td className="selected-cell">Klaus Müller</td>
              <td style={{ whiteSpace: "pre-wrap" }}>
                {"Interested in Enterprise plan.\nFollow up after Q3 renewal.\nWants pricing for 50 seats.\nLoop in the CS team before renewal."}
              </td>
              <td>2024-03-01</td>
              <td>Alex Rivera</td>
            </tr>
            <tr className="sheet-blank-row">
              <th className="row-number" scope="row">3</th>
              <td />
              <td>
                <span aria-hidden="true">&nbsp;</span>
              </td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="sheet-tabs" aria-hidden="true">
        <Icon name="plus" size={12} />
        <span>Weekly contacts</span>
        <span className="sheet-record-status">One record. One row.</span>
      </div>
      <div className="spreadsheet-footnote">
        <Icon name="check" size={15} />
        <span>Readable name. Real date. Owner name, not an ID.</span>
      </div>
    </figure>
  )
}

export function DataComparison() {
  return (
    <section className="section data-section" aria-labelledby="data-heading">
      <div className="container">
        <div className="section-heading centered">
          <span className="eyebrow">Proof</span>
          <h2 id="data-heading">From HubSpot&apos;s CSV to Excel-ready.</h2>
          <p>
            One contact. HubSpot&apos;s own export breaks it into four rows and mangles the accent in the name.
            CleanExporter keeps it as one row, intact.
          </p>
        </div>
        <div className="spreadsheet-comparison">
          <RawSpreadsheet />
          <CleanSpreadsheet />
        </div>
        <p className="data-caption">
          <span>
            <Icon name="check" size={13} />
          </span>
          <strong>This is the whole product. A file that is correct.</strong>
        </p>
      </div>
    </section>
  )
}
