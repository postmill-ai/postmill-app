// CSV/JSON export serialization extracted from analytics.service.ts (5.3).
// Pure formatting over an already-computed overview — no deps, so it does not
// need (and must not inject) the facade's getOverview. The facade fetches the
// overview then delegates the row-flatten + serialization here.

import { Injectable } from '@nestjs/common';
import { AnalyticsOverviewResponse } from './analytics.types';

@Injectable()
export class AnalyticsExportService {
  escapeCSVField(value: string): string {
    const str = String(value);
    if (
      str.includes(',') ||
      str.includes('"') ||
      str.includes('\n') ||
      str.includes('\r')
    ) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  toExport(
    overview: AnalyticsOverviewResponse,
    format: string
  ): { data: string; contentType: string } {
    const rows = overview.kpis.flatMap((kpi) =>
      kpi.sparkline.map((point) => ({
        metric: kpi.metric,
        label: kpi.label,
        format: kpi.format,
        total: kpi.total,
        percentageChange: kpi.percentageChange,
        date: point.date,
        value: point.value,
      }))
    );

    if (format === 'csv') {
      const header = 'metric,label,format,total,percentage_change,date,value\n';
      const lines = rows.map((r) =>
        [
          r.metric,
          r.label,
          r.format,
          String(r.total),
          r.percentageChange ?? '',
          r.date,
          String(r.value),
        ]
          .map((field) => this.escapeCSVField(String(field)))
          .join(',')
      );
      return { data: header + lines.join('\n'), contentType: 'text/csv' };
    }

    return {
      data: JSON.stringify(rows, null, 2),
      contentType: 'application/json',
    };
  }
}
