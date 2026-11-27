import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { SearchableSelect } from './SearchableSelect';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  headerClassName?: string;
  cellClassName?: string;
  render: (row: T, index: number, isSelected: boolean) => React.ReactNode;
}

interface PaginatedDataTableProps<T> {
  data: T[];
  columns: Array<TableColumn<T>>;
  getRowId: (row: T, index: number) => string;
  defaultPageSize?: 25 | 50 | 100;
  emptyMessage?: string;
  selectedRowId?: string | null;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  maxHeightClass?: string;
  stickyHeader?: boolean;
}

function PaginatedDataTableInner<T>({
  data,
  columns,
  getRowId,
  defaultPageSize = 50,
  emptyMessage = 'No records found.',
  selectedRowId = null,
  onRowClick,
  onRowDoubleClick,
  maxHeightClass = '',
  stickyHeader = false,
}: PaginatedDataTableProps<T>) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);

  const totalRows = data.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(totalRows, startIndex + pageSize);

  const visibleRows = useMemo(
    () => data.slice(startIndex, endIndex),
    [data, startIndex, endIndex]
  );

  return (
    <div className="flex flex-col">
      <div className={`overflow-x-auto ${maxHeightClass}`}>
        <table className="w-full text-xs text-left border-collapse">
          <thead
            className={`bg-slate-100 text-slate-700 border-b border-slate-200 ${
              stickyHeader ? 'sticky top-0 z-10' : ''
            }`}
          >
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`py-2 px-3 font-bold whitespace-nowrap ${
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                  } ${col.headerClassName || ''}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-8 text-center text-slate-500">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, idx) => {
                const rowId = getRowId(row, startIndex + idx);
                const isSelected = Boolean(selectedRowId && selectedRowId === rowId);
                return (
                  <tr
                    key={rowId}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                    className={`${onRowClick || onRowDoubleClick ? 'cursor-pointer' : ''} transition-colors ${
                      isSelected
                        ? 'bg-[#1976D2] text-white'
                        : 'hover:bg-blue-50/70 text-slate-800'
                    }`}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`py-2 px-3 ${
                          col.align === 'right'
                            ? 'text-right'
                            : col.align === 'center'
                            ? 'text-center'
                            : 'text-left'
                        } ${col.cellClassName || ''}`}
                      >
                        {col.render(row, startIndex + idx, isSelected)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Fast Pagination Footer */}
      <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
        <div className="flex items-center gap-2">
          <span>
            Showing{' '}
            <strong className="font-mono-num text-slate-800">
              {totalRows === 0 ? 0 : startIndex + 1}–{endIndex}
            </strong>{' '}
            of <strong className="font-mono-num text-slate-800">{totalRows}</strong> rows
          </span>
          <span className="text-slate-300">|</span>
          <div className="inline-flex items-center gap-1.5">
            <span>Rows/page:</span>
            <SearchableSelect
              ariaLabel="Rows per page"
              value={String(pageSize)}
              onChange={(val) => {
                setPageSize(Number(val) || 50);
                setPage(1);
              }}
              sortAlphabetically={false}
              pinEmptyOptionFirst={false}
              options={['25', '50', '100']}
              className="w-20"
              buttonClassName="!py-0.5 !px-2 !text-[11px] font-mono-num"
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(1)}
            className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            title="First Page"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            title="Previous Page"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 font-mono-num font-semibold text-slate-800">
            Page {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            title="Next Page"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage(totalPages)}
            className="p-1 rounded border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
            title="Last Page"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export const PaginatedDataTable = React.memo(
  PaginatedDataTableInner
) as typeof PaginatedDataTableInner;
