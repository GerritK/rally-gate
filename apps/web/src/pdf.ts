import type { jsPDF } from 'jspdf';
import type { CellHookData, RowInput } from 'jspdf-autotable';
import {
  fastestByStage,
  notClassified,
  type OverallPlacing,
  type StageResults,
} from './api/classification';
import { rallyName } from './api/rally-info';
import { serverNow } from './api/time';
import type { Entry } from './api/entries';
import { coDriverName, driverName } from './crew';
import {
  formatDuration,
  formatGap,
  formatStamp,
  TIMING_MARKS,
  ENTRY_STATUS_DISPLAY,
} from './format';
import type { Crew, Starter } from '@rally-gate/shared';
import { logoUrl, notifyError, t } from '@rally-gate/ui';
import barlowBoldUrl from './assets/fonts/Barlow-Bold.ttf?url';
import barlowRegularUrl from './assets/fonts/Barlow-Regular.ttf?url';
import monoBoldUrl from './assets/fonts/JetBrainsMono-Bold.ttf?url';
import monoRegularUrl from './assets/fonts/JetBrainsMono-Regular.ttf?url';

/**
 * Everything that goes on paper, a ranking or a start list, as plain text
 * tables laid out by jsPDF rather than the browser, so a sheet is exactly a
 * page. Deliberately plainer than the screen (no flags, no podium); it is
 * for the notice board.
 */
export interface PdfSection {
  heading: string;
  /** The ranking's classes, or "Provisional" for a start list. */
  subtitle: string;
  /** Beside the print time at the foot, e.g. when a start list was
   * published. */
  note?: string;
  head: string[];
  body: RowInput[];
  /** Leading columns every sheet repeats when the rest is split across. */
  repeat: number;
  /** First right-aligned column (times); 3 when absent, after Pos/#/Crew. */
  rightFrom?: number;
  legend: string;
  /** The unranked crews below the table: not classified, or DNF/DNS. */
  extra?: { title: string; head: string[]; body: RowInput[] };
}

/** A timing value, in the app's monospace so digits line up down a column
 * as they do on screen (`.rg-timing`). */
const time = (content: string, bold = false) => ({
  content,
  styles: {
    font: MONO,
    fontStyle: bold ? ('bold' as const) : ('normal' as const),
  },
});
const crewCell = (crew: Crew) =>
  [driverName(crew), coDriverName(crew)].filter(Boolean).join('\n');
const carCell = (crew: Crew) =>
  [crew.body, crew.chassis].filter(Boolean).join('\n');

export function overallPdf(
  heading: string,
  subtitle: string,
  placings: OverallPlacing[],
  entries: Entry[],
  classIds: string[],
): PdfSection {
  const fastest = fastestByStage(placings);
  const times = placings.flatMap((e) => e.stageTimes);
  const unranked = notClassified(placings, entries, classIds);
  const anyPenalty = placings.some((e) => e.penaltyMs > 0);
  return {
    heading,
    subtitle,
    head: [
      t('table.pos'),
      '#',
      t('table.crew'),
      t('table.car'),
      t('pdf.total'),
      t('table.gap'),
      t('table.stages'),
      ...(placings[0]?.stageTimes ?? []).map((t) => t.stageId),
      ...(anyPenalty ? [t('penalties.penalties')] : []),
    ],
    body: placings.map((e) => [
      String(e.position),
      String(e.startNumber),
      crewCell(e),
      carCell(e),
      time(formatDuration(e.durationMs), true),
      time(formatGap(e.gapMs)),
      String(e.stagesCompleted),
      ...e.stageTimes.map((t) =>
        t.notional
          ? time(`(${formatDuration(t.durationMs)})`)
          : time(
              formatDuration(t.durationMs),
              t.durationMs === fastest.get(t.stageId),
            ),
      ),
      ...(anyPenalty
        ? [time(e.penaltyMs > 0 ? `+${formatDuration(e.penaltyMs)}` : '')]
        : []),
    ]),
    repeat: 7,
    rightFrom: 4,
    legend: [
      times.some((v) => !v.notional) &&
        t('pdf.bold', { label: TIMING_MARKS.best.label }),
      times.some((v) => v.notional) &&
        t('pdf.parenthesised', { label: TIMING_MARKS.notional.label }),
    ]
      .filter(Boolean)
      .join('   '),
    extra:
      unranked.length > 0
        ? {
            title: t('pdf.notClassified'),
            head: ['#', t('table.crew'), t('table.car'), t('table.status')],
            body: unranked.map((v) => [
              String(v.startNumber),
              crewCell(v),
              carCell(v),
              ENTRY_STATUS_DISPLAY[v.status].label,
            ]),
          }
        : undefined,
  };
}

export function stagePdf(
  heading: string,
  subtitle: string,
  results: StageResults,
): PdfSection {
  const body = results.classification.map((e) => [
    String(e.position),
    String(e.startNumber),
    crewCell(e),
    carCell(e),
    time(formatDuration(e.durationMs)),
    time(formatGap(e.gapMs)),
    ...results.splitsByGate.map((splits) => {
      const split = splits.get(e.entryId);
      return split
        ? time(
            `${formatDuration(split.elapsedMs)} (${split.position})`,
            split.gapMs === 0,
          )
        : '-';
    }),
  ]);
  const anyBest = body.some((row) =>
    row.some((c) => typeof c === 'object' && c.styles.fontStyle === 'bold'),
  );
  return {
    heading,
    subtitle,
    head: [
      t('table.pos'),
      '#',
      t('table.crew'),
      t('table.car'),
      t('table.time'),
      t('table.gap'),
      ...results.splitGates.map((g) =>
        t('gateRole.split', { n: g.splitIndex }),
      ),
    ],
    body,
    repeat: 6,
    rightFrom: 4,
    legend: anyBest ? t('pdf.bold', { label: TIMING_MARKS.best.label }) : '',
    extra:
      results.nonFinishers.length > 0
        ? {
            // Only the outcomes there are: "DNF / DSQ", not every kind.
            title: [
              ...new Set(results.nonFinishers.map((e) => e.outcome)),
            ].join(' / '),
            head: ['#', t('table.crew'), t('table.car'), t('table.outcome')],
            body: results.nonFinishers.map((e) => [
              String(e.startNumber),
              crewCell(e),
              carCell(e),
              e.outcome,
            ]),
          }
        : undefined,
  };
}

/** Posted top to bottom: one table, no split columns, main classes as
 * full-width header rows when the list is grouped. */
export function startListPdf(
  heading: string,
  /** When it was frozen, formatted; null while it is still provisional. */
  published: string | null,
  rows: { starter: Starter; classHeader: string | null }[],
  grouped: boolean,
): PdfSection {
  const head = [
    t('table.pos'),
    '#',
    t('table.crew'),
    t('table.car'),
    ...(grouped ? [] : [t('classes.class')]),
  ];
  return {
    heading,
    subtitle: published ? '' : t('pdf.provisional'),
    note: published ? t('pdf.published', { at: published }) : undefined,
    head,
    body: rows.flatMap(({ starter, classHeader }) => [
      ...(classHeader
        ? [
            [
              {
                content: classHeader,
                colSpan: head.length,
                styles: { fontStyle: 'bold' as const },
              },
            ],
          ]
        : []),
      [
        String(starter.position),
        String(starter.startNumber),
        crewCell(starter),
        carCell(starter),
        ...(grouped ? [] : [starter.mainClassName ?? '']),
      ],
    ]),
    repeat: head.length,
    rightFrom: head.length,
    legend: '',
  };
}

/** mm, A4. The header and footer sit in the margins autotable leaves: the
 * header with room for its details on two lines, the footer for a legend on
 * two lines above the print time. */
const MARGIN = { top: 27, bottom: 22, left: 12, right: 12 };
/** The app's fonts, embedded: Barlow for text, JetBrains Mono for times.
 * The PDF base fonts know Western European letters only, and one ř or Ł in
 * a name garbles the whole line. */
const FONT = 'Barlow';
const MONO = 'JetBrainsMono';
const FONT_FILES = [
  { url: barlowRegularUrl, family: FONT, style: 'normal' },
  { url: barlowBoldUrl, family: FONT, style: 'bold' },
  { url: monoRegularUrl, family: MONO, style: 'normal' },
  { url: monoBoldUrl, family: MONO, style: 'bold' },
];
const A4_SHORT_SIDE = 210;
const FONT_SIZE = 9;
/** A cell's padding, both sides (`cellPadding` is half of it). */
const PADDING = 3;
/** Extra padding right of the last repeated column: the line that sets
 * them apart from the stage times is drawn in it. */
const SEPARATOR = 3;
/** mm. jsPDF and autotable add widths up in floating point: a cell exactly
 * as wide as its text can wrap, a sheet exactly full can drop its last
 * column. This much room either way. */
const SLACK = 0.2;

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/** The footer's mark: the logo is the brand's orange and cyan, which
 * print as two muddy greys, so it is drawn in two chosen ones instead. */
const LOGO_GREYS = { '#FF6B00': '#5A5A5A', '#00D3F2': '#9A9A9A' };
/** The logo's viewBox, width over height. */
const LOGO_ASPECT = 917 / 418;

let logoPng: Promise<string> | undefined;

/** jsPDF takes no SVG, so it is drawn on a canvas once and embedded as a
 * PNG, sharp enough for its few millimetres. */
function greyLogo(): Promise<string> {
  logoPng ??= (async () => {
    const canvas = document.createElement('canvas');
    canvas.height = 120;
    canvas.width = Math.round(canvas.height * LOGO_ASPECT);
    // A size of its own: Firefox won't draw an SVG with only a viewBox.
    let svg = (await (await fetch(logoUrl)).text()).replace(
      '<svg ',
      `<svg width="${canvas.width}" height="${canvas.height}" `,
    );
    for (const [from, to] of Object.entries(LOGO_GREYS)) {
      svg = svg.replaceAll(from, to);
    }
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await img.decode();
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(img.src);
    return canvas.toDataURL('image/png');
  })();
  return logoPng;
}

let fontFiles: Promise<string[]> | undefined;

/** Fetched once per page load, and only when something is printed. */
async function addFonts(...docs: jsPDF[]) {
  fontFiles ??= Promise.all(
    FONT_FILES.map(async ({ url }) => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary);
    }),
  );
  const files = await fontFiles;
  for (const doc of docs) {
    FONT_FILES.forEach(({ family, style }, i) => {
      const name = `${family}-${style}.ttf`;
      doc.addFileToVFS(name, files[i]);
      doc.addFont(name, family, style);
    });
  }
}

/** Each column's widest content (header bold, a multi-line cell by its
 * longest line) plus padding: what it needs not to wrap. */
function measureColumns(
  doc: jsPDF,
  head: string[],
  body: RowInput[],
  repeat: number,
): number[] {
  return head.map((h, i) => {
    const texts = [{ text: h, font: FONT, bold: true }];
    for (const row of body) {
      if (!Array.isArray(row)) continue;
      const cell = row[i];
      if (cell == null || Array.isArray(cell)) continue;
      const def = typeof cell === 'object' ? cell : null;
      // A class header spans the row; its width is not this column's.
      if (def?.colSpan) continue;
      texts.push({
        text: String(def ? def.content : cell),
        font: def?.styles?.font ?? FONT,
        bold: def?.styles?.fontStyle === 'bold',
      });
    }
    const text = Math.max(
      ...texts.flatMap(({ text, font, bold }) =>
        text.split('\n').map((line) =>
          doc
            .setFont(font, bold ? 'bold' : 'normal')
            .setFontSize(FONT_SIZE)
            .getTextWidth(line),
        ),
      ),
    );
    const separated = i === repeat - 1 && repeat < head.length;
    return text + PADDING + (separated ? SEPARATOR : 0) + SLACK;
  });
}

/**
 * Full sheet width, the slack in the text columns (Crew, Car), so the times
 * keep their own width and stay together rather than spread across the
 * sheet: autotable grows every column without a fixed width. A table too
 * wide for one sheet is split evenly instead: as many sheets as the widest
 * stage column calls for, the same number of stage columns on each, widened
 * to fill it (autotable alone fills greedily and leaves a lone column).
 * Left to autotable, which wraps text, when even the repeated columns
 * don't fit.
 */
function columnWidths(
  head: string[],
  measured: number[],
  repeat: number,
  usable: number,
) {
  const flexible = (h: string) => h === t('table.crew') || h === t('table.car');
  if (sum(measured) > usable) {
    const fixed = sum(measured.slice(0, repeat));
    const rest = measured.slice(repeat);
    if (rest.length === 0 || fixed >= usable) return undefined;
    const fit = Math.max(1, Math.floor((usable - fixed) / Math.max(...rest)));
    const perSheet = Math.ceil(rest.length / Math.ceil(rest.length / fit));
    // perSheet <= fit, so this is at least the widest content plus SLACK;
    // half of that back off keeps the sheet's sum clear of the edge.
    const col = (usable - fixed) / perSheet - SLACK / 2;
    return Object.fromEntries(
      measured.map((w, i) => [i, { cellWidth: i < repeat ? w : col }]),
    );
  }
  if (!head.some(flexible)) return undefined;
  return Object.fromEntries(
    measured.map((w, i) => [
      i,
      { cellWidth: flexible(head[i]) ? ('auto' as const) : w },
    ]),
  );
}

/** One line, cut with an ellipsis if it is wider than `max`. */
function fitLine(doc: jsPDF, text: string, max: number): string {
  if (doc.getTextWidth(text) <= max) return text;
  let cut = text;
  while (cut && doc.getTextWidth(`${cut}…`) > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Builds the sections and opens them as one PDF in a new tab. Call it
 * straight from the click: the tab is opened before anything is awaited,
 * since one opened later is a popup and gets blocked. Without a tab it
 * downloads; a failure closes the tab and shows the error.
 */
export async function printPdf(
  build: () => Promise<{ sections: PdfSection[]; fileName: string }>,
): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const { sections, fileName } = await build();
    await openPdf(sections, fileName, tab);
  } catch (err) {
    tab?.close();
    notifyError(err);
  }
}

/**
 * Every section starts a new sheet and is numbered on its own ("2 / 4" top
 * right), so a stack of them can be sorted and checked for a missing one.
 * Sheets go across the columns first, then down the rows, so they hang as
 * a grid. Portrait unless a table needs the width.
 */
async function openPdf(
  sections: PdfSection[],
  fileName: string,
  tab: Window | null,
) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  // Text widths don't depend on the orientation, which depends on them.
  const probe = new jsPDF({ format: 'a4' });
  await addFonts(probe);
  const measured = sections.map((sec) => ({
    main: measureColumns(probe, sec.head, sec.body, sec.repeat),
    extra: sec.extra
      ? measureColumns(
          probe,
          sec.extra.head,
          sec.extra.body,
          sec.extra.head.length,
        )
      : [],
  }));
  const portraitUsable = A4_SHORT_SIDE - MARGIN.left - MARGIN.right;
  const landscape = measured.some(
    (m) => sum(m.main) > portraitUsable || sum(m.extra) > portraitUsable,
  );
  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    format: 'a4',
  });
  await addFonts(doc);
  const logo = await greyLogo();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const usable = width - MARGIN.left - MARGIN.right;
  const page = () => doc.getCurrentPageInfo().pageNumber;
  const printedAt = formatStamp(serverNow.value);
  const styles = {
    theme: 'plain',
    margin: MARGIN,
    styles: {
      font: FONT,
      fontSize: FONT_SIZE,
      cellPadding: PADDING / 2,
    },
    headStyles: { fontStyle: 'bold' },
    bodyStyles: { lineWidth: { bottom: 0.1 }, lineColor: 160 },
  } as const;

  // What each page shows, collected while autotable draws it.
  const pages = new Map<number, { rows: string[]; cols: string[] }>();
  const sheets: { sec: PdfSection; first: number; last: number }[] = [];

  sections.forEach((sec, i) => {
    if (i > 0) doc.addPage();
    const first = page();
    const separated = sec.repeat < sec.head.length;
    autoTable(doc, {
      ...styles,
      head: [sec.head],
      columnStyles: columnWidths(
        sec.head,
        measured[i].main,
        sec.repeat,
        usable,
      ),
      body: sec.body,
      horizontalPageBreak: true,
      horizontalPageBreakRepeat: [...Array(sec.repeat).keys()],
      horizontalPageBreakBehaviour: 'immediately',
      rowPageBreak: 'avoid',
      // Pos/#/Crew read left to right; times line up their digits.
      didParseCell: ({ column, cell }: CellHookData) => {
        if (column.index >= (sec.rightFrom ?? 3)) cell.styles.halign = 'right';
        if (separated && column.index === sec.repeat - 1) {
          cell.styles.cellPadding = {
            top: PADDING / 2,
            bottom: PADDING / 2,
            left: PADDING / 2,
            right: PADDING / 2 + SEPARATOR,
          };
        }
      },
      didDrawCell: ({ section, column, cell }: CellHookData) => {
        const seen = pages.get(page()) ?? { rows: [], cols: [] };
        pages.set(page(), seen);
        const text = cell.text.join(' ');
        // A class header spans the row; it is no position.
        if (section === 'body' && column.index === 0 && cell.colSpan === 1) {
          seen.rows.push(text);
        }
        if (section === 'head' && column.index >= sec.repeat) {
          seen.cols.push(text);
        }
        // Sets the standing apart from the stage times after it, in the
        // middle of the extra padding: the next column differs per sheet.
        if (separated && column.index === sec.repeat - 1) {
          const x = cell.x + cell.width - SEPARATOR / 2;
          doc.setDrawColor(0).setLineWidth(0.3);
          doc.line(x, cell.y, x, cell.y + cell.height);
        }
      },
    });
    const extra = sec.extra;
    if (extra) {
      const y = (doc as unknown as { lastAutoTable: { finalY: number } })
        .lastAutoTable.finalY;
      doc.setFont(FONT, 'bold').setFontSize(10);
      doc.text(fitLine(doc, extra.title, usable), MARGIN.left, y + 8);
      autoTable(doc, {
        ...styles,
        startY: y + 10,
        head: [extra.head],
        columnStyles: columnWidths(
          extra.head,
          measured[i].extra,
          extra.head.length,
          usable,
        ),
        body: extra.body,
        rowPageBreak: 'avoid',
      });
    }
    sheets.push({ sec, first, last: page() });
  });

  const range = (xs: string[]) =>
    xs.length === 0 ? '' : xs.length === 1 ? xs[0] : `${xs[0]}–${xs.at(-1)}`;

  for (const { sec, first, last } of sheets) {
    const count = last - first + 1;
    const parts = [...Array(count).keys()].map(
      (k) => pages.get(first + k) ?? { rows: [], cols: [] },
    );
    // Only name a split the section actually has.
    const varies = (key: 'rows' | 'cols') =>
      new Set(parts.map((p) => range(p[key]))).size > 1;
    const rowsVary = varies('rows');
    const colsVary = varies('cols');
    parts.forEach((part, k) => {
      doc.setPage(first + k);
      const sheet = `${k + 1} / ${count}`;
      const what = [
        rowsVary &&
          part.rows.length > 0 &&
          `${t('table.pos')} ${range(part.rows)}`,
        colsVary && range(part.cols),
      ];
      const details = [rallyName.value, sec.subtitle, ...what]
        .filter(Boolean)
        .join(' · ');

      // Header: the sheet number always whole, the heading cut short
      // before it, the details on at most the two lines the margin holds.
      doc.setTextColor(0).setFont(FONT, 'bold').setFontSize(13);
      doc.text(sheet, width - MARGIN.right, 13, { align: 'right' });
      const headingWidth = usable - doc.getTextWidth(sheet) - 6;
      doc.text(fitLine(doc, sec.heading, headingWidth), MARGIN.left, 13);
      doc.setFont(FONT, 'normal').setFontSize(FONT_SIZE);
      const detailLines = doc.splitTextToSize(details, usable) as string[];
      detailLines.slice(0, 2).forEach((line, n) => {
        doc.text(
          n === 1 && detailLines.length > 2
            ? fitLine(doc, `${line} …`, usable)
            : line,
          MARGIN.left,
          19 + n * 4,
        );
      });

      // Footer, bottom line: where it comes from on the left, when
      // (published, printed) on the right. Above it the legend, wrapped
      // upward.
      const bottom = height - 9;
      const above = bottom - 4.5;
      const logoHeight = 3;
      const logoWidth = logoHeight * LOGO_ASPECT;
      doc.addImage(
        logo,
        'PNG',
        MARGIN.left,
        bottom - logoHeight + 0.4,
        logoWidth,
        logoHeight,
        'logo',
      );
      doc.setFontSize(8).setTextColor(90).setFont(FONT, 'bold');
      doc.text('Rally Gate', MARGIN.left + logoWidth + 1.5, bottom);
      doc.setFont(FONT, 'normal');
      doc.text(
        [sec.note, t('pdf.printed', { at: printedAt })]
          .filter(Boolean)
          .join(' · '),
        width - MARGIN.right,
        bottom,
        { align: 'right' },
      );
      doc.setTextColor(0);
      const legendLines = sec.legend
        ? (doc.splitTextToSize(sec.legend, usable) as string[])
        : [];
      legendLines.forEach((line, n) => {
        const fromBottom = legendLines.length - 1 - n;
        doc.text(line, MARGIN.left, above - fromBottom * 3.5);
      });
    });
  }

  doc.setProperties({ title: fileName });
  if (tab) {
    tab.location.href = String(doc.output('bloburl'));
  } else {
    doc.save(`${fileName}.pdf`);
  }
}
