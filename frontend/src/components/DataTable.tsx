import type { ReactNode } from "react";

/**
 * Dense table from history.html: muted 0.75rem headers, hairline rule above
 * every body cell, mint/bad status text, and an optional highlighted row with
 * the inset mint bar on its first cell.
 */
export type ColumnStatus = "ok" | "no" | null;

export type DataTableColumn<Row> = {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Render the cell in the mono face. Use for numbers, hashes, addresses. */
  mono?: boolean;
  /** Colour the cell mint (`ok`) or bad (`no`). */
  status?: (row: Row) => ColumnStatus;
};

type DataTableProps<Row> = {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Shown across the full width when there is nothing to list. */
  emptyMessage: string;
  /** Marks the row that the detail view is showing. */
  highlight?: (row: Row) => boolean;
  onSelectRow?: (row: Row) => void;
};

export default function DataTable<Row>({
  columns,
  rows,
  rowKey,
  emptyMessage,
  highlight,
  onSelectRow,
}: DataTableProps<Row>) {
  return (
    <table className="table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td className="table-empty" colSpan={columns.length}>
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row) => {
            const isHit = highlight ? highlight(row) : false;
            const rowClasses = [
              isHit ? "hit" : "",
              onSelectRow ? "selectable" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <tr
                key={rowKey(row)}
                className={rowClasses || undefined}
                onClick={onSelectRow ? () => onSelectRow(row) : undefined}
                onKeyDown={
                  onSelectRow
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectRow(row);
                        }
                      }
                    : undefined
                }
                tabIndex={onSelectRow ? 0 : undefined}
                aria-selected={onSelectRow ? isHit : undefined}
              >
                {columns.map((column) => {
                  const status = column.status ? column.status(row) : null;
                  const classes = [
                    column.mono ? "mono" : "",
                    status ?? "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <td key={column.key} className={classes || undefined}>
                      {column.render(row)}
                    </td>
                  );
                })}
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}
