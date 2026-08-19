/**
 * chart-utils.js
 * ---------------------------------------------------------------------------
 * Pure SVG chart builders. No storage access, no framework — returns an SVG
 * markup string that a page injects via `.innerHTML` (the same pattern
 * already used for the dashboard's day-ring). Categorical x-axis (points
 * are spaced evenly by index, not by literal date distance) so charts stay
 * readable regardless of how irregularly someone logs data.
 *
 * Every builder returns null when there's no numeric data to plot — callers
 * show "No data entered" rather than an empty/misleading chart.
 * ---------------------------------------------------------------------------
 */

const ChartUtils = (() => {

  const COLORS = ['#3B6E52', '#D9784A', '#55634F', '#8A9585', '#294F3A', '#C9A227'];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * seriesArray: [{ label, color?, points: [{ x: string, y: number }] }]
   * opts: { width, height, yUnit, targetY, targetLabel, yDecimals }
   */
  function buildLineChartSVG(seriesArray, opts = {}) {
    const width = opts.width || 640;
    const height = opts.height || 220;
    const yUnit = opts.yUnit || '';
    const pad = { top: 18, right: 16, bottom: 30, left: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const series = (seriesArray || []).filter(s => s.points && s.points.length);
    const allX = [...new Set(series.flatMap(s => s.points.map(p => p.x)))].sort();
    if (!allX.length) return null;

    const allY = series.flatMap(s => s.points.map(p => p.y)).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (opts.targetY != null) allY.push(opts.targetY);
    if (!allY.length) return null;

    let min = Math.min(...allY), max = Math.max(...allY);
    if (min === max) { min -= 1; max += 1; }
    const rangePad = (max - min) * 0.08;
    min -= rangePad; max += rangePad;

    const xIndex = new Map(allX.map((x, i) => [x, i]));
    const xStep = plotW / Math.max(allX.length - 1, 1);
    const xPos = (x) => pad.left + xIndex.get(x) * xStep;
    const yPos = (v) => pad.top + plotH * (1 - (v - min) / (max - min));

    const decimals = opts.yDecimals ?? 1;
    const fmtY = (v) => Number(v.toFixed(decimals));

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="chart-svg" role="img">`;

    // gridlines + y-axis labels (min/mid/max)
    [min, (min + max) / 2, max].forEach(v => {
      const y = yPos(v);
      svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="chart-grid"/>`;
      svg += `<text x="${pad.left - 8}" y="${y + 3}" class="chart-axis-label" text-anchor="end">${fmtY(v)}${esc(yUnit)}</text>`;
    });

    // target reference line
    if (opts.targetY != null) {
      const ty = yPos(opts.targetY);
      svg += `<line x1="${pad.left}" y1="${ty}" x2="${width - pad.right}" y2="${ty}" class="chart-target-line"/>`;
      svg += `<text x="${width - pad.right}" y="${ty - 4}" class="chart-axis-label" text-anchor="end">${esc(opts.targetLabel || 'Target')}</text>`;
    }

    // x-axis first/last labels
    svg += `<text x="${pad.left}" y="${height - 6}" class="chart-axis-label" text-anchor="start">${esc(formatShortDate(allX[0]))}</text>`;
    svg += `<text x="${width - pad.right}" y="${height - 6}" class="chart-axis-label" text-anchor="end">${esc(formatShortDate(allX[allX.length - 1]))}</text>`;

    // series lines + points
    series.forEach((s, si) => {
      const color = s.color || COLORS[si % COLORS.length];
      const sorted = [...s.points].sort((a, b) => xIndex.get(a.x) - xIndex.get(b.x));
      const pathPts = sorted.filter(p => typeof p.y === 'number' && Number.isFinite(p.y));
      if (pathPts.length >= 2) {
        const d = pathPts.map(p => `${xPos(p.x)},${yPos(p.y)}`).join(' ');
        svg += `<polyline points="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      pathPts.forEach(p => {
        svg += `<circle cx="${xPos(p.x)}" cy="${yPos(p.y)}" r="3.5" fill="${color}"><title>${esc(p.x)}: ${p.y}${esc(yUnit)}</title></circle>`;
      });
    });

    // legend
    if (series.length > 1) {
      let lx = pad.left;
      series.forEach((s, si) => {
        const color = s.color || COLORS[si % COLORS.length];
        svg += `<rect x="${lx}" y="2" width="9" height="9" fill="${color}" rx="2"/>`;
        svg += `<text x="${lx + 13}" y="10" class="chart-legend-label">${esc(s.label)}</text>`;
        lx += 13 + s.label.length * 6.2 + 14;
      });
    }

    svg += `</svg>`;
    return svg;
  }

  /** points: [{ x: string, y: number(0-100) }] */
  function buildBarChartSVG(points, opts = {}) {
    const width = opts.width || 640;
    const height = opts.height || 200;
    const pad = { top: 14, right: 12, bottom: 28, left: 34 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const valid = (points || []).filter(p => typeof p.y === 'number' && Number.isFinite(p.y));
    if (!valid.length) return null;

    const barGap = 3;
    const barW = Math.max(2, plotW / valid.length - barGap);
    const color = opts.color || '#3B6E52';

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="chart-svg" role="img">`;
    [0, 50, 100].forEach(v => {
      const y = pad.top + plotH * (1 - v / 100);
      svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="chart-grid"/>`;
      svg += `<text x="${pad.left - 6}" y="${y + 3}" class="chart-axis-label" text-anchor="end">${v}%</text>`;
    });

    valid.forEach((p, i) => {
      const x = pad.left + i * (barW + barGap);
      const barH = plotH * (Math.max(0, Math.min(100, p.y)) / 100);
      const y = pad.top + plotH - barH;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(barH, 1)}" fill="${color}" rx="2"><title>${esc(p.x)}: ${p.y}%</title></rect>`;
    });

    svg += `<text x="${pad.left}" y="${height - 6}" class="chart-axis-label" text-anchor="start">${esc(formatShortDate(valid[0].x))}</text>`;
    svg += `<text x="${width - pad.right}" y="${height - 6}" class="chart-axis-label" text-anchor="end">${esc(formatShortDate(valid[valid.length - 1].x))}</text>`;
    svg += `</svg>`;
    return svg;
  }

  function formatShortDate(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  }

  return { buildLineChartSVG, buildBarChartSVG, COLORS };
})();
