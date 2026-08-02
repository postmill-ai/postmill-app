import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

import { DataTable, type Column } from './data-table';

type Row = { id: string; name: string };

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', render: (r) => <span>{r.name}</span> },
];

const rows: Row[] = [
  { id: 'f1', name: 'alpha.png' },
  { id: 'f2', name: 'beta.png' },
];

const folderRows = (
  <tr data-testid="folder-row">
    <td>Brand assets</td>
  </tr>
);

afterEach(cleanup);

describe('DataTable leadingRows', () => {
  it('renders leading rows above the data rows', () => {
    render(
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(r) => r.id}
        leadingRows={folderRows}
      />
    );

    const bodyRows = screen.getAllByRole('row').filter((r) => r.closest('tbody'));
    expect(bodyRows[0].getAttribute('data-testid')).toBe('folder-row');
    expect(bodyRows).toHaveLength(3);
  });

  it('renders the table (not the empty state) when data is empty but leadingRows exist', () => {
    // A folder-only directory must not read "No files found".
    render(
      <DataTable
        columns={columns}
        data={[]}
        keyExtractor={(r) => r.id}
        emptyState={{ title: 'No files found' }}
        leadingRows={folderRows}
      />
    );

    expect(screen.queryByText('No files found')).toBeNull();
    expect(screen.getByTestId('folder-row')).toBeTruthy();
  });

  it('still shows the empty state when there is nothing at all', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        keyExtractor={(r) => r.id}
        emptyState={{ title: 'No files found' }}
      />
    );

    expect(screen.getByText('No files found')).toBeTruthy();
  });

  it('excludes leading rows from select-all', () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        keyExtractor={(r) => r.id}
        selectedIds={[]}
        onSelectionChange={onSelectionChange}
        leadingRows={folderRows}
      />
    );

    fireEvent.click(screen.getByLabelText('Select all rows'));

    // Only the file ids — folders never enter the selection model.
    expect(onSelectionChange).toHaveBeenCalledWith(['f1', 'f2']);
  });

  it('leaves existing consumers unchanged when leadingRows is omitted', () => {
    render(<DataTable columns={columns} data={rows} keyExtractor={(r) => r.id} />);

    const bodyRows = screen.getAllByRole('row').filter((r) => r.closest('tbody'));
    expect(bodyRows).toHaveLength(2);
  });
});
