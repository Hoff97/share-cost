import jsPDF from 'jspdf';
import type { Group, Expense, Balance } from './api';
import type { Settlement } from './settlements';

export interface GroupExport {
  version: 1;
  name: string;
  currency: string;
  members: Array<{
    id: string;
    name: string;
    paypal_email: string | null;
    iban: string | null;
  }>;
  expenses: Array<{
    id: string;
    description: string;
    amount: number;
    paid_by: string;
    split_between: string[];
    expense_type: string;
    transfer_to: string | null;
    currency: string;
    exchange_rate: number;
    expense_date: string;
    created_at: string;
    split_type: string;
    splits?: Array<{ member_id: string; share?: number }>;
  }>;
}

/**
 * Export group data to JSON-compatible format
 */
export const exportGroupToJSON = (
  group: Group,
  expenses: Expense[]
): GroupExport => {
  return {
    version: 1,
    name: group.name,
    currency: group.currency,
    members: group.members.map(m => ({
      id: m.id,
      name: m.name,
      paypal_email: m.paypal_email,
      iban: m.iban,
    })),
    expenses: expenses.map(e => ({
      id: e.id,
      description: e.description,
      amount: e.amount,
      paid_by: e.paid_by,
      split_between: e.split_between,
      expense_type: e.expense_type,
      transfer_to: e.transfer_to,
      currency: e.currency,
      exchange_rate: e.exchange_rate,
      expense_date: e.expense_date,
      created_at: e.created_at,
      split_type: e.split_type,
      splits: e.splits,
    })),
  };
};

/**
 * Download group as JSON file
 */
export const downloadGroupJSON = (
  group: Group,
  expenses: Expense[]
): void => {
  const data = exportGroupToJSON(group, expenses);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${group.name?.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'group'}_export.json`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Parse and validate a JSON export file
 */
export const parseGroupJSON = (json: string): GroupExport => {
  const data = JSON.parse(json);
  if (data.version !== 1) {
    throw new Error('Unsupported export version');
  }
  if (!data.name || !data.currency || !Array.isArray(data.members) || !Array.isArray(data.expenses)) {
    throw new Error('Invalid export format');
  }
  return data;
};

/**
 * Generate PDF summary of group expenses and balances
 */
export const downloadGroupPDF = (
  group: Group,
  expenses: Expense[],
  balances: Balance[],
  settlements?: Settlement[]
): void => {
  const doc = new jsPDF() as any;
  let y: number = 20;
  const pageWidth: number = 210;
  const pageHeight: number = 297;
  const margin: number = 15;

  const C = {
    primary:   [67, 80, 191] as [number, number, number],
    positive:  [32, 127, 114] as [number, number, number],
    negative:  [205, 51, 51] as [number, number, number],
    text:      [30, 30, 30] as [number, number, number],
    light:     [120, 120, 120] as [number, number, number],
    border:    [210, 210, 210] as [number, number, number],
  };

  const sc = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const check = (need = 10) => { if (y > pageHeight - need) { doc.addPage(); y = 20; } };
  const pdfText = (text: string): string => text.replace(/→/g, '->');

  const fmtDate = (s: string): string => {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  };

  const separator = () => {
    check(10);
    doc.setDrawColor(C.border[0], C.border[1], C.border[2]);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
  };

  const sectionHead = (text: string) => {
    check(14);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    sc(C.primary);
    doc.text(text, margin, y);
    doc.setFont(undefined, 'normal');
    sc(C.text);
    y += 8;
  };

  // ── Title ────────────────────────────────────────────────────
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  sc(C.primary);
  doc.text(group.name || 'Group', margin, y);
  doc.setFont(undefined, 'normal');
  y += 7;

  // Members compact subtitle
  if (group.members.length > 0) {
    doc.setFontSize(9);
    sc(C.light);
    const memberStr: string = pdfText(group.members.map(m => m.name || 'Unknown').join('  \u00B7  '));
    const memberLines: string[] = doc.splitTextToSize(memberStr, pageWidth - margin * 2);
    for (const line of memberLines) { check(6); doc.text(line, margin, y); y += 5; }
    y += 1;
  }

  // Export info
  doc.setFontSize(9);
  sc(C.light);
  doc.text(pdfText(`Exported: ${fmtDate(new Date().toISOString())}  |  Currency: ${group.currency || 'USD'}`), margin, y);
  sc(C.text);
  y += 8;

  separator();

  // ── Transactions (all, newest first) ─────────────────────────
  const sorted: Expense[] = [...expenses].sort(
    (a, b) => new Date(b.expense_date || b.created_at || '').getTime()
            - new Date(a.expense_date || a.created_at || '').getTime()
  );

  sectionHead(`Transactions (${sorted.length})`);

  // type → accent color
  const typeColor = (type: string): [number, number, number] => {
    if (type === 'transfer') return C.primary;
    if (type === 'income')   return C.positive;
    return C.negative; // expense
  };

  const xDate = margin;
  const xDesc = margin + 24;
  const xAmt  = pageWidth - margin;

  for (const expense of sorted) {
    check(14);
    const paidBy: string  = group.members.find(m => m.id === expense.paid_by)?.name || 'Unknown';
    const amount: number  = expense.amount * expense.exchange_rate;
    const amtStr: string  = `${amount.toFixed(2)} ${expense.currency || group.currency || 'USD'}`;
    const dateStr: string = fmtDate(expense.expense_date || expense.created_at || '');
    const desc: string    = pdfText(expense.description || '(no description)');
    const accent          = typeColor(expense.expense_type);
    const textX: number   = xDesc;

    // Date
    doc.setFontSize(8);
    sc(C.light);
    doc.text(dateStr, xDate, y);

    // Description (bold, accent color)
    const descMaxW: number = xAmt - textX - doc.getTextWidth(amtStr) - 6;
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    sc(accent);
    const descLines: string[] = doc.splitTextToSize(desc, descMaxW);
    doc.text(descLines[0], textX, y);

    // Amount (right-aligned, bold, accent)
    sc(accent);
    doc.text(amtStr, xAmt - doc.getTextWidth(amtStr), y);

    doc.setFont(undefined, 'normal');
    sc(C.text);
    y += 5;

    // Overflow description lines
    if (descLines.length > 1) {
      doc.setFontSize(8);
      sc(C.light);
      for (let i = 1; i < descLines.length; i++) { check(5); doc.text(descLines[i], textX, y); y += 4; }
    }

    // Participants line
    const involvedIds: string[] = expense.expense_type === 'transfer'
      ? [expense.paid_by, expense.transfer_to].filter((id): id is string => !!id)
      : expense.split_between.length > 0 ? expense.split_between : [expense.paid_by];
    const participantNames = involvedIds
      .map(id => group.members.find(m => m.id === id)?.name || 'Unknown')
      .filter((n, i, arr) => arr.indexOf(n) === i); // deduplicate

    let participantLine: string;
    if (expense.expense_type === 'transfer') {
      const to = group.members.find(m => m.id === expense.transfer_to)?.name || 'Unknown';
      participantLine = pdfText(`${paidBy} -> ${to}`);
    } else if (expense.expense_type === 'income') {
      participantLine = pdfText(`received by ${participantNames.join(', ')}`);
    } else {
      participantLine = pdfText(`paid by ${paidBy}` + (participantNames.length > 1 ? `, split: ${participantNames.join(', ')}` : ''));
    }

    doc.setFontSize(8);
    sc(C.light);
    const partLines: string[] = doc.splitTextToSize(participantLine, pageWidth - textX - margin);
    for (const line of partLines) { check(5); doc.text(line, textX, y); y += 4; }

    sc(C.text);
    y += 3;
  }

  y += 2;
  separator();

  // ── Expenses Summary ──────────────────────────────────────────
  sectionHead('Expenses Summary');
  const total: number = expenses.reduce((sum, exp) => {
    const amt = exp.amount * exp.exchange_rate;
    if (exp.expense_type === 'transfer') return sum;
    return exp.expense_type === 'income' ? sum - amt : sum + amt;
  }, 0);
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  sc(C.primary);
  doc.text(`Total expenses: ${total.toFixed(2)} ${group.currency || 'USD'}`, margin, y);
  doc.setFont(undefined, 'normal');
  sc(C.text);
  y += 8;

  separator();

  // ── Transfers & Balances ──────────────────────────────────────
  sectionHead('Transfers & Balances');

  const nonZero: Balance[] = balances.filter(b => Math.abs(b.balance) > 0.005);
  if (nonZero.length === 0) {
    doc.setFontSize(10);
    sc(C.positive);
    doc.text('All settled!', margin, y);
    sc(C.text);
    y += 7;
  } else {
    // Build lookup: for each person, which settlements involve them
    const settlesByPerson = new Map<string, { amount: number; counterpartName: string; direction: 'owes' | 'owed' }[]>();
    for (const bal of nonZero) {
      settlesByPerson.set(bal.user_id, []);
    }
    for (const s of (settlements ?? [])) {
      settlesByPerson.get(s.from)?.push({ amount: s.amount, counterpartName: s.toName, direction: 'owes' });
      settlesByPerson.get(s.to)?.push({ amount: s.amount, counterpartName: s.fromName, direction: 'owed' });
    }

    for (const bal of nonZero) {
      check(9);
      // Header line: "Alice is owed 863.46 EUR:" / "Bob owes 39.46 EUR:"
      doc.setFontSize(10);
      let x: number = margin;
      const roundedBalance: number = Math.round(bal.balance * 100) / 100;
      const isZeroBalance: boolean = Math.abs(roundedBalance) < 0.005;
      const displayBalance: number = isZeroBalance ? 0 : roundedBalance;

      doc.setFont(undefined, 'bold');
      sc(C.text);
      doc.text(bal.user_name || 'Unknown', x, y);
      x += doc.getTextWidth(bal.user_name || 'Unknown');

      const verb: string = displayBalance > 0 ? ' is owed ' : displayBalance < 0 ? ' owes ' : ' has a balance of ';
      doc.setFont(undefined, 'normal');
      sc(C.light);
      doc.text(verb, x, y);
      x += doc.getTextWidth(verb);

      doc.setFont(undefined, 'bold');
      const balColor: [number, number, number] = displayBalance > 0 ? C.positive : displayBalance < 0 ? C.negative : C.text;
      sc(balColor);
      const balValue: string = `${Math.abs(displayBalance).toFixed(2)} ${group.currency || 'USD'}`;
      const balStr: string = displayBalance === 0 ? `${balValue}:` : `${balValue}:`;
      doc.text(balStr, x, y);

      doc.setFont(undefined, 'normal');
      sc(C.text);
      y += 6;

      // Sub-lines for each constituent transfer
      const lines = settlesByPerson.get(bal.user_id) ?? [];
      for (const line of lines) {
        check(6);
        doc.setFontSize(9);
        const bulletAmt: string = `${line.amount.toFixed(2)} ${group.currency || 'USD'}`;
        const counterpart: string = pdfText(line.direction === 'owes'
          ? `- ${bulletAmt} to ${line.counterpartName}`
          : `- ${bulletAmt} by ${line.counterpartName}`);
        sc(line.direction === 'owed' ? C.positive : C.negative);
        doc.text(counterpart, margin, y);
        sc(C.text);
        y += 5;
      }

      y += 2;
    }
  }

  doc.save(`${(group.name || 'group').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_report.pdf`);
};

/**
 * Create import file input and parse result
 */
export const createImportInput = (onImport: (data: GroupExport) => void): HTMLInputElement => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = event.target?.result as string;
        const data = parseGroupJSON(json);
        onImport(data);
      } catch (err) {
        throw new Error(`Failed to import: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  };
  return input;
};
