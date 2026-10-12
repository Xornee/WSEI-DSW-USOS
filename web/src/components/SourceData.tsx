import { ArrowUpRight, Check, Copy, Info } from "lucide-react";
import { useState } from "react";
import type { AccountSection, SourceTable } from "../../../shared/sections";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";

export function CopyValue({ value }: { value: string }) {
  const [status, setStatus] = useState("");
  return (
    <button
      className="copy-value"
      aria-label={status || "Kopiuj wartość"}
      title={status || "Kopiuj wartość"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setStatus("Skopiowano");
        } catch {
          setStatus("Zaznacz i skopiuj tekst ręcznie");
        }
      }}
    >
      {status === "Skopiowano" ? <Check size={13} /> : <Copy size={13} />}
      <span className="sr-only" role="status">
        {status}
      </span>
    </button>
  );
}

export function SourceTableView({
  table,
  copyable = false,
}: {
  table: SourceTable;
  copyable?: boolean;
}) {
  return (
    <Card className="source-table-card">
      <div className="card-header">
        <h2>{table.title}</h2>
        <span className="muted">Pozycje: {table.rows.length}</span>
      </div>
      <div className="table-scroll">
        <table className="source-table">
          <caption className="sr-only">{table.title}</caption>
          <thead>
            <tr>
              {table.headers.map((header, i) => (
                <th key={i} scope="col">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    <div className="source-cell">
                      {cell.text !==
                        cell.links.map((link) => link.label).join(" ") && (
                        <span className="source-text">{cell.text || "—"}</span>
                      )}
                      {copyable && cell.text && <CopyValue value={cell.text} />}
                    </div>
                    {cell.links.map((link) => (
                      <a
                        className="source-link"
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.label}
                        <ArrowUpRight size={12} />
                      </a>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.footer.length > 0 && (
        <div className="source-table-footer">
          {table.footer.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </Card>
  );
}

export function SectionData({
  data,
  copyable = false,
}: {
  data: AccountSection;
  copyable?: boolean;
}) {
  const populated = data.tables.filter((table) => table.rows.length > 0);
  return (
    <div className="source-section">
      {data.messages.length > 0 && (
        <details className="source-notes" open={data.state !== "ready"}>
          <summary>
            <Info size={15} />
            Informacje z USOSweb
          </summary>
          <div>
            {data.messages.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        </details>
      )}
      {populated.map((table, i) => (
        <SourceTableView key={i} table={table} copyable={copyable} />
      ))}
      {data.records.map((record, i) => (
        <Card className="source-record" key={i}>
          <h2>{record.title}</h2>
          <p className="source-text">{record.text}</p>
          <div className="source-record-links">
            {record.links.map((link) => (
              <a
                key={link.url}
                className="button button-secondary"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
                <ArrowUpRight size={14} />
              </a>
            ))}
          </div>
        </Card>
      ))}
      {!populated.length && !data.records.length && (
        <Card>
          <EmptyState
            title={
              data.state === "empty"
                ? "Brak pozycji w tej sekcji"
                : "Informacje dostępne w USOSweb"
            }
            description={
              data.state === "empty"
                ? "Pobrane źródło nie zawiera pozycji do wyświetlenia. Komunikat uczelni znajdziesz powyżej."
                : "Źródło zawiera opis lub formularz, a nie listę rekordów. Szczegóły i dostępne działania sprawdzisz w USOSweb."
            }
          />
        </Card>
      )}
      <div className="source-bottom-links">
        {data.links
          .filter(
            (link) =>
              !populated.some((table) =>
                table.rows.some((row) =>
                  row.some((cell) =>
                    cell.links.some((item) => item.url === link.url),
                  ),
                ),
              ) &&
              !data.records.some((record) =>
                record.links.some((item) => item.url === link.url),
              ),
          )
          .slice(0, 8)
          .map((link) => (
            <a
              key={link.url}
              className="text-link"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {link.label}
              <ArrowUpRight size={13} />
            </a>
          ))}
      </div>
    </div>
  );
}
